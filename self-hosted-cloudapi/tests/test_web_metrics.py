"""The metrics page (/app/metrics) and the session-quality grading behind it.

Split out of test_web_and_share.py (CAPI-M5); the sections are unchanged.
"""

import json

from sqlalchemy import select

from src.dependencies import get_current_user
from src.auth.web_session import get_web_user_optional
from src.models.task import Task
from src.services.metrics_service import compute_user_metrics

from tests.web_helpers import (
    _seed_user,
    _override_current_user,
    _override_web_user,
    _add_message,
    _summarize,
    _llm_event,
    _backfill,
)


# --- Metrics page ----------------------------------------------------------


async def test_metrics_redirects_to_login_without_session(client):
    resp = client.get("/app/metrics", follow_redirects=False)
    assert resp.status_code == 303
    assert resp.headers["location"] == "/app/login"


async def test_compute_user_metrics_aggregates_dimensions(db_session):
    """Totals, breakdowns and per-task duration aggregate from LLM Completion events."""
    from datetime import datetime, timezone, timedelta

    await _seed_user(db_session)
    base = datetime(2026, 6, 21, 12, 0, tzinfo=timezone.utc)
    db_session.add_all(
        [
            _llm_event(model="gpt-a", mode="code", task_id="t1", tin=1000, tout=200,
                       cwrite=50, cread=10, cost=0.02, created_at=base),
            _llm_event(model="gpt-a", mode="code", task_id="t1", tin=500, tout=100,
                       cost=0.01, created_at=base + timedelta(minutes=5)),
            _llm_event(model="llama-b", mode="architect", provider="openai",
                       task_id="t2", tin=300, tout=50, cost=0.0, created_at=base),
        ]
    )
    await db_session.commit()

    m = await compute_user_metrics(db_session, "user_test", period="all")

    assert m["totals"]["input"] == 1800
    assert m["totals"]["output"] == 350
    assert m["totals"]["cache_write"] == 50
    assert m["totals"]["cache_read"] == 10
    assert m["totals"]["total_tokens"] == 2150
    assert abs(m["totals"]["cost"] - 0.03) < 1e-9
    assert m["totals"]["completions"] == 3

    # Two tasks; t1 spans 5 minutes, t2 is a single event (0 span).
    assert m["task_count"] == 2
    assert m["duration_ms"] == 5 * 60 * 1000

    # Models sorted desc by tokens: gpt-a (1800) before llama-b (350).
    names = [r["name"] for r in m["by_model"]]
    assert names == ["gpt-a", "llama-b"]
    assert m["by_model"][0]["count"] == 2
    modes = {r["name"] for r in m["by_mode"]}
    assert modes == {"code", "architect"}
    providers = {r["name"] for r in m["by_provider"]}
    assert providers == {"openrouter", "openai"}


async def test_compute_user_metrics_period_filters_old_events(db_session):
    from datetime import datetime, timezone, timedelta

    await _seed_user(db_session)
    now = datetime.now(timezone.utc)
    db_session.add_all(
        [
            _llm_event(task_id="recent", tin=100, tout=10, created_at=now),
            _llm_event(task_id="old", tin=9999, tout=9999,
                       created_at=now - timedelta(days=40)),
        ]
    )
    await db_session.commit()

    m = await compute_user_metrics(db_session, "user_test", period="7d")
    assert m["totals"]["completions"] == 1
    assert m["totals"]["input"] == 100


async def test_compute_user_metrics_scopes_to_user(db_session):
    await _seed_user(db_session)
    await _seed_user(db_session, user_id="other", email="o@example.com")
    db_session.add_all(
        [
            _llm_event(user_id="user_test", tin=100, tout=10),
            _llm_event(user_id="other", tin=5000, tout=5000),
        ]
    )
    await db_session.commit()

    m = await compute_user_metrics(db_session, "user_test", period="all")
    assert m["totals"]["input"] == 100
    assert m["totals"]["completions"] == 1


async def test_metrics_page_renders_dimensions(client, db_session, session_factory):
    await _seed_user(db_session)
    async with session_factory() as s:
        s.add(_llm_event(model="nvidia/nemotron", mode="orchestrator",
                         provider="openrouter", tin=96941, tout=3365, cost=0.1234))
        await s.commit()

    from src.main import app

    _override_web_user(app)
    try:
        resp = client.get("/app/metrics?period=all")
    finally:
        app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.status_code == 200
    body = resp.text
    assert "nvidia/nemotron" in body
    assert "orchestrator" in body
    assert "$0.1234" in body
    # Chart payload + library are wired when there is data.
    assert "/static/vendor/chart.umd.min.js" in body
    assert 'id="metrics-data"' in body


