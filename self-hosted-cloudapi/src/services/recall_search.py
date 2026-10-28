"""Recall: which session cards a reader may find, the search, and reading one.

The reader is a user working in project C (resolved from their folder within
their tenant, services/projects). The rule, symmetric by design:

* ``scope(C) = none``: nothing at all (the API answers 404);
* a card of C: ``owner`` shows only the reader's own, ``members`` and
  ``organization`` everyone's;
* a card of another project P: only when C and P are both ``organization``.

Nothing is ever visible across tenants. ``visible`` is the one place the rule
is written; the search and the read both filter with it.
"""

import json
import re
import time
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import and_, case, func, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.project import SCOPE_ORGANIZATION, SCOPE_OWNER, Project
from src.models.recall import RecallLog, SessionCard
from src.models.task import TaskMessage
from src.models.user import User
from src.services.anonymizer import redact_secrets
from src.services.recall_text import SIMPLE, query_words, tsquery, words
from src.services.session_quality import (
    KIND_COMPLETION,
    KIND_COMPLETION_REPLY,
    KIND_INTERVENTION,
)

QUERY_MAX = 200
LIMIT_MAX = 10
PAGE_CHARS = 8000
SNIPPET_CHARS = 300
SNIPPETS = 2
# A hit's weight halves every 90 days.
HALF_LIFE_MS = 90 * 24 * 3600 * 1000
STATEMENT_TIMEOUT_MS = 300
CANDIDATES = 100
# A subtask's title and prompt are the long brief a delegating agent wrote, so
# its words match often; the user's own sessions should come first.
SUBTASK_WEIGHT = 0.5


class BadQuery(Exception):
    pass


def visible(user_id: str, project: Project, wide: bool):
    """The cards ``user_id`` working in ``project`` may see. ``wide`` asks for
    other projects too, which only an ``organization`` project gets.

    The projects are named by a subquery, not a join: joined, the planner
    drives the search from the projects table into the word index even for
    one project, and a common word then reads most of the tenant."""
    tenant = SessionCard.tenant_id == project.tenant_id
    if wide and project.recall_scope == SCOPE_ORGANIZATION:
        shared = select(Project.id).where(
            Project.tenant_id == project.tenant_id,
            Project.recall_scope == SCOPE_ORGANIZATION,
        )
        return and_(tenant, SessionCard.project_id.in_(shared))
    same = and_(tenant, SessionCard.project_id == project.id)
    if project.recall_scope == SCOPE_OWNER:
        return and_(same, SessionCard.author_id == user_id)
    return same


@dataclass(frozen=True)
class Hit:
    session_id: str
    project_name: str
    author: str
    last_ts: int
    title: str
    completed: bool
    snippets: list[str]


@dataclass(frozen=True)
class SearchResult:
    hits: list[Hit]
    too_broad: bool


async def search(
    db: AsyncSession,
    user_id: str,
    project: Project,
    query: str,
    wide: bool,
    limit: int,
    exclude_task_id: str | None,
) -> SearchResult:
    expression = tsquery(query)
    if not expression:
        raise BadQuery()
    started = time.monotonic()
    ts_query = func.to_tsquery(SIMPLE, expression)
    now_ms = int(time.time() * 1000)
    score = (
        func.ts_rank(SessionCard.search_vector, ts_query)
        * func.power(0.5, (now_ms - SessionCard.last_ts) / HALF_LIFE_MS)
        * case((SessionCard.is_subtask, SUBTASK_WEIGHT), else_=1.0)
    )
    # Two steps: the most recent matching cards, then the best of those. A
    # common word matches most of a tenant; ranking every match would read
    # them all, while the newest CANDIDATES come straight off the recency
    # index. An older card ranks lower anyway (the age decay).
    candidates = (
        select(SessionCard.task_id)
        .where(
            visible(user_id, project, wide),
            SessionCard.search_vector.op("@@")(ts_query),
        )
        .order_by(SessionCard.last_ts.desc())
        .limit(CANDIDATES)
    )
    if exclude_task_id:
        candidates = candidates.where(SessionCard.task_id != exclude_task_id)
    candidates = candidates.subquery()
    statement = (
        select(SessionCard, Project.name, User)
        .join(candidates, candidates.c.task_id == SessionCard.task_id)
        .join(Project, Project.id == SessionCard.project_id)
        .join(User, User.id == SessionCard.author_id, isouter=True)
        .order_by(score.desc())
        .limit(limit)
    )

    try:
        # The timeout lives and dies with the savepoint, so a cancelled search
        # leaves the session usable for the log row below.
        async with db.begin_nested():
            await db.execute(
                text(f"SET LOCAL statement_timeout = {STATEMENT_TIMEOUT_MS}")
            )
            # asyncpg prepares statements, and after five runs Postgres may
            # keep a generic plan that cannot see which project or how common
            # the word is; that plan reads the word index for every search.
            await db.execute(text("SET LOCAL plan_cache_mode = force_custom_plan"))
            rows = (await db.execute(statement)).all()
    except DBAPIError as error:
        if "statement timeout" not in str(error.orig):
            raise
        await _log(db, user_id, project, "search", query, 0, started)
        return SearchResult([], too_broad=True)

    terms = query_words(query)
    hits = [
        Hit(
            session_id=card.task_id,
            project_name=name,
            author=_author(author),
            last_ts=card.last_ts,
            title=card.title,
            completed=card.completed,
            snippets=snippets(card.body, terms),
        )
        for card, name, author in rows
    ]
    await _log(db, user_id, project, "search", query, len(hits), started)
    return SearchResult(hits, too_broad=False)


