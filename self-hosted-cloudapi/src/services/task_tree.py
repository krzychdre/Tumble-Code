"""Parent/child task relationships — recording them, and reading the tree.

Where the data comes from
-------------------------
Roo Code spawns a subtask as a task in its own right, with its own id and its
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
from dataclasses import dataclass
from typing import Iterable, Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from src.models.relation import TaskRelation
from src.models.task import Task

logger = logging.getLogger(__name__)


async def record_relation(
    db: AsyncSession,
    properties: dict,
    user_id: Optional[str] = None,
) -> None:
    """Record a child→parent link if this event's properties carry one.

    Silent no-op for the overwhelming majority of events, which name no parent.
    Idempotent: the same link arriving on a hundred later events writes once.
    A task never changes parent, so an existing link is never overwritten.
    """
    if not isinstance(properties, dict):
        return
    child = properties.get("taskId")
    parent = properties.get("parentTaskId")
    if not child or not parent or child == parent:
        return

    existing = await db.execute(
        select(TaskRelation.child_task_id).where(TaskRelation.child_task_id == child)
    )
    if existing.scalar_one_or_none() is None:
        db.add(TaskRelation(child_task_id=child, parent_task_id=parent, user_id=user_id))
        await db.flush()

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
    await db.execute(
        update(Task)
        .where(Task.id == child, Task.parent_task_id.is_(None), parent_row)
        .values(parent_task_id=parent)
    )


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
        select(TaskRelation.child_task_id).where(TaskRelation.parent_task_id == parent_task_id)
    )
    children = [row[0] for row in result.all()]
    if not children:
        return
    await db.execute(
        update(Task)
        .where(Task.id.in_(children), Task.parent_task_id.is_(None))
        .values(parent_task_id=parent_task_id)
    )


async def subtrees(
    db: AsyncSession,
    task_ids: Iterable[str],
    user_id: str,
    max_depth: int = 20,
) -> dict[str, list[Task]]:
    """Every stored task beneath these tasks, grouped by parent, oldest first.

    One query per level of the tree rather than one per task, so a page of 25
    runs costs as many queries as its deepest run is deep (one or two on the
    live corpus). Walked level by level rather than with a recursive CTE so the
    same code runs on SQLite (the test database) and Postgres.

    The requested ids may include each other's subtasks (the flat view asks for
    a page of every kind of task at once), and such a task still belongs under
    its parent. Each task is placed under exactly one parent, and never under a
    task beneath it: a cycle in the client-supplied links is cut at the edge
    that would close it, rather than producing a tree that contains itself.
    ``max_depth`` bounds the walk for the same reason.
    """
    tree: dict[str, list[Task]] = {}
    parent_of: dict[str, str] = {}
    frontier = list(dict.fromkeys(t for t in task_ids if t))
    for _ in range(max_depth):
        if not frontier:
            break
        result = await db.execute(
            select(Task)
            .where(Task.parent_task_id.in_(frontier), Task.user_id == user_id)
            .order_by(Task.created_at)
        )
        frontier = []
        for child in result.scalars().all():
            if child.id in parent_of or _is_at_or_above(parent_of, child.parent_task_id, child.id):
                continue
            parent_of[child.id] = child.parent_task_id
            tree.setdefault(child.parent_task_id, []).append(child)
            frontier.append(child.id)
    return tree


def _is_at_or_above(parent_of: dict[str, str], task_id: Optional[str], candidate: str) -> bool:
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

    Duration and message count are deliberately absent. A parent's span already
    encloses the subtasks it waited on (all 17 subtasks on the live corpus lie
    inside their parent's first/last message), so adding theirs would count the
    same minutes twice; and a message count is a property of one conversation.
    """

    cost: float = 0.0
    tokens_in: int = 0
    tokens_out: int = 0
    cache_reads: int = 0
    cache_writes: int = 0

    @classmethod
    def of(cls, task: Task) -> "Spend":
        return cls(
            cost=task.cost or 0.0,
            tokens_in=task.tokens_in or 0,
            tokens_out=task.tokens_out or 0,
            cache_reads=task.cache_reads or 0,
            cache_writes=task.cache_writes or 0,
        )

    def __add__(self, other: "Spend") -> "Spend":
        return Spend(
            cost=self.cost + other.cost,
            tokens_in=self.tokens_in + other.tokens_in,
            tokens_out=self.tokens_out + other.tokens_out,
            cache_reads=self.cache_reads + other.cache_reads,
            cache_writes=self.cache_writes + other.cache_writes,
        )

    def __sub__(self, other: "Spend") -> "Spend":
        return Spend(
            cost=self.cost - other.cost,
            tokens_in=self.tokens_in - other.tokens_in,
            tokens_out=self.tokens_out - other.tokens_out,
            cache_reads=self.cache_reads - other.cache_reads,
            cache_writes=self.cache_writes - other.cache_writes,
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


async def ancestors(db: AsyncSession, task: Task, limit: int = 10) -> list[Task]:
    """The chain from ``task``'s parent up to the root, nearest first.

    Bounded by ``limit`` and by a seen-set: the data comes from a client, and a
    cycle (however impossible in principle) must not hang a page render.
    """
    chain: list[Task] = []
    seen = {task.id}
    current = task
    while current.parent_task_id and len(chain) < limit:
        if current.parent_task_id in seen:
            logger.warning("[task_tree] cycle at task %s; stopping walk", current.id)
            break
        seen.add(current.parent_task_id)
        result = await db.execute(select(Task).where(Task.id == current.parent_task_id))
        parent = result.scalar_one_or_none()
        if parent is None:
            break
        chain.append(parent)
        current = parent
    return chain
