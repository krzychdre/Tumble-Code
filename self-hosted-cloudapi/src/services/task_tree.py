"""Parent/child task relationships — recording them, and reading the tree.

Where the data comes from
-------------------------
Tumble Code spawns a subtask as a task in its own right, with its own id and its
own conversation. The only place the relationship is stated is telemetry: every
``Task Created`` (and in practice several later events) carries ``taskId``
alongside ``parentTaskId`` and ``isSubtask``. Nothing consumed it, so the web
view showed 150 subtasks as flat, orphaned entries with no way to tell which
run they belonged to.

Recording is two-sided because the event and the task row do not arrive in a
fixed order:

  * ``record_relation`` runs on every telemetry event that names a parent. It
    writes ``task_relations`` (which needs neither task to exist) and, if both
    rows happen to be there already, stamps the child.
  * ``adopt_from_relations`` runs when a task row is created, and stamps it from
    whatever ``task_relations`` already knows; ``link_pending_children`` runs at
    the same moment and claims the children that were stored first.

Between them the link survives either ordering, and no event has to be replayed.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from typing import Iterable, Optional

from sqlalchemy import (
    BigInteger,
    and_,
    bindparam,
    cast,
    func,
    literal,
    select,
    update,
)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from src.database import dialect_insert
from src.models.relation import TaskRelation
from src.models.task import Task

logger = logging.getLogger(__name__)

# How far a run reaches, up and down: deeper than any real tree (a vision
# subtask that kept delegating built a chain of 90), so a run's totals are
# exact on real data, while a chain or cycle a client builds deeper costs a
# write a bounded walk.
RUN_DEPTH_MAX = 128

# The longest task id a link may name. Real ids are uuids (36 characters);
# ix_tasks_parent_user indexes a parent id beside its owner, and Postgres
# refuses a btree entry over 2704 bytes.
TASK_ID_MAX = 256


async def record_relation(
    db: AsyncSession,
    properties: dict,
    user_id: Optional[str] = None,
) -> None:
    """Record a child→parent link if this event's properties carry one.

    Silent no-op for the overwhelming majority of events, which name no parent.
    Idempotent: the same link arriving on a hundred later events writes once.
    A task never changes parent, so an existing link is never overwritten.
    An id that is no string of at most ``TASK_ID_MAX`` characters links
    nothing.
    """
    if not isinstance(properties, dict):
        return
    child = properties.get("taskId")
    parent = properties.get("parentTaskId")
    if not (_is_task_id(child) and _is_task_id(parent)) or child == parent:
        return

    existing = await db.execute(
        select(TaskRelation.child_task_id).where(TaskRelation.child_task_id == child)
    )
    if existing.scalar_one_or_none() is None:
        # Several events of one subtask arrive at once (Task Created, the
        # first messages, an LLM Completion), each in its own request. Two of
        # them could both miss the lookup above and both insert; the loser
        # died on ``task_relations_pkey`` and the whole event request answered
        # 500. ON CONFLICT DO NOTHING lets the loser keep the winner's row,
        # which holds the same link (a task never changes parent).
        upsert_insert = dialect_insert(db)
        if upsert_insert is None:
            db.add(
                TaskRelation(
                    child_task_id=child, parent_task_id=parent, user_id=user_id
                )
            )
            await db.flush()
        else:
            await db.execute(
                upsert_insert(TaskRelation)
                .values(child_task_id=child, parent_task_id=parent, user_id=user_id)
                .on_conflict_do_nothing(index_elements=["child_task_id"])
            )

    # The child's row may already exist (a live task streams messages while its
    # events fire). Stamp it now so the tree is right without waiting for a
    # later write. Never overwrites an existing parent.
    #
    # Only when the parent's row exists too: ``tasks.parent_task_id`` is a
    # foreign key, and a child routinely streams before its parent's row is
    # created. Stamping then would raise inside the telemetry request and roll
    # back the event and the relation with it (DEF-C47). Skipping loses
    # nothing: the relation is stored above, and the parent's row claims its
    # waiting children when it is created (``link_pending_children``).
    parent_task = aliased(Task, name="parent_task")
    parent_row = select(parent_task.id).where(parent_task.id == parent).exists()
    stamped = await db.execute(
        update(Task)
        .where(Task.id == child, Task.parent_task_id.is_(None), parent_row)
        .values(parent_task_id=parent)
    )
    # Most events of a subtask repeat a link stamped long ago; only a new one
    # moves the run totals above it.
    if stamped.rowcount:
        await refresh_run_totals(db, [child])


def _is_task_id(value) -> bool:
    return isinstance(value, str) and 0 < len(value) <= TASK_ID_MAX


async def adopt_from_relations(db: AsyncSession, task_id: str) -> None:
    """Stamp a freshly created task row with the parent telemetry already knew.

    Called from the task-creation paths (backfill and the live bridge). The
    parent is only stamped when the parent task actually exists as a row —
    ``tasks.parent_task_id`` is a foreign key, and a subtask whose parent was
    never shared would otherwise fail to insert.
    """
    result = await db.execute(
        select(TaskRelation.parent_task_id).where(TaskRelation.child_task_id == task_id)
    )
    parent = result.scalar_one_or_none()
    if not parent:
        return

    parent_exists = await db.execute(select(Task.id).where(Task.id == parent))
    if parent_exists.scalar_one_or_none() is None:
        return

    # No run totals to recompute here: a row the bridge just created has no
    # figures yet, a backfill recomputes them with the summary right after,
    # and the children a row claims are recomputed by ``link_pending_children``.
    await db.execute(
        update(Task)
        .where(Task.id == task_id, Task.parent_task_id.is_(None))
        .values(parent_task_id=parent)
    )


async def link_pending_children(db: AsyncSession, parent_task_id: str) -> None:
    """Attach children that were waiting for this parent's row to exist.

    The reverse of ``adopt_from_relations``: a subtask is frequently stored
    before its parent (the parent is still running when the child finishes and
    gets shared), so its stamp was skipped for want of a foreign-key target.
    When the parent finally lands, claim them.
    """
    result = await db.execute(
        select(TaskRelation.child_task_id).where(
            TaskRelation.parent_task_id == parent_task_id
        )
    )
    children = [row[0] for row in result.all()]
    if not children:
        return
    stamped = await db.execute(
        update(Task)
        .where(Task.id.in_(children), Task.parent_task_id.is_(None))
        .values(parent_task_id=parent_task_id)
    )
    if stamped.rowcount:
        await refresh_run_totals(db, [parent_task_id])


async def refresh_run_totals(db: AsyncSession, task_ids: list[str]) -> None:
    """Recompute ``run_cost``, ``run_tokens`` and ``run_duration_ms`` of these
    tasks and of their owner's tasks above them.

    A task's run is the task plus every task beneath it of the same owner, at
    most ``RUN_DEPTH_MAX`` levels down: the walk stops at another user's task,
    and a cycle in the client-supplied parent links counts each member once.
    A change to a task's own figures or to its parent link therefore moves the
    totals of that task and its ancestors of the same owner only, and the
    climb stops at another user's task: a write never locks or sums another
    user's rows. They are summed again from the member rows, never adjusted
    by a difference, so this is idempotent like
    ``task_summary.refresh_task_summary``.

    Only the rows whose totals changed are written, and their ``updated_at``
    stays: a subtask's activity is not its parent's.
    """
    # The climb is a statement of its own: joined to the walk down, Postgres'
    # row estimate for the two recursions crossed its JIT threshold, and JIT
    # compilation took 20 ms for a query that runs in 1.6 ms.
    climbed = await db.execute(_RUNS_ABOVE, {"task_ids": task_ids})
    parent_of = dict(climbed.all())
    # Most refreshes change no total and lock nothing.
    if not await _changed_runs(db, parent_of):
        return
    # Another writer in the tree may hold an ancestor, its own figures not yet
    # committed, so the sums are taken again once the rows are ours (a fresh
    # snapshot on Postgres).
    await _lock_deepest_first(db, parent_of)
    changed = await _changed_runs(db, parent_of)
    if not changed:
        return
    await db.execute(
        update(Task)
        .where(Task.id == bindparam("run_id"))
        .values(
            run_cost=bindparam("total_cost"),
            run_tokens=bindparam("total_tokens"),
            run_duration_ms=bindparam("total_duration_ms"),
            updated_at=Task.updated_at,
        )
        # One UPDATE per row with its own WHERE, not the ORM's update by
        # primary key, which cannot keep updated_at as it is.
        .execution_options(dml_strategy="core_only"),
        changed,
    )


async def _changed_runs(
    db: AsyncSession, parent_of: dict[str, Optional[str]]
) -> list[dict]:
    """The new totals of the runs of ``parent_of`` whose sums moved."""
    result = await db.execute(_RUN_TOTALS, {"run_ids": list(parent_of)})
    return [
        {
            "run_id": row.run_id,
            "total_cost": row.cost,
            "total_tokens": row.tokens,
            "total_duration_ms": row.duration_ms,
        }
        for row in result.all()
        if (row.tokens, row.duration_ms) != (row.run_tokens, row.run_duration_ms)
        # Float sums differ in the last bits with the order they are added in.
        or not math.isclose(row.cost, row.run_cost)
    ]


async def lock_for_delete(db: AsyncSession, task_ids: list[str]) -> None:
    """Lock the rows a delete of ``task_ids`` (one user's tasks) writes, in the
    writers' order: FOR UPDATE on the deleted rows, FOR NO KEY UPDATE on
    their surviving children, whose link it cuts, and on the runs above them,
    which ``refresh_run_totals`` sums again.

    Taken in the order the statements of the delete reach them, a parent
    before its child, a delete could hold a row a streaming subtask's climb
    waits for while it waits for that subtask's own row.
    """
    climbed = await db.execute(_RUNS_ABOVE, {"task_ids": task_ids})
    parent_of = dict(climbed.all())
    children = await db.execute(
        select(Task.id, Task.parent_task_id).where(
            Task.parent_task_id.in_(task_ids), Task.id.not_in(task_ids)
        )
    )
    parent_of.update(children.all())
    await _lock_deepest_first(db, parent_of, exclusive=frozenset(task_ids))


async def _lock_deepest_first(
    db: AsyncSession,
    parent_of: dict[str, Optional[str]],
    exclusive: frozenset[str] = frozenset(),
) -> None:
    """Lock the rows of ``parent_of``, FOR UPDATE those in ``exclusive`` and
    FOR NO KEY UPDATE (the lock an UPDATE takes) the rest.

    Deepest first: a writer already holds its own task's row, the deepest of
    its chain, so two writers in one tree take the rows they share in the
    same order and wait rather than deadlock.
    """
    for task_id in sorted(parent_of, key=lambda t: (-_depth(parent_of, t), t)):
        await db.execute(
            select(Task.id)
            .where(Task.id == task_id)
            .with_for_update(key_share=task_id not in exclusive)
        )


def _depth(parent_of: dict[str, Optional[str]], task_id: str) -> int:
    """How many tasks are above ``task_id`` in ``parent_of``; a cycle is
    walked once."""
    seen = {task_id}
    parent = parent_of[task_id]
    while parent in parent_of and parent not in seen:
        seen.add(parent)
        parent = parent_of[parent]
    return len(seen) - 1


def _runs_above():
    """(id, parent_task_id) of the tasks ``task_ids`` and of the tasks of the
    same owner above them, at most ``RUN_DEPTH_MAX`` levels up.

    The climb stops at another owner's task: its run never counts this one
    (the walk down is the owner's), so its totals cannot change.
    """
    runs = (
        select(Task.id, Task.parent_task_id, Task.user_id, literal(0).label("depth"))
        .where(Task.id.in_(bindparam("task_ids", expanding=True)))
        .cte("runs_above", recursive=True)
    )
    parent = aliased(Task, name="parent")
    runs = runs.union_all(
        select(parent.id, parent.parent_task_id, parent.user_id, runs.c.depth + 1)
        .join(
            runs,
            and_(
                parent.id == runs.c.parent_task_id,
                parent.user_id == runs.c.user_id,
            ),
        )
        .where(runs.c.depth < RUN_DEPTH_MAX)
    )
    return select(runs.c.id, runs.c.parent_task_id).distinct()


def _run_totals():
    """The summed figures of each run of ``run_ids`` beside its stored ones."""
    members = (
        select(
            Task.id.label("run_id"),
            Task.id.label("member_id"),
            Task.user_id,
            literal(0).label("depth"),
        )
        .where(Task.id.in_(bindparam("run_ids", expanding=True)))
        .cte("run_members", recursive=True)
    )
    child = aliased(Task, name="child")
    members = members.union_all(
        select(members.c.run_id, child.id, members.c.user_id, members.c.depth + 1)
        .join(
            members,
            and_(
                child.parent_task_id == members.c.member_id,
                child.user_id == members.c.user_id,
            ),
        )
        .where(members.c.depth < RUN_DEPTH_MAX)
    )
    # A cycle repeats its members until the depth runs out; each counts once.
    members = select(members.c.run_id, members.c.member_id).distinct().subquery()
    member = aliased(Task, name="member")
    totals = (
        select(
            members.c.run_id,
            func.sum(member.cost).label("cost"),
            # Postgres sums bigint as numeric.
            cast(func.sum(member.tokens_in + member.tokens_out), BigInteger).label(
                "tokens"
            ),
            cast(func.sum(member.duration_ms), BigInteger).label("duration_ms"),
        )
        .join(member, member.id == members.c.member_id)
        .group_by(members.c.run_id)
        .subquery("run_totals")
    )
    return select(totals, Task.run_cost, Task.run_tokens, Task.run_duration_ms).join(
        Task, Task.id == totals.c.run_id
    )


# Built once: building them took 4 of the 6 ms of a call on the bench.
_RUNS_ABOVE = _runs_above()
_RUN_TOTALS = _run_totals()


def descendant_ids(task_ids: Iterable[str], user_id: str):
    """A SELECT of the id of every task of the user beneath these tasks.

    One recursive CTE (``WITH RECURSIVE``, which SQLite and Postgres both run)
    whatever the depth. There is deliberately no depth limit: the walk used to
    stop at 20 levels, and a vision subtask that kept delegating to another
    vision subtask built a chain 90 levels deep, so the list showed $0.7431 for
    a run that cost $3.6138 and a delete left 71 subtasks behind. UNION rather
    than UNION ALL is what ends a cycle in the client-supplied parent links: a
    row already produced is not produced again, so the recursion runs dry. The
    result can include a requested id itself (on a cycle, or when one requested
    task sits beneath another); callers skip what they already hold.
    """
    below = (
        select(Task.id)
        .where(Task.parent_task_id.in_(list(task_ids)), Task.user_id == user_id)
        .cte("descendants", recursive=True)
    )
    child = aliased(Task, name="child")
    below = below.union(
        select(child.id)
        .join(below, child.parent_task_id == below.c.id)
        .where(child.user_id == user_id)
    )
    return select(below.c.id)


async def subtrees(
    db: AsyncSession,
    task_ids: Iterable[str],
    user_id: str,
) -> dict[str, list[Task]]:
    """Every stored task beneath these tasks, grouped by parent, oldest first.

    One query for the whole page, however deep its runs go (``descendant_ids``);
    the tree is then assembled here, level by level from the requested tasks.

    The requested ids may include each other's subtasks (the flat view asks for
    a page of every kind of task at once), and such a task still belongs under
    its parent. Each task is placed under exactly one parent, and never under a
    task beneath it: a cycle in the client-supplied links is cut at the edge
    that would close it, rather than producing a tree that contains itself.
    """
    frontier = list(dict.fromkeys(t for t in task_ids if t))
    if not frontier:
        return {}
    result = await db.execute(
        select(Task).where(Task.id.in_(descendant_ids(frontier, user_id)))
    )
    children_of: dict[str, list[Task]] = {}
    for row in result.scalars().all():
        children_of.setdefault(row.parent_task_id, []).append(row)

    tree: dict[str, list[Task]] = {}
    parent_of: dict[str, str] = {}
    # Terminates: a task enters the frontier only the first time it is placed.
    while frontier:
        level = sorted(
            (child for parent in frontier for child in children_of.get(parent, [])),
            key=lambda t: t.created_at,
        )
        frontier = []
        for child in level:
            if child.id in parent_of or _is_at_or_above(
                parent_of, child.parent_task_id, child.id
            ):
                continue
            parent_of[child.id] = child.parent_task_id
            tree.setdefault(child.parent_task_id, []).append(child)
            frontier.append(child.id)
    return tree


def _is_at_or_above(
    parent_of: dict[str, str], task_id: Optional[str], candidate: str
) -> bool:
    """Is ``candidate`` ``task_id`` itself or one of its ancestors so far?

    Terminates because ``parent_of`` never gains the edge that would close a
    loop: that is exactly the edge this check refuses.
    """
    while task_id is not None:
        if task_id == candidate:
            return True
        task_id = parent_of.get(task_id)
    return False


def subtree_size(tree: dict[str, list[Task]], task_id: str) -> int:
    """How many tasks sit beneath ``task_id`` in a tree from ``subtrees``."""
    return sum(1 + subtree_size(tree, child.id) for child in tree.get(task_id, []))


@dataclass(frozen=True)
class Spend:
    """What some tasks consumed: the additive figures of a task row.

    The message count is deliberately absent: it is a property of one
    conversation. The duration adds up because it is the time of each task's
    own model requests, not a span that would enclose its subtasks.
    """

    cost: float = 0.0
    tokens_in: int = 0
    tokens_out: int = 0
    cache_reads: int = 0
    cache_writes: int = 0
    duration_ms: int = 0

    @classmethod
    def of(cls, task: Task) -> "Spend":
        return cls(
            cost=task.cost or 0.0,
            tokens_in=task.tokens_in or 0,
            tokens_out=task.tokens_out or 0,
            cache_reads=task.cache_reads or 0,
            cache_writes=task.cache_writes or 0,
            duration_ms=task.duration_ms or 0,
        )

    def __add__(self, other: "Spend") -> "Spend":
        return Spend(
            cost=self.cost + other.cost,
            tokens_in=self.tokens_in + other.tokens_in,
            tokens_out=self.tokens_out + other.tokens_out,
            cache_reads=self.cache_reads + other.cache_reads,
            cache_writes=self.cache_writes + other.cache_writes,
            duration_ms=self.duration_ms + other.duration_ms,
        )

    def __sub__(self, other: "Spend") -> "Spend":
        return Spend(
            cost=self.cost - other.cost,
            tokens_in=self.tokens_in - other.tokens_in,
            tokens_out=self.tokens_out - other.tokens_out,
            cache_reads=self.cache_reads - other.cache_reads,
            cache_writes=self.cache_writes - other.cache_writes,
            duration_ms=self.duration_ms - other.duration_ms,
        )

    @property
    def tokens(self) -> int:
        return self.tokens_in + self.tokens_out


def subtree_spend(tree: dict[str, list[Task]], task: Task) -> Spend:
    """What ``task`` and every stored task beneath it consumed, together.

    A plain sum is exact because the figures are disjoint: each task's columns
    add up only its own ``api_req_started`` rows, and a subtask is a separate
    task with its own conversation. Checked on the live corpus against the
    ``LLM Completion`` telemetry, where every task's stored cost equals the cost
    of the completions stamped with its own id (the parent of "Analyse issue
    described in 1289652 ADO" $0.1656 = 13 completions, its subtasks $1.1940 =
    46 and $0.0493 = 3), so the run cost $1.4090, not the $0.1656 on its row.
    """
    total = Spend.of(task)
    for child in tree.get(task.id, []):
        total = total + subtree_spend(tree, child)
    return total


def _ancestor_query(parent_id: str, limit: int):
    """Rows of the ancestor chain starting at ``parent_id``, in one statement.

    A recursive CTE (``WITH RECURSIVE``, which both SQLite and Postgres run)
    climbs ``parent_task_id`` from the given parent. ``depth`` stops it after
    ``limit`` steps, which also bounds it on a cycle in the client-supplied
    links: a loop just repeats rows until the depth runs out, and the caller
    walks the result with a seen-set exactly as the per-level walk did.
    """
    chain = (
        select(Task.id, Task.parent_task_id, literal(1).label("depth"))
        .where(Task.id == parent_id)
        .cte("ancestor_chain", recursive=True)
    )
    chain = chain.union_all(
        select(Task.id, Task.parent_task_id, (chain.c.depth + 1).label("depth"))
        .join(chain, Task.id == chain.c.parent_task_id)
        .where(chain.c.depth < limit)
    )
    return select(Task).where(Task.id.in_(select(chain.c.id)))


async def ancestors(db: AsyncSession, task: Task, limit: int = 10) -> list[Task]:
    """The chain from ``task``'s parent up to the root, nearest first.

    One query whatever the depth (``_ancestor_query``); it used to be one per
    level. Bounded by ``limit`` and by a seen-set: the data comes from a
    client, and a cycle (however impossible in principle) must not hang a
    page render.
    """
    if not task.parent_task_id or limit <= 0:
        return []
    result = await db.execute(_ancestor_query(task.parent_task_id, limit))
    by_id = {row.id: row for row in result.scalars().all()}

    chain: list[Task] = []
    seen = {task.id}
    current = task
    while current.parent_task_id and len(chain) < limit:
        if current.parent_task_id in seen:
            logger.warning("[task_tree] cycle at task %s; stopping walk", current.id)
            break
        seen.add(current.parent_task_id)
        parent = by_id.get(current.parent_task_id)
        if parent is None:
            break
        chain.append(parent)
        current = parent
    return chain