async def test_metrics_page_empty_state(client, db_session):
    await _seed_user(db_session)
    from src.main import app

    _override_web_user(app)
    try:
        resp = client.get("/app/metrics")
    finally:
        app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.status_code == 200
    assert "No usage recorded" in resp.text
    # No chart library loaded when there is nothing to plot.
    assert "/static/vendor/chart.umd.min.js" not in resp.text


async def test_web_num_excludes_booleans(client, db_session, session_factory):
    """``num`` (shared util) must NOT count ``True``/``False`` as 1.0/0.0 - Python
    ``bool`` is a subclass of ``int``, so ``isinstance(True, (int, float))`` is
    ``True``. A malformed ``tokensIn: true`` would inflate the task-list total
    by 1.0 while the metrics dashboard (which excludes bools) reports 0,
    diverging the two views. This test feeds a boolean token value and asserts
    the web task-list aggregates it as 0, not 1."""
    from src.utils.format import num

    # Direct unit test of num: bool must be treated as 0
    assert num(True) == 0
    assert num(False) == 0
    assert num(42) == 42.0
    assert num(3.14) == 3.14
    assert num("hello") == 0
    assert num(None) == 0

    # Integration: a task with tokensIn=true must NOT inflate the total
    await _seed_user(db_session)
    first = {"ts": 1000, "type": "say", "say": "text", "text": "Build me a feature"}
    api_req = {
        "ts": 2000,
        "type": "say",
        "say": "api_req_started",
        "text": json.dumps(
            {
                "tokensIn": True,  # malformed boolean - must count as 0
                "tokensOut": 100,
                "cost": 0.05,
            }
        ),
    }
    async with session_factory() as s:
        s.add(Task(id="task-bool", user_id="user_test"))
        await _add_message(s, "task-bool", first)
        await _add_message(s, "task-bool", api_req)
        await _summarize(s, "task-bool")
        await s.commit()

    from src.main import app

    _override_web_user(app)
    try:
        resp = client.get("/app")
    finally:
        app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.status_code == 200
    # tokens_in should be 0 (bool excluded), tokens_out=100 → total 100, so the
    # list shows the figure 100 and never 101.
    assert ">100<" in resp.text
    assert "101" not in resp.text
    # The tooltip should show In: 0 (not In: 1)
    assert "↑ In: 0" in resp.text


# --- session quality --------------------------------------------------------


def _quality_msgs(**counts):
    """Build a conversation containing the requested markers, in a valid order."""
    msgs = [{"ts": 1, "type": "say", "say": "text", "text": "Do the thing"}]
    ts = 10
    for _ in range(counts.get("requests", 1)):
        msgs.append({"ts": ts, "type": "say", "say": "api_req_started",
                     "text": json.dumps({"tokensIn": 1000, "tokensOut": 100, "cost": 0.01})})
        ts += 10
    for _ in range(counts.get("errors", 0)):
        msgs.append({"ts": ts, "type": "say", "say": "error", "text": "boom"})
        ts += 10
    for _ in range(counts.get("retries", 0)):
        msgs.append({"ts": ts, "type": "say", "say": "api_req_retry_delayed", "text": "waiting"})
        ts += 10
    for _ in range(counts.get("condense", 0)):
        msgs.append({"ts": ts, "type": "say", "say": "condense_context",
                     "contextCondense": {"summary": "s", "cost": 0.001}})
        ts += 10
    for _ in range(counts.get("interventions", 0)):
        # Preceded by a request, so it is a mid-run correction, not a rejection.
        msgs.append({"ts": ts, "type": "say", "say": "api_req_started", "text": "{}"})
        ts += 10
        msgs.append({"ts": ts, "type": "say", "say": "user_feedback", "text": "no, like this"})
        ts += 10
    for path in counts.get("tool_paths", []):
        msgs.append({"ts": ts, "type": "say", "say": "tool",
                     "text": json.dumps({"tool": "readFile", "path": path})})
        ts += 10
    if counts.get("completed", True):
        msgs.append({"ts": ts, "type": "say", "say": "completion_result", "text": "done"})
    return msgs


