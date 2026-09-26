"""Characterization of the metrics page computation (CAPI-M9).

CAPI-M9 step 1 changes *how* the metrics page reads its rows (only the columns
it needs, plus an index on ``telemetry_events (user_id, event_type,
created_at)``), not *what* it computes. These tests pin the whole result of
``compute_user_metrics()`` and of the quality overview for one seeded dataset,
so any drift in the output shows up as a diff against a literal.

The dataset carries every kind of row the aggregation has to cope with:
malformed payloads (bad JSON, JSON that is not an object, NULL, an empty
object), missing fields, non-numeric and boolean numbers, other event types,
other users, rows outside the period, side-call kinds and a completion whose
usage was not reported. The golden values live in
tests/fixtures/metrics_characterization.json.
"""

import json
from pathlib import Path
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import event

from src.models.event import TelemetryEvent
from src.models.task import Task
from src.models.user import User
from src.routers.web import _quality_overview
from src.services.metrics_service import compute_user_metrics

NOW = datetime(2026, 9, 20, 12, 0, tzinfo=timezone.utc)
USER = "user_m9"
OTHER = "user_other"
# Only malformed completions: nothing to count, yet the page has "data".
BROKEN = "user_broken"
GOLDEN_FILE = Path(__file__).parent / "fixtures" / "metrics_characterization.json"


def _ago(**kwargs) -> datetime:
    return NOW - timedelta(**kwargs)


def _completion(props, created_at, user_id=USER, event_type="LLM Completion"):
    payload = props if isinstance(props, str) or props is None else json.dumps(props)
    return TelemetryEvent(
        user_id=user_id,
        event_type=event_type,
        properties=payload,
        created_at=created_at,
    )


def _props(model, mode, provider, task_id, tin, tout, cost, **extra):
    props = {
        "modelId": model,
        "mode": mode,
        "apiProvider": provider,
        "taskId": task_id,
        "inputTokens": tin,
        "outputTokens": tout,
        "cost": cost,
    }
    props.update(extra)
    return props


def _events() -> list[TelemetryEvent]:
    return [
        # --- valid completions inside every period -------------------------
        _completion(
            _props("glm-5", "code", "zai", "t1", 1000, 200, 0.5, cacheReadTokens=300, cacheWriteTokens=40),
            _ago(hours=2),
        ),
        _completion(
            _props("glm-5", "code", "zai", "t1", 2000, 100, 0.25, ts=1_758_000_000_000),
            _ago(hours=1),
        ),
        _completion(
            _props("qwen-3", "architect", "openai", "t2", 500, 50, 0.0, completionKind="condense"),
            _ago(days=1, hours=3),
        ),
        _completion(
            _props("qwen-3", "ask", "openai", "t2", 300, 30, 0.125, completionKind="memory", usageReported=False),
            _ago(days=2),
        ),
        # Missing fields: every dimension reads "unknown", every number 0.
        _completion({"taskId": "t3"}, _ago(days=3)),
        # Wrong types: strings and booleans are not numbers.
        _completion(
            _props("glm-5", "code", "zai", "t3", "900", True, "1.5", cacheReadTokens=False),
            _ago(days=3, hours=1),
        ),
        # Client timestamp given as a float, and one as a bool (ignored).
        _completion(
            _props("glm-5", "debug", "zai", "t4", 40, 4, 0.01, timestamp=1_758_100_000_500.0),
            _ago(days=5),
        ),
        _completion(
            _props("glm-5", "debug", "zai", "t4", 60, 6, 0.02, completedAt=True),
            _ago(days=5, hours=2),
        ),
        # Empty object: a completion with no properties still counts.
        _completion("{}", _ago(days=6)),
        # NULL payload reads as {} as well.
        _completion(None, _ago(days=6, hours=1)),
        # --- malformed payloads: skipped, but they still make has_data true ---
        _completion("{not json", _ago(hours=5)),
        _completion("[1, 2, 3]", _ago(hours=6)),
        _completion("42", _ago(hours=7)),
        _completion('"a string"', _ago(hours=8)),
        # --- only in 30d / all ---------------------------------------------
        _completion(
            _props("claude", "code", "anthropic", "t5", 7000, 700, 1.75, completionKind="enhance"),
            _ago(days=12),
        ),
        _completion(_props("claude", "orchestrator", "anthropic", None, 100, 10, 0.05), _ago(days=20)),
        # --- only in all ------------------------------------------------------
        _completion(_props("old-model", "code", "zai", "t6", 123_456, 7_890, 3.0), _ago(days=200)),
        _completion(_props("old-model", "code", "zai", "t6", 1, 1, 0.0), _ago(days=199)),
        # --- never counted ------------------------------------------------------
        _completion(_props("glm-5", "code", "zai", "t1", 99_999, 9_999, 99.0), _ago(hours=1), user_id=OTHER),
        _completion(_props("glm-5", "code", "zai", "t1", 88_888, 8_888, 88.0), _ago(hours=1), event_type="Task Message"),
        _completion(_props("glm-5", "code", "zai", "t1", 77_777, 7_777, 77.0), _ago(hours=1), event_type="Tool Used"),
        # --- embeddings ---------------------------------------------------------
        _completion({"promptTokens": 5000, "source": "index-scan"}, _ago(hours=3), event_type="Embedding Usage"),
        _completion({"promptTokens": 700, "source": "search"}, _ago(days=2), event_type="Embedding Usage"),
        _completion({"promptTokens": "12"}, _ago(days=4), event_type="Embedding Usage"),
        _completion("{bad", _ago(days=4), event_type="Embedding Usage"),
        _completion({"promptTokens": 40_000, "source": "index-scan"}, _ago(days=40), event_type="Embedding Usage"),
        _completion({"promptTokens": 9_999, "source": "index-scan"}, _ago(hours=3), user_id=OTHER, event_type="Embedding Usage"),
    ]


