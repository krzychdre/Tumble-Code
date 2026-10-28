"""Building session cards: the small, searchable summary of one task.

A card holds what a later session can use: the title, what was asked, what the
agent concluded (its completion results), the user's replies to them and the
files the run touched. Tool output and the rest of the conversation stay out.

Cards are built off the write path. The writes that change a card (a task's
first message, a completion, a reply to one, a backfill) queue the task in
``recall_dirty``; ``run_recall_loop`` rebuilds tasks idle for ``IDLE``, so a
running task is built once it settles rather than on every chunk. A task of a
project whose scope is ``none``, an excluded task and a task without a project
get no card, and an old one is deleted.
"""

import asyncio
import json
import logging
import re
from dataclasses import dataclass

import anyio
from datetime import datetime, timedelta, timezone

from sqlalchemy import (
    delete,
    func,
    insert as core_insert,
    literal,
    literal_column,
    select,
)
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import async_session_factory, dialect_insert
from src.models.project import SCOPE_NONE, Project
from src.models.recall import RecallDirty, SessionCard
from src.models.task import Task, TaskMessage
from src.services.anonymizer import redact_secrets
from src.services.recall_text import SIMPLE, document
from src.services.session_quality import KIND_COMPLETION, KIND_COMPLETION_REPLY

logger = logging.getLogger(__name__)

# The quality markers of the messages a card is built from.
CARD_KINDS = (KIND_COMPLETION, KIND_COMPLETION_REPLY)

IDLE = timedelta(minutes=10)
BATCH = 100
LOOP_SECONDS = 60

BODY_MAX = 6000
LAST_RESULT_MAX = 3000
EARLIER_RESULT_MAX = 500
REPLY_MAX = 500
PATHS_MAX = 50


async def mark_dirty(db: AsyncSession, task_id: str) -> None:
    """Queue the task's card for a rebuild once the task has been idle a while."""
    now = datetime.now(timezone.utc)
    insert = dialect_insert(db)
    await db.execute(
        insert(RecallDirty)
        .values(task_id=task_id, dirty_at=now)
        .on_conflict_do_update(index_elements=["task_id"], set_={"dirty_at": now})
    )


async def queue_project(db: AsyncSession, project_id: str) -> None:
    """Queue every task of the project, due at once (its scope left ``none``)."""
    due = datetime.now(timezone.utc) - IDLE
    insert = dialect_insert(db)
    await db.execute(
        insert(RecallDirty)
        .from_select(
            ["task_id", "dirty_at"],
            select(Task.id, literal(due)).where(Task.project_id == project_id),
        )
        .on_conflict_do_nothing(index_elements=["task_id"])
    )


async def drop_project_cards(db: AsyncSession, project_id: str) -> None:
    await db.execute(delete(SessionCard).where(SessionCard.project_id == project_id))


async def rebuild_due(db: AsyncSession) -> int:
    """Rebuild the cards of up to ``BATCH`` tasks idle for ``IDLE``; their count.

    The batch holds the tasks of every account, so each card is built inside
    a SAVEPOINT, as retention sweeps each user: a card that fails rolls back
    alone and leaves the queue, instead of failing the batch on every tick.
    """
    cutoff = datetime.now(timezone.utc) - IDLE
    task_ids = (
        (
            await db.execute(
                select(RecallDirty.task_id)
                .where(RecallDirty.dirty_at <= cutoff)
                .order_by(RecallDirty.dirty_at)
                .limit(BATCH)
            )
        )
        .scalars()
        .all()
    )
    for task_id in task_ids:
        try:
            async with db.begin_nested():
                await rebuild_card(db, task_id)
        except Exception:  # one task's card must not stop every other's
            logger.exception("[recall] card of task %s failed", task_id)
    await db.execute(delete(RecallDirty).where(RecallDirty.task_id.in_(task_ids)))
    return len(task_ids)