@dataclass(frozen=True)
class Page:
    hit: Hit
    part: str
    text: str
    next_offset: int | None


async def read(
    db: AsyncSession,
    user_id: str,
    project: Project,
    session_id: str,
    part: str,
    offset: int,
) -> Page | None:
    """One page of a session the reader may see; None when it is not one."""
    started = time.monotonic()
    row = (
        await db.execute(
            select(SessionCard, Project.name, User)
            .join(Project, Project.id == SessionCard.project_id)
            .join(User, User.id == SessionCard.author_id, isouter=True)
            .where(
                visible(user_id, project, wide=True),
                SessionCard.task_id == session_id,
            )
        )
    ).first()
    if row is None:
        return None
    card, name, author = row
    full = card.body if part == "summary" else await _conversation(db, session_id)
    page = full[offset : offset + PAGE_CHARS]
    end = offset + len(page)
    await _log(db, user_id, project, "read", None, 1, started)
    return Page(
        hit=Hit(
            session_id=card.task_id,
            project_name=name,
            author=_author(author),
            last_ts=card.last_ts,
            title=card.title,
            completed=card.completed,
            snippets=[],
        ),
        part=part,
        text=page,
        next_offset=end if end < len(full) else None,
    )


_SPEAKERS = {
    KIND_INTERVENTION: "User",
    KIND_COMPLETION_REPLY: "User",
    KIND_COMPLETION: "Result",
}


async def _conversation(db: AsyncSession, task_id: str) -> str:
    """The user's messages and the completion results in order, no tool output."""
    first = await db.scalar(
        select(TaskMessage.message_data)
        .where(TaskMessage.task_id == task_id)
        .order_by(TaskMessage.message_ts)
        .limit(1)
    )
    rows = await db.execute(
        select(TaskMessage.q_kind, TaskMessage.message_data)
        .where(
            TaskMessage.task_id == task_id,
            TaskMessage.q_kind.in_(list(_SPEAKERS)),
        )
        .order_by(TaskMessage.message_ts)
    )
    turns = [f"User: {_text(first)}"] if first else []
    turns += [f"{_SPEAKERS[kind]}: {_text(data)}" for kind, data in rows]
    return redact_secrets("\n\n".join(turns))


def _text(message_data: str) -> str:
    return json.loads(message_data).get("text") or ""


_BODY_WORD_RE = re.compile(r"[^\W_]+", re.UNICODE)


def snippets(body: str, terms: list[str]) -> list[str]:
    """Up to ``SNIPPETS`` windows of the body around words of the query, an
    identifier matching by its parts too."""
    if not terms:
        return []
    windows: list[tuple[int, int]] = []
    for match in _BODY_WORD_RE.finditer(body):
        found = words(match.group(0))
        if not any(w in terms for w in found):
            continue
        if windows and match.start() < windows[-1][1]:
            continue
        start = max(0, match.start() - SNIPPET_CHARS // 3)
        windows.append((start, min(len(body), start + SNIPPET_CHARS)))
        if len(windows) == SNIPPETS:
            break
    if not windows:
        return [body[:SNIPPET_CHARS]]
    return [
        ("..." if start else "") + body[start:end] + ("..." if end < len(body) else "")
        for start, end in windows
    ]


def _author(user: User | None) -> str:
    if user is None:
        return "unknown"
    return f"{user.first_name} {user.last_name}".strip() or user.email


def iso(ts_ms: int) -> str:
    return (
        datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z")
    )


async def _log(db, user_id, project, kind, query, hits, started) -> None:
    db.add(
        RecallLog(
            user_id=user_id,
            project_id=project.id,
            kind=kind,
            query=query,
            hits=hits,
            took_ms=int((time.monotonic() - started) * 1000),
            created_at=datetime.now(timezone.utc),
        )
    )
    await db.flush()
