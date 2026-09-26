"""View-models for the task page: the spend table, the quality panel, the tree
around the task, and the conversation with what answered it.

The shared-link page renders the same template, so it uses these too.
"""

import json
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.task import Task, TaskMessage
from src.services.model_attribution import (
    attribute_requests,
    completions_for_task,
    models_label,
    models_summary,
    side_calls_summary,
)
from src.services.session_quality import quality_of
from src.services.task_summary import DEFAULT_TITLE, duration_ms
from src.services.task_tree import Spend, subtree_size, subtree_spend
from src.utils.format import fmt_cost, fmt_duration, fmt_int, fmt_tokens, plural
from src.utils.json_script import json_for_script
from src.web.presenters.task_rows import _quality_fields, _spend_fields


def _quality_panel(task: Task) -> dict:
    """Every quality signal for one task, for the detail page.

    Efficiency figures sit alongside the friction counts because they answer the
    other half of "how did this go?": tokens per turn and how much of the input
    came from cache are what separate an expensive run from a wasteful one.
    """
    q = quality_of(task)
    tokens_in = task.tokens_in or 0
    cache_reads = task.cache_reads or 0
    # `cacheReads` is a subset of `tokensIn` in every payload this deployment has
    # stored (0 of 13 164 completions exceed it; the highest task-level ratio is
    # 98%), so the share is taken over the input. Clamped anyway: the figures
    # come from whichever provider the client used, and a share above 100% would
    # be a nonsense number presented with full confidence.
    cache_share = min(100, round(100 * cache_reads / tokens_in)) if tokens_in else None
    per_request = round(tokens_in / q.requests) if q.requests else None
    return {
        "grade": q.grade,
        "grade_label": q.grade_label,
        "reasons": q.reasons(),
        "signals": [
            {"label": "Turns", "value": q.requests, "tone": "neutral"},
            {"label": "Tool calls", "value": q.tools, "tone": "neutral"},
            {"label": "Your corrections", "value": q.interventions, "tone": "bad"},
            {"label": "Replies to a result", "value": q.completion_replies, "tone": "neutral"},
            {"label": "Errors", "value": q.errors, "tone": "bad"},
            {"label": "Provider retries", "value": q.retries, "tone": "bad"},
            {"label": "Context condensed", "value": q.condense, "tone": "warn"},
            {"label": "Repeated tool calls", "value": q.repeated_work, "tone": "warn"},
        ],
        "efficiency": [
            {"label": "Tokens / turn", "value": fmt_int(per_request) if per_request else "\u2014"},
            {"label": "From cache", "value": f"{cache_share}%" if cache_share is not None else "\u2014"},
            {
                "label": "Cost / turn",
                "value": fmt_cost(task.cost / q.requests) if q.requests and task.cost else "\u2014",
            },
        ],
    }


def _tree_entry(task: Task, tree: Optional[dict[str, list[Task]]] = None) -> dict:
    """Compact view-model for a task shown as somebody else's relative.

    Used by the breadcrumb and the subtask panel, where a task appears as a link
    with its own headline figures rather than as a full list row. Given the
    tree beneath it, a subtask that delegated further shows its run's figures,
    the same as it would as a list row.
    """
    span = duration_ms(task.first_ts, task.last_ts)
    return {
        "id": task.id,
        "title": task.title or DEFAULT_TITLE,
        "message_count": task.message_count or 0,
        "duration": fmt_duration(span) if span else None,
        # Same hover as a list row: a subtask's title is the least informative
        # of all, since a delegated run is usually named by one instruction.
        **_spend_fields(task, tree or {}),
        **_quality_fields(task),
    }


def _tree_entries(tree: dict[str, list[Task]], task_id: str) -> list[dict]:
    """The subtasks beneath ``task_id`` as nested tree entries, oldest first."""
    return [
        {**_tree_entry(child, tree), "children": _tree_entries(tree, child.id)}
        for child in tree.get(task_id, [])
    ]


def _spend_row(key: str, label: str, spend: Spend) -> dict:
    return {
        "key": key,
        "label": label,
        "tokens": fmt_tokens(spend.tokens),
        "tokens_in": fmt_tokens(spend.tokens_in),
        "tokens_out": fmt_tokens(spend.tokens_out),
        "cost": fmt_cost(spend.cost),
    }


def _spend_summary(task: Task, tree: dict[str, list[Task]]) -> dict:
    """The task page's one account of what was spent: the run, then its parts.

    The page used to show three kinds of figure with nothing saying which: the
    header was this task's own conversation ($0.1656 on the ADO run), the
    subtask panel's header the whole run ($1.4090), the quality panel's cost per
    turn this task again. The list shows the run. So the top of the page now
    states the run as the list does and splits it into this task and its
    subtasks; every other figure on the page is visibly one of those parts.

    A task with no subtasks is its own run: one row. ``subtasks`` is what the
    live header adds to this task's live figures to keep the run row current.
    """
    own = Spend.of(task)
    count = subtree_size(tree, task.id)
    if not count:
        return {"rows": [_spend_row("own", "this task", own)], "subtasks": None}
    total = subtree_spend(tree, task)
    rest = total - own
    return {
        "rows": [
            _spend_row("run", "whole run", total),
            _spend_row("own", "this task", own),
            _spend_row("subtasks", plural(count, "subtask"), rest),
        ],
        "subtasks": rest,
    }



def _parse_messages(rows: list[TaskMessage]) -> list[dict]:
    """Decode and sort stored TaskMessage rows into ClineMessage dicts."""
    parsed: list[dict] = []
    for row in rows:
        try:
            data = json.loads(row.message_data)
        except (json.JSONDecodeError, TypeError):
            continue
        if isinstance(data, dict):
            parsed.append(data)
    parsed.sort(key=lambda m: m.get("ts", 0))
    return parsed


async def _model_context(
    db: AsyncSession, task_id: str, owner_id: Optional[str], messages: list[dict]
) -> dict:
    """What answered, for one conversation: the rollup and the per-request map.

    Both come from the same indexed read of the task's ``LLM Completion``
    events, because the stored conversation cannot say it - see
    services/model_attribution. The map goes to the browser as its own JSON
    island keyed by message ``ts``: the ``api_req_started`` payload is a
    verbatim copy of what the client sent, and derived data is not written back
    into it.
    """
    completions = await completions_for_task(db, task_id, owner_id)
    return {
        "models": models_summary(completions),
        "models_label": models_label(completions),
        # Condensing, prompt enhancement and memory recall: real requests on
        # real models that are not turns, so they are named apart from the
        # conversation rather than mixed into it.
        "side_calls": side_calls_summary(completions),
        "request_models_json": json_for_script(attribute_requests(messages, completions)),
    }


async def _load_task_messages(db: AsyncSession, task_id: str) -> list[dict]:
    result = await db.execute(
        select(TaskMessage).where(TaskMessage.task_id == task_id)
    )
    return _parse_messages(list(result.scalars().all()))
