"""View-models for the task list: one row per task, and what hovering it says.

Every figure is read off the task row itself (see services/task_summary), so
building a page of rows never touches a conversation. A row that delegated
shows its whole run: itself plus every subtask beneath it.
"""

import textwrap
from typing import Optional

from src.models.task import Task
from src.services.model_attribution import models_badge
from src.services.session_quality import quality_of
from src.services.task_summary import DEFAULT_TITLE, duration_ms
from src.services.task_tree import Spend, subtree_size, subtree_spend
from src.utils.format import fmt_cost, fmt_duration, fmt_int, fmt_tokens, plural


def _workspace_label(path: str | None) -> str | None:
    """Compact project/worktree name for a badge: the last path segment.

    The full absolute path is kept for the tooltip/header so sibling worktrees
    that share a basename (e.g. two checkouts both named ``Roo-Code``) can still
    be told apart on hover. Handles both POSIX and Windows separators since the
    path is whatever the client's OS reported.
    """
    if not path:
        return None
    trimmed = path.replace("\\", "/").rstrip("/")
    if not trimmed:
        return None
    return trimmed.rsplit("/", 1)[-1] or trimmed


def _quality_fields(task: Task) -> dict:
    """Grade + the account it was derived from, for a list row or a tree entry.

    The reasons travel with the grade everywhere it is shown, so a badge is
    never a verdict the reader has to take on trust.
    """
    q = quality_of(task)
    return {
        "grade": q.grade,
        "grade_label": q.grade_label,
        "grade_title": "; ".join(q.reasons()),
    }


def _spend_fields(task: Task, tree: dict[str, list[Task]]) -> dict:
    """The tokens and cost cells, and the hover that explains them.

    A task that delegated shows what its whole run consumed: itself plus every
    subtask beneath it. Its own figures alone were the parent's share only, on
    the live corpus often a fraction of the run (a $0.1656 row whose two
    subtasks cost $1.2434 more). The cells are marked as sums and their hover
    splits them into this task and its subtasks; a task with no subtasks shows
    its own figures, unmarked, as before.
    """
    own = Spend.of(task)
    total = subtree_spend(tree, task)
    subtasks = subtree_size(tree, task.id)
    fields = {
        "tokens": fmt_tokens(total.tokens) if total.tokens else None,
        "cost": fmt_cost(total.cost) if total.cost > 0 else None,
        "rollup": subtasks > 0,
        "tokens_title": None,
        "cost_title": None,
        # The prompt the run started from, then its figures: the one thing a
        # row 100 characters wide cannot show.
        "hover_title": _row_tooltip(task, total if subtasks else None, subtasks),
    }
    if subtasks:
        rest = total - own
        where = plural(subtasks, "subtask")
        fields["tokens_title"] = (
            f"{fmt_int(total.tokens)} tokens for the run: {fmt_int(own.tokens)} this task"
            f" + {fmt_int(rest.tokens)} in {where}"
        )
        fields["cost_title"] = (
            f"{fmt_cost(total.cost)} for the run: {fmt_cost(own.cost)} this task"
            f" + {fmt_cost(rest.cost)} in {where}"
        )
    return fields


def _list_row(task: Task, tree: dict[str, list[Task]], nest: bool) -> dict:
    """View-model for one row of the task list.

    With ``nest`` the row carries its subtasks as rows of their own, so the run
    view renders the whole delegation tree under each run. The flat view lists
    subtasks as ordinary rows instead, so nesting them there would show each
    one twice.
    """
    kids = tree.get(task.id, [])
    span = duration_ms(task.first_ts, task.last_ts)
    return {
        "id": task.id,
        "title": task.title or DEFAULT_TITLE,
        "message_count": task.message_count or 0,
        "updated_at": task.updated_at,
        "duration": fmt_duration(span) if span else None,
        **_spend_fields(task, tree),
        "workspace": task.workspace_path,
        "workspace_label": _workspace_label(task.workspace_path),
        # Read straight off the row: the list must never parse an event
        # payload per task (see services/model_attribution).
        "models": models_badge(task.models),
        "child_count": len(kids),
        # What "include their subtasks" adds to a bulk delete: the whole
        # subtree, because that is what the delete removes, not only the
        # direct children the pill counts.
        "descendant_count": subtree_size(tree, task.id),
        "is_subtask": task.parent_task_id is not None,
        "children": [_list_row(kid, tree, nest) for kid in kids] if nest else [],
        **_quality_fields(task),
    }


