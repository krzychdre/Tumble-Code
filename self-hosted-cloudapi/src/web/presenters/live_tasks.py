"""The task list's live side: what each row's state is, and the "Needs your
attention" strip of the reader's tasks that run or wait on them.

The live part comes from the bridge's in-memory snapshots
(realtime/hub.ConnectionRegistry.live_tasks), the rest from the task rows.
"""

import json
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.task import Task
from src.realtime.hub import LIVE_RUNNING, LIVE_WAITING, live_state
from src.services.model_attribution import models_badge
from src.services.session_quality import GRADE_UNFINISHED
from src.services.task_summary import DEFAULT_TITLE
from src.utils.format import fmt_cost

# A row's state: one of these, each with its colour in app.css ([data-state]).
STATE_UNFINISHED = "unfinished"
STATE_DONE = "done"

LIVE_LABELS = {LIVE_WAITING: "Waiting for you", LIVE_RUNNING: "Working"}

_SUMMARY_MAX = 160


def rest_state(grade: str) -> str:
    """A row's state while it is not live: what its grade says."""
    return STATE_UNFINISHED if grade == GRADE_UNFINISHED else STATE_DONE


def live_states(snapshots: dict[str, dict]) -> dict[str, str]:
    """Task id -> running or waiting, from the registry's live snapshots."""
    return {task_id: live_state(s) for task_id, s in snapshots.items()}


def _clip(text: str) -> str:
    text = " ".join(text.split())
    return text if len(text) <= _SUMMARY_MAX else text[: _SUMMARY_MAX - 1] + "…"


def _payload(ask: dict) -> dict:
    """The JSON an ask carries, or {} for one that is plain text."""
    try:
        value = json.loads(ask.get("text") or "")
    except ValueError:
        return {}
    return value if isinstance(value, dict) else {}


def _question(data: dict, text: str) -> str:
    return f"Question: “{data.get('question') or text}”"


def _command(data: dict, text: str) -> str:
    return f"Approve command: {text}"


def _mcp(data: dict, text: str) -> str:
    what = " · ".join(
        str(v) for v in (data.get("serverName"), data.get("toolName")) if v
    )
    return f"Approve MCP: {what or text}"


def _tool(data: dict, text: str) -> str:
    what = " ".join(str(v) for v in (data.get("tool"), data.get("path")) if v)
    return f"Approve tool: {what or text}"


def _fixed(line: str):
    return lambda data, text: line


# Ask kind -> (its summary line, the button that leads to it); one row per
# hub.WAITING_ASKS entry.
_ASK_SUMMARY = {
    "followup": (_question, "Answer"),
    "command": (_command, "Review"),
    "use_mcp_server": (_mcp, "Review"),
    "tool": (_tool, "Review"),
    "api_req_failed": (_fixed("The API request failed: retry?"), "Review"),
    "mistake_limit_reached": (
        _fixed("The model keeps failing: proceed or guide it"),
        "Review",
    ),
    "auto_approval_max_req_reached": (
        _fixed("Auto-approved request limit reached"),
        "Review",
    ),
}


def _ask_summary(ask: dict) -> tuple[str, str]:
    """What a pending ask asks for, and the button that leads to it."""
    line, action = _ASK_SUMMARY[ask["ask"]]
    return _clip(line(_payload(ask), ask.get("text") or "")), action


def _running_summary(snapshot: dict, task: Task) -> str:
    usage = snapshot.get("tokenUsage")
    cost = usage.get("totalCost") if isinstance(usage, dict) else None
    if not isinstance(cost, (int, float)):
        cost = task.cost
    badge = models_badge(task.models)
    parts = [
        f"{snapshot['mode']} mode" if snapshot.get("mode") else None,
        badge["name"] if badge else None,
        fmt_cost(cost) if cost else None,
    ]
    return " · ".join(p for p in parts if p)


async def attention_items(
    db: AsyncSession, user_id: str, snapshots: dict[str, dict]
) -> list[dict]:
    """The strip's cards: tasks waiting on the reader first, then running
    ones, newest first within each. A live task with no row yet is left out."""
    if not snapshots:
        return []
    tasks = await db.scalars(
        select(Task).where(Task.id.in_(list(snapshots)), Task.user_id == user_id)
    )
    items = []
    for task in tasks.all():
        snapshot = snapshots[task.id]
        state = live_state(snapshot)
        if state == LIVE_WAITING:
            summary, action = _ask_summary(snapshot["currentAsk"])
        else:
            summary, action = _running_summary(snapshot, task), "Open"
        items.append(
            {
                "id": task.id,
                "title": task.title or DEFAULT_TITLE,
                "state": state,
                "label": LIVE_LABELS[state],
                "summary": summary,
                "action": action,
                "updated_at": task.updated_at,
            }
        )
    items.sort(key=lambda i: i["updated_at"], reverse=True)
    items.sort(key=lambda i: i["state"] != LIVE_WAITING)
    return items