def _broken_events() -> list[TelemetryEvent]:
    return [
        _completion("{not json", _ago(hours=1), user_id=BROKEN),
        _completion("[]", _ago(hours=2), user_id=BROKEN),
        _completion("null", _ago(hours=3), user_id=BROKEN),
    ]


def _task(task_id, user_id=USER, *, updated, title=None, parent=None, completed=True, **q):
    return Task(
        id=task_id,
        user_id=user_id,
        title=title,
        prompt_excerpt="a long opening prompt " * 20,
        workspace_path="/work/space",
        parent_task_id=parent,
        updated_at=updated,
        q_completed=completed,
        **{f"q_{key}": value for key, value in q.items()},
    )


def _tasks() -> list[Task]:
    """Runs for the quality overview. The period bound there is the real clock
    (``_quality_overview`` takes no ``now``), so "recent" is an hour ago and
    "old" is years back."""
    recent = datetime.now(timezone.utc) - timedelta(hours=1)
    old = datetime(2020, 1, 1, tzinfo=timezone.utc)
    tasks = [
        _task("q-clean", updated=recent, title="Clean run", requests=3, tools=5),
        # No title, and enough friction to be listed: shown under the default title.
        _task("q-untitled", updated=recent, requests=1, errors=19),
        _task("q-unfinished", updated=recent, title="Never done", completed=False, requests=2, errors=1),
        _task("q-replied", updated=recent, title="Replied to", requests=4, completion_replies=2),
        _task(
            "q-rough",
            updated=recent,
            title="Rough run",
            requests=9,
            errors=2,
            retries=3,
            interventions=1,
            condense=1,
            tool_paths=10,
            distinct_tool_paths=6,
        ),
        _task("q-old", updated=old, title="Old run", requests=1, errors=5),
        # Excluded everywhere: a subtask and another user's run.
        _task("q-sub", updated=recent, title="Subtask", parent="q-rough", errors=50),
        _task("q-foreign", OTHER, updated=recent, title="Not mine", errors=40),
    ]
    # More friction runs than the overview lists (it keeps 8), each with a
    # distinct count so the ranking has no ties to order arbitrarily. With
    # q-untitled (19) and q-rough (11) these fill the 8 places; q-low (3) and,
    # in all time, q-old (5) are cut.
    for n in range(1, 7):
        tasks.append(_task(f"q-f{n}", updated=recent, title=f"Friction {n}", retries=n + 11))
    tasks.append(_task("q-low", updated=recent, title="Low friction", retries=3))
    return tasks