async def rebuild_card(db: AsyncSession, task_id: str) -> None:
    await db.execute(delete(SessionCard).where(SessionCard.task_id == task_id))
    row = (
        await db.execute(
            select(Task, Project)
            .join(Project, Project.id == Task.project_id)
            .where(Task.id == task_id)
        )
    ).first()
    if row is None:
        return
    task, project = row
    if project.recall_scope == SCOPE_NONE or task.recall_excluded:
        return

    messages = (
        await db.execute(
            select(TaskMessage.q_kind, TaskMessage.message_data)
            .where(
                TaskMessage.task_id == task_id,
                TaskMessage.q_kind.in_(CARD_KINDS),
            )
            .order_by(TaskMessage.message_ts)
        )
    ).all()
    paths = (
        (
            await db.execute(
                select(TaskMessage.tool_path)
                .where(
                    TaskMessage.task_id == task_id, TaskMessage.tool_path.is_not(None)
                )
                .group_by(TaskMessage.tool_path)
                .order_by(func.min(TaskMessage.message_ts))
                .limit(PATHS_MAX)
            )
        )
        .scalars()
        .all()
    )

    # Parsing every result and redacting the card is CPU work on text of any
    # size: off the event loop, which the bridge and every page share.
    title, sections = await anyio.to_thread.run_sync(
        _card_text,
        task.title or task.prompt_excerpt or "(untitled)",
        task.prompt_excerpt or "",
        list(messages),
        list(paths),
    )
    values = {
        "task_id": task.id,
        "tenant_id": project.tenant_id,
        "project_id": project.id,
        "author_id": task.user_id,
        "title": title,
        "body": sections.body,
        "search_vector": _search_vector(db, sections),
        "last_ts": task.last_ts or 0,
        "completed": task.q_completed,
        "is_subtask": task.parent_task_id is not None,
        "built_at": datetime.now(timezone.utc),
    }
    await db.execute(core_insert(SessionCard).values(**values))


def _card_text(
    raw_title: str, prompt: str, messages: list, paths: list[str]
) -> tuple[str, "CardSections"]:
    """The card's redacted title and sections from its stored rows (pure)."""
    results = [_text(data) for kind, data in messages if kind == KIND_COMPLETION]
    replies = [_text(data) for kind, data in messages if kind == KIND_COMPLETION_REPLY]
    title = redact_secrets(raw_title)
    sections = card_sections(
        title,
        prompt,
        results,
        replies,
        [path.split(":", 1)[-1] for path in paths],
    )
    return title, sections


@dataclass(frozen=True)
class CardSections:
    """The card's text by weight: A title, B results, C prompt and replies, D paths."""

    title: str
    results: str
    asked: str
    paths: str
    body: str


def card_sections(
    title: str, prompt: str, results: list[str], replies: list[str], paths: list[str]
) -> CardSections:
    """Lay the card out and cap it; secrets are redacted from every part."""
    shown_results = [r[:EARLIER_RESULT_MAX] for r in results[:-1]] + [
        r[:LAST_RESULT_MAX] for r in results[-1:]
    ]
    results_text = redact_secrets("\n\n".join(shown_results))
    asked_text = redact_secrets(
        "\n\n".join([prompt, *(r[:REPLY_MAX] for r in replies)]).strip()
    )
    paths_text = "\n".join(paths)
    parts = [title]
    if asked_text:
        parts.append(f"Asked:\n{asked_text}")
    if results_text:
        parts.append(f"Result:\n{results_text}")
    if paths_text:
        parts.append(f"Files:\n{paths_text}")
    body = "\n\n".join(parts)[:BODY_MAX]
    return CardSections(title, results_text, asked_text, paths_text, body)


def _search_vector(db: AsyncSession, s: CardSections):
    if db.bind.dialect.name != "postgresql":
        return document(" ".join([s.title, s.results, s.asked, s.paths]))
    # The configuration and the weight are written into the SQL: as bound
    # parameters they arrive as varchar, and setweight takes a "char".
    weighted = [
        func.setweight(
            func.to_tsvector(SIMPLE, document(text)), literal_column(f"'{weight}'")
        )
        for text, weight in (
            (s.title, "A"),
            (s.results, "B"),
            (s.asked, "C"),
            (s.paths, "D"),
        )
    ]
    vector = weighted[0]
    for part in weighted[1:]:
        vector = vector.op("||")(part)
    return vector


# What a stored message's text may hold and Postgres' text cannot: a NUL and a
# lone surrogate. The client sends the text as JSON, which escapes both.
_UNSTORABLE = re.compile("[\x00\ud800-\udfff]")


def _text(message_data: str) -> str:
    text = json.loads(message_data).get("text")
    return _UNSTORABLE.sub("", text) if isinstance(text, str) else ""


async def run_recall_loop() -> None:
    """Rebuild due cards every ``LOOP_SECONDS``, forever; a failure is logged
    and the next tick tries again (as in services/retention_scheduler)."""
    while True:
        await asyncio.sleep(LOOP_SECONDS)
        try:
            async with async_session_factory() as db:
                count = await rebuild_due(db)
                await db.commit()
            if count:
                logger.info("[recall] rebuilt %s session card(s)", count)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("[recall] card rebuild failed; will retry next tick")
