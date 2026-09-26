"""Seeding and request helpers shared by the web panel and share pipeline tests.

They lived in test_web_and_share.py until that file was split by page
(CAPI-M5); several other test modules use them too.
"""

import json

from sqlalchemy import select

from src.dependencies import get_current_user
from src.auth.web_session import get_web_user_optional, WebUser
from src.models.user import User
from src.models.task import TaskMessage
from src.models.event import TelemetryEvent


async def _seed_user(db_session, user_id="user_test", email="t@example.com"):
    user = User(
        id=user_id,
        authentik_id=f"ak_{user_id}",
        email=email,
        first_name="Test",
        last_name="User",
    )
    db_session.add(user)
    await db_session.commit()
    return user


def _override_current_user(client_app, user_id="user_test"):
    client_app.dependency_overrides[get_current_user] = lambda: {
        "user_id": user_id,
        "org_id": None,
    }


def _override_web_user(client_app, user_id="user_test", email="t@example.com"):
    web_user: WebUser = {
        "user_id": user_id,
        "session_id": "sess_test",
        "email": email,
        "name": "Test User",
        "image_url": None,
    }
    client_app.dependency_overrides[get_web_user_optional] = lambda: web_user


def _msgs():
    return [
        {"ts": 1, "type": "say", "say": "text", "text": "Build me a feature"},
        {"ts": 2, "type": "say", "say": "reasoning", "text": "thinking..."},
        {"ts": 3, "type": "say", "say": "completion_result", "text": "Done"},
    ]


async def _add_message(session, task_id: str, message: dict) -> None:
    """Insert one message the way the real write path does.

    Production never stores a TaskMessage without also recording the token/cost
    figures it contributes (services/task_summary.message_metrics) - the task
    list reads those columns instead of re-parsing the conversation. A bare
    ``session.add(TaskMessage(...))`` would leave them at zero, so tests that
    took that shortcut would assert against a state production never produces.
    """
    from src.services.task_summary import message_metrics

    session.add(
        TaskMessage(
            task_id=task_id,
            message_data=json.dumps(message),
            message_ts=message.get("ts"),
            **message_metrics(message).as_columns(),
        )
    )


async def _summarize(session, *task_ids: str) -> None:
    """Roll the seeded messages up onto their task rows.

    The counterpart of the refresh that ``backfill_messages`` /
    ``upsert_task_message`` perform after every write.
    """
    from src.services.task_summary import derive_prompt, derive_title, refresh_task_summary

    await session.flush()
    for task_id in task_ids:
        rows = await session.execute(
            select(TaskMessage.message_data).where(TaskMessage.task_id == task_id)
        )
        messages = []
        for (payload,) in rows.all():
            try:
                parsed = json.loads(payload)
            except (json.JSONDecodeError, TypeError):
                continue
            if isinstance(parsed, dict):
                messages.append(parsed)
        messages.sort(key=lambda m: m.get("ts") or 0)
        await refresh_task_summary(
            session,
            task_id,
            title=derive_title(messages),
            prompt=derive_prompt(messages),
            force_title=True,
        )


def _backfill_files(task_id, messages):
    return {
        "file": ("task.json", json.dumps(messages), "application/json"),
    }, {"taskId": task_id, "properties": "{}"}


def _llm_event(
    user_id="user_test",
    *,
    model="modelX",
    mode="code",
    provider="openrouter",
    task_id="task-a",
    tin=1000,
    tout=200,
    cread=0,
    cwrite=0,
    cost=0.01,
    created_at=None,
    kind=None,
    usage_reported=None,
):
    """Build an ``LLM Completion`` telemetry row mirroring the extension payload."""
    from datetime import datetime, timezone

    props = {
        "mode": mode,
        "apiProvider": provider,
        "modelId": model,
        "taskId": task_id,
        "inputTokens": tin,
        "outputTokens": tout,
        "cacheReadTokens": cread,
        "cacheWriteTokens": cwrite,
        "cost": cost,
        # Absent by default: every row recorded before the extension reported
        # which part of it made the call is a conversation turn.
        **({"completionKind": kind} if kind is not None else {}),
        **({"usageReported": usage_reported} if usage_reported is not None else {}),
    }
    return TelemetryEvent(
        user_id=user_id,
        organization_id=None,
        event_type="LLM Completion",
        # Stamped exactly as services/telemetry_service.record_event does: the
        # column is the indexed join key, the blob stays authoritative.
        task_id=task_id,
        properties=json.dumps(props),
        created_at=created_at or datetime.now(timezone.utc),
    )


async def _backfill(client, task_id, messages):
    files, data = _backfill_files(task_id, messages)
    resp = client.post("/api/events/backfill", files=files, data=data)
    assert resp.status_code == 200