async def test_quality_counts_every_marker(client, db_session, session_factory):
    from src.services.session_quality import quality_of

    await _seed_user(db_session)
    _override_current_user(client.app)
    try:
        await _backfill(client, "q-all", _quality_msgs(
            requests=3, errors=2, retries=1, condense=1, interventions=2,
            tool_paths=["a.py", "b.py", "a.py"],
        ))
    finally:
        client.app.dependency_overrides.pop(get_current_user, None)

    async with session_factory() as s:
        task = (await s.execute(select(Task).where(Task.id == "q-all"))).scalar_one()
        q = quality_of(task)

    # 3 explicit + 2 that precede the interventions.
    assert q.requests == 5
    assert q.errors == 2
    assert q.retries == 1
    assert q.condense == 1
    assert q.interventions == 2
    assert q.completion_replies == 0
    assert q.tools == 3
    # a.py read twice → one repeat.
    assert q.repeated_work == 1
    assert q.completed is True


async def test_reply_to_a_finished_result_is_not_a_mid_run_correction(
    client, db_session, session_factory
):
    """A reply to a proposed result and a mid-run correction are both
    `user_feedback`; only what precedes them tells them apart. They are counted
    separately because they mean different things - and the reply is kept out of
    the grade, since "now also do this" looks identical to "that is wrong"."""
    from src.services.session_quality import quality_of

    await _seed_user(db_session)
    _override_current_user(client.app)
    try:
        await _backfill(client, "q-reject", [
            {"ts": 1, "type": "say", "say": "text", "text": "Do it"},
            {"ts": 2, "type": "say", "say": "api_req_started", "text": "{}"},
            {"ts": 3, "type": "say", "say": "completion_result", "text": "All done"},
            # No request/tool in between: the completion is still awaiting an answer.
            {"ts": 4, "type": "say", "say": "user_feedback", "text": "no, it is not"},
            {"ts": 5, "type": "say", "say": "api_req_started", "text": "{}"},
            # This one follows a request, so it is an ordinary correction.
            {"ts": 6, "type": "say", "say": "user_feedback", "text": "also change this"},
            {"ts": 7, "type": "say", "say": "completion_result", "text": "Now done"},
        ])
    finally:
        client.app.dependency_overrides.pop(get_current_user, None)

    async with session_factory() as s:
        task = (await s.execute(select(Task).where(Task.id == "q-reject"))).scalar_one()
        q = quality_of(task)

    assert q.completion_replies == 1, "a reply to an attempt_completion must be counted as one"
    assert q.interventions == 1, "the mid-run correction must stay a correction"


async def test_live_stream_detects_a_completion_reply_without_the_whole_conversation(
    db_session, session_factory
):
    """The bridge delivers one message at a time, so the awaiting-completion
    state has to come from what is already stored rather than from a walk."""
    from src.services.session_quality import quality_of
    from src.services.telemetry_service import upsert_task_message

    await _seed_user(db_session)
    stream = [
        {"ts": 1, "type": "say", "say": "api_req_started", "text": "{}"},
        {"ts": 2, "type": "say", "say": "completion_result", "text": "All done"},
        {"ts": 3, "type": "say", "say": "user_feedback", "text": "no"},
        {"ts": 4, "type": "say", "say": "api_req_started", "text": "{}"},
        {"ts": 5, "type": "say", "say": "user_feedback", "text": "one more thing"},
    ]
    async with session_factory() as s:
        for msg in stream:
            await upsert_task_message(s, "q-live", "user_test", msg)
        await s.commit()

    async with session_factory() as s:
        task = (await s.execute(select(Task).where(Task.id == "q-live"))).scalar_one()
        q = quality_of(task)

    assert q.completion_replies == 1
    assert q.interventions == 1


async def test_grade_rules(client, db_session, session_factory):
    """Each grade must follow from a stated rule, not a weighting."""
    from src.services.session_quality import quality_of

    await _seed_user(db_session)
    _override_current_user(client.app)
    try:
        await _backfill(client, "g-clean", _quality_msgs(requests=2))
        await _backfill(client, "g-friction", _quality_msgs(requests=2, errors=1))
        await _backfill(client, "g-unfinished", _quality_msgs(requests=2, completed=False))
    finally:
        client.app.dependency_overrides.pop(get_current_user, None)

    async with session_factory() as s:
        grades = {}
        for tid in ("g-clean", "g-friction", "g-unfinished"):
            task = (await s.execute(select(Task).where(Task.id == tid))).scalar_one()
            grades[tid] = quality_of(task).grade

    assert grades["g-clean"] == "clean"
    assert grades["g-friction"] == "friction"
    assert grades["g-unfinished"] == "unfinished"