@pytest.fixture
async def seeded(db_session):
    db_session.add_all(
        [
            User(id=USER, authentik_id="ak_m9", email="m9@example.com"),
            User(id=OTHER, authentik_id="ak_other", email="other@example.com"),
            User(id=BROKEN, authentik_id="ak_broken", email="broken@example.com"),
        ]
    )
    await db_session.commit()
    db_session.add_all(_events() + _broken_events())
    db_session.add_all(_tasks())
    await db_session.commit()
    return db_session


GOLDEN = json.loads(GOLDEN_FILE.read_text()) if GOLDEN_FILE.exists() else {}


async def _all_metrics(db) -> dict:
    return {
        period: await compute_user_metrics(db, USER, period=period, now=NOW)
        for period in ("today", "7d", "30d", "90d", "all")
    }


async def _all_quality(db) -> dict:
    return {period: await _quality_overview(db, USER, period) for period in ("7d", "all")}


async def test_metrics_result_is_pinned_for_every_period(seeded):
    assert await _all_metrics(seeded) == GOLDEN["metrics"]


async def test_unknown_period_falls_back_to_the_default(seeded):
    got = await compute_user_metrics(seeded, USER, period="nonsense", now=NOW)
    assert got == GOLDEN["metrics"]["7d"]


async def test_only_malformed_rows_count_nothing_but_still_have_data(seeded):
    got = await compute_user_metrics(seeded, BROKEN, period="all", now=NOW)
    assert got["totals"]["completions"] == 0
    assert got["by_model"] == []
    assert got["has_data"] is True


async def test_a_user_without_rows_has_no_data(seeded):
    got = await compute_user_metrics(seeded, "user_nobody", period="all", now=NOW)
    assert got["has_data"] is False
    assert got["totals"]["completions"] == 0
    assert got["embeddings"]["has_data"] is False


async def test_quality_overview_is_pinned(seeded):
    assert await _all_quality(seeded) == GOLDEN["quality"]


async def test_quality_overview_without_runs_has_no_data(seeded):
    assert await _quality_overview(seeded, "user_nobody", "all") == {"has_data": False}


# --- what the queries read (CAPI-M9 step 1) ------------------------------------


@pytest.fixture
def captured_sql(seeded):
    statements: list[str] = []

    def _capture(conn, cursor, statement, parameters, context, executemany):
        statements.append(" ".join(statement.split()))

    engine = seeded.bind.sync_engine
    event.listen(engine, "before_cursor_execute", _capture)
    yield statements
    event.remove(engine, "before_cursor_execute", _capture)


def _selected_columns(statement: str, table: str) -> set[str]:
    head = statement.split(" FROM ", 1)[0].removeprefix("SELECT ")
    return {part.strip().removeprefix(f"{table}.") for part in head.split(",")}


async def test_metrics_read_only_the_columns_they_use(seeded, captured_sql):
    """No full TelemetryEvent entity: the id, user, organization, type and
    task columns are dead weight for the aggregation."""
    await compute_user_metrics(seeded, USER, period="all", now=NOW)

    reads = [s for s in captured_sql if "FROM telemetry_events" in s]
    assert len(reads) == 2, reads
    completions, embeddings = reads
    assert _selected_columns(completions, "telemetry_events") == {"properties", "created_at"}
    assert _selected_columns(embeddings, "telemetry_events") == {"properties"}


async def test_quality_overview_reads_only_the_columns_it_uses(seeded, captured_sql):
    """Not the whole Task row (prompt excerpt, workspace path, token totals...)."""
    await _quality_overview(seeded, USER, "all")

    reads = [s for s in captured_sql if "FROM tasks" in s]
    assert len(reads) == 1, reads
    assert _selected_columns(reads[0], "tasks") == {
        "id",
        "title",
        "q_requests",
        "q_errors",
        "q_retries",
        "q_interventions",
        "q_completion_replies",
        "q_condense",
        "q_tools",
        "q_tool_paths",
        "q_distinct_tool_paths",
        "q_completed",
    }


def test_telemetry_events_has_the_metrics_index():
    """The metrics queries filter on user and event type and range on
    created_at; one composite index serves all three."""
    indexes = {
        tuple(column.name for column in index.columns)
        for index in TelemetryEvent.__table__.indexes
    }
    assert ("user_id", "event_type", "created_at") in indexes