# A native tooltip does not wrap, so a paragraph-long excerpt would render as
# one line wider than the screen. Wrapped here rather than at write time: the
# stored excerpt stays raw text, and the width is a rendering decision.
_PROMPT_WRAP_COLS = 78
_PROMPT_WRAP_LINES = 14


def _wrap_prompt(prompt: Optional[str]) -> list[str]:
    """Lay the stored excerpt out for a fixed-width tooltip.

    Each authored line is wrapped in place (so a bulleted brief keeps its
    bullets), and the whole thing is capped in height - an excerpt of 30 short
    lines is within the character cap but taller than the hover should be.
    """
    if not prompt:
        return []
    lines: list[str] = []
    for line in prompt.splitlines():
        if not line.strip():
            lines.append("")
            continue
        # break_on_hyphens off: a URL or a kebab-case path is one token to a
        # reader, and "local-inference-\nlab/..." reads as a hyphenation that
        # isn't there. Long words are still broken - a 1000-character token with
        # no whitespace has to be bounded somehow.
        lines.extend(
            textwrap.wrap(line, width=_PROMPT_WRAP_COLS, break_on_hyphens=False) or [""]
        )
        if len(lines) > _PROMPT_WRAP_LINES:
            break
    if len(lines) > _PROMPT_WRAP_LINES:
        lines = lines[:_PROMPT_WRAP_LINES]
        if not lines[-1].endswith("…"):
            # Room made for the mark rather than taken: a full-width last line
            # plus an ellipsis is the one line that would exceed the column.
            lines[-1] = lines[-1][: _PROMPT_WRAP_COLS - 1].rstrip() + "…"
    return lines


def _metrics_tooltip(task: Task) -> list[str]:
    """The token/cost breakdown, one figure per line.

    Reads the denormalized columns on the task row - the whole point of
    services/task_summary is that the list never re-derives these.
    """
    lines = [
        f"↑ In: {fmt_int(task.tokens_in)}",
        f"↓ Out: {fmt_int(task.tokens_out)}",
    ]
    if task.cache_writes or task.cache_reads:
        lines.append(f"⚡ Cache: {fmt_int(task.cache_writes)} write / {fmt_int(task.cache_reads)} read")
    span = duration_ms(task.first_ts, task.last_ts)
    if span:
        lines.append(f"⏱ Session: {fmt_duration(span)}")
    lines.append(f"$ Cost: {fmt_cost(task.cost)}")
    return lines


def _run_tooltip(total: Spend, subtasks: int) -> list[str]:
    """The same breakdown for a task together with its subtasks."""
    lines = [
        f"Σ With its {plural(subtasks, 'subtask')}",
        f"↑ In: {fmt_int(total.tokens_in)}",
        f"↓ Out: {fmt_int(total.tokens_out)}",
    ]
    if total.cache_writes or total.cache_reads:
        lines.append(f"⚡ Cache: {fmt_int(total.cache_writes)} write / {fmt_int(total.cache_reads)} read")
    lines.append(f"$ Cost: {fmt_cost(total.cost)}")
    return lines


def _row_tooltip(task: Task, total: Optional[Spend] = None, subtasks: int = 0) -> Optional[str]:
    """What hovering a task row says: the request, then what it cost.

    The prompt leads because it is the thing the row cannot show - the title
    column carries only its first line, cut at 100 characters. Both halves come
    off the task row itself, so this costs the list nothing (native title
    tooltips honour the newlines).

    With ``total`` (the task and its ``subtasks`` together) the task's own
    figures are headed as such and the run's follow, so the hover accounts for
    the sum the row shows.

    ``None`` when there is neither an excerpt nor a figure to report, so the
    row gets no empty tooltip.
    """
    blocks = []
    prompt = _wrap_prompt(task.prompt_excerpt)
    if prompt:
        blocks.append("\n".join(prompt))
    if (task.tokens_in or 0) or (task.tokens_out or 0) or (task.cost or 0):
        own = _metrics_tooltip(task)
        blocks.append("\n".join(["This task", *own] if total else own))
    if total and (total.tokens or total.cost):
        blocks.append("\n".join(_run_tooltip(total, subtasks)))
    return "\n\n".join(blocks) or None