async def test_grade_reasons_name_what_happened(client, db_session, session_factory):
    """A badge must never be a verdict the reader has to take on trust."""
    from src.services.session_quality import quality_of

    await _seed_user(db_session)
    _override_current_user(client.app)
    try:
        await _backfill(client, "g-why", _quality_msgs(requests=1, errors=2, condense=1))
    finally:
        client.app.dependency_overrides.pop(get_current_user, None)

    async with session_factory() as s:
        task = (await s.execute(select(Task).where(Task.id == "g-why"))).scalar_one()
        reasons = " ".join(quality_of(task).reasons())

    assert "2 errors" in reasons
    assert "context condensed 1 time" in reasons


async def test_resharing_does_not_inflate_quality_counts(client, db_session, session_factory):
    from src.services.session_quality import quality_of

    await _seed_user(db_session)
    _override_current_user(client.app)
    msgs = _quality_msgs(requests=2, errors=1, tool_paths=["x.py"])
    try:
        for _ in range(3):
            await _backfill(client, "q-idem", msgs)
    finally:
        client.app.dependency_overrides.pop(get_current_user, None)

    async with session_factory() as s:
        task = (await s.execute(select(Task).where(Task.id == "q-idem"))).scalar_one()
        q = quality_of(task)

    assert q.requests == 2
    assert q.errors == 1
    assert q.tools == 1


async def test_quality_shows_on_list_detail_and_metrics(client, db_session, session_factory):
    await _seed_user(db_session)
    _override_current_user(client.app)
    try:
        await _backfill(client, "q-ui", _quality_msgs(requests=2, errors=1))
    finally:
        client.app.dependency_overrides.pop(get_current_user, None)

    _override_web_user(client.app)
    try:
        lst = client.get("/app")
        detail = client.get("/app/tasks/q-ui")
        metrics = client.get("/app/metrics?period=all")
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    assert 'class="grade grade-friction"' in lst.text
    assert "Friction" in detail.text
    assert "Your corrections" in detail.text
    assert "Session quality" in metrics.text
    assert "Roughest runs" in metrics.text


async def test_quality_overview_excludes_subtasks(client, db_session, session_factory):
    """A run and the subtasks it delegated to are one piece of work; grading both
    would count it several times."""
    await _seed_user(db_session)
    _override_current_user(client.app)
    try:
        await _backfill(client, "qo-parent", _quality_msgs(requests=1))
        await _backfill(client, "qo-child", _quality_msgs(requests=1))
    finally:
        client.app.dependency_overrides.pop(get_current_user, None)

    async with session_factory() as s:
        await s.execute(
            Task.__table__.update().where(Task.id == "qo-child").values(parent_task_id="qo-parent")
        )
        await s.commit()

    from src.routers.web import _quality_overview

    async with session_factory() as s:
        overview = await _quality_overview(s, "user_test", "all")

    assert overview["total"] == 1, "only the run should be graded, not its subtask"


async def test_replying_to_a_result_does_not_count_as_friction(
    client, db_session, session_factory
):
    """Answering a finished result covers "that is wrong" and "now also do this"
    equally, so it must not drag a run out of "clean".

    Measured on the live corpus before this rule was fixed: counting it as
    friction moved 17 of 236 runs from clean to friction on a reading the data
    does not support. agent-bench says the same of its `rej_completion` column -
    pushback or follow-up, not a defect count.
    """
    from src.services.session_quality import quality_of

    await _seed_user(db_session)
    _override_current_user(client.app)
    try:
        await _backfill(client, "q-followup", [
            {"ts": 1, "type": "say", "say": "text", "text": "Do it"},
            {"ts": 2, "type": "say", "say": "api_req_started", "text": "{}"},
            {"ts": 3, "type": "say", "say": "completion_result", "text": "Done"},
            {"ts": 4, "type": "say", "say": "user_feedback", "text": "great, now also add tests"},
            {"ts": 5, "type": "say", "say": "api_req_started", "text": "{}"},
            {"ts": 6, "type": "say", "say": "completion_result", "text": "Tests added"},
        ])
    finally:
        client.app.dependency_overrides.pop(get_current_user, None)

    async with session_factory() as s:
        task = (await s.execute(select(Task).where(Task.id == "q-followup"))).scalar_one()
        q = quality_of(task)

    assert q.completion_replies == 1
    assert q.friction_events == 0, "a reply to a result is not friction"
    assert q.grade == "clean"
    # It is still reported - just as context, after the grade's own reasons.
    assert any("replied to 1 finished result" in r for r in q.reasons())
