"""The web panel's task pages: the list (/app), the task page, deleting tasks.

Split out of test_web_and_share.py (CAPI-M5); the sections are unchanged.
"""

import json

import pytest
from sqlalchemy import select, func

from src.dependencies import get_current_user
from src.auth.web_session import get_web_user_optional
from src.models.task import Task, TaskMessage, TaskShare
from src.services.task_summary import duration_ms

from tests.web_helpers import (
    _seed_user,
    _override_current_user,
    _override_web_user,
    _msgs,
    _add_message,
    _summarize,
    _backfill_files,
    _backfill,
)


# --- Web: /app requires a session ------------------------------------------


async def test_app_redirects_to_login_without_session(client):
    resp = client.get("/app", follow_redirects=False)
    assert resp.status_code == 303
    assert resp.headers["location"] == "/app/login"


async def test_app_lists_owned_tasks(client, db_session, session_factory):
    await _seed_user(db_session)
    async with session_factory() as s:
        s.add(Task(id="task-9", user_id="user_test"))
        await _add_message(s, "task-9", _msgs()[0])
        await _summarize(s, "task-9")
        await s.commit()

    from src.main import app

    _override_web_user(app)
    try:
        resp = client.get("/app")
    finally:
        app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.status_code == 200
    assert "Build me a feature" in resp.text


async def test_title_strips_environment_details_wrapper(client, db_session, session_factory):
    """A first turn in Roo Code's API-prompt form (typed text wrapped in
    <user_message>, trailed by a machine <environment_details> block) yields a
    title of just the user's query - no mode/file-tree leakage."""
    await _seed_user(db_session)
    wrapped = (
        "<user_message>\n"
        "uruchom wszystkie testy w langgrapha\n"
        "</user_message> <environment_details>\n"
        "# VSCode Visible Files\n.roo/rules/rules.md\n\n"
        "# Current Mode\n<slug>code</slug>\n<name>💻 Code</name>\n"
        "</environment_details>"
    )
    async with session_factory() as s:
        s.add(Task(id="task-wrapped", user_id="user_test"))
        await _add_message(
            s, "task-wrapped", {"ts": 1, "type": "say", "say": "text", "text": wrapped}
        )
        await _summarize(s, "task-wrapped")
        await s.commit()

    from src.main import app

    _override_web_user(app)
    try:
        list_resp = client.get("/app")
        detail_resp = client.get("/app/tasks/task-wrapped")
    finally:
        app.dependency_overrides.pop(get_web_user_optional, None)

    assert list_resp.status_code == 200
    assert "uruchom wszystkie testy w langgrapha" in list_resp.text
    # The machine framing must not bleed into the title.
    for leak in ("environment_details", "Current Mode", "<user_message>", "<slug>"):
        assert leak not in list_resp.text
    assert detail_resp.status_code == 200
    assert "uruchom wszystkie testy w langgrapha" in detail_resp.text


async def test_app_list_and_detail_show_workspace(client, db_session, session_factory):
    """The list shows the worktree basename (full path on hover); the detail header
    shows the full path."""
    await _seed_user(db_session)
    ws = "/home/krzych/Projekty/QUB-IT/Roo-Code-worktree-alpha"
    async with session_factory() as s:
        s.add(Task(id="task-ws-view", user_id="user_test", workspace_path=ws))
        await _add_message(s, "task-ws-view", _msgs()[0])
        await _summarize(s, "task-ws-view")
        await s.commit()

    from src.main import app

    _override_web_user(app)
    try:
        list_resp = client.get("/app")
        detail_resp = client.get("/app/tasks/task-ws-view")
    finally:
        app.dependency_overrides.pop(get_web_user_optional, None)

    assert list_resp.status_code == 200
    # Basename badge, full path as the hover title.
    assert "Roo-Code-worktree-alpha" in list_resp.text
    assert f'title="{ws}"' in list_resp.text

    assert detail_resp.status_code == 200
    assert ws in detail_resp.text


async def test_app_list_without_workspace_renders_cleanly(client, db_session, session_factory):
    """A task with no workspace_path (legacy / bridge-off share) renders without a
    project badge and does not error."""
    await _seed_user(db_session)
    async with session_factory() as s:
        s.add(Task(id="task-no-ws", user_id="user_test", workspace_path=None))
        await _add_message(s, "task-no-ws", _msgs()[0])
        await _summarize(s, "task-no-ws")
        await s.commit()

    from src.main import app

    _override_web_user(app)
    try:
        resp = client.get("/app")
    finally:
        app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.status_code == 200
    assert "badge-workspace" not in resp.text


async def test_app_list_shows_cost_and_tokens(client, db_session, session_factory):
    await _seed_user(db_session)
    # Two api_req messages 65s apart so duration spans the whole conversation.
    first = {"ts": 1000, "type": "say", "say": "text", "text": "Build me a feature"}
    api_req = {
        "ts": 66000,
        "type": "say",
        "say": "api_req_started",
        "text": json.dumps(
            {
                "tokensIn": 96941,
                "tokensOut": 3365,
                "cacheWrites": 1200,
                "cacheReads": 8400,
                "cost": 0.1234,
            }
        ),
    }
    async with session_factory() as s:
        s.add(Task(id="task-metrics", user_id="user_test"))
        await _add_message(s, "task-metrics", first)
        await _add_message(s, "task-metrics", api_req)
        await _summarize(s, "task-metrics")
        await s.commit()

    from src.main import app

    _override_web_user(app)
    try:
        resp = client.get("/app")
    finally:
        app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.status_code == 200
    # 96941 + 3365 = 100306 → "100.3k"; cost rendered to 4 dp. The unit is a
    # separate element, so assert on the figure - that is what must be right.
    assert "100.3k" in resp.text
    assert "$0.1234" in resp.text
    # Hover tooltip breakdown: in/out, cache, session duration, cost.
    assert "↑ In: 96,941" in resp.text
    assert "↓ Out: 3,365" in resp.text
    assert "1,200 write / 8,400 read" in resp.text
    assert "⏱ Session: 1m 5s" in resp.text


# --- Web: task detail enforces ownership -----------------------------------


async def test_task_detail_not_found_for_non_owner(client, db_session, session_factory):
    await _seed_user(db_session, user_id="owner", email="owner@example.com")
    async with session_factory() as s:
        s.add(Task(id="task-owned", user_id="owner"))
        await s.commit()

    from src.main import app

    _override_web_user(app, user_id="intruder")
    try:
        resp = client.get("/app/tasks/task-owned")
    finally:
        app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.status_code == 404


# --- Web: live remote-control surface only on the owner page ----------------


async def test_owner_task_detail_renders_live_controls(
    client, db_session, session_factory, monkeypatch
):
    """The owner's task page must expose the interactive bridge surface: the
    live header, the chat/auto-approve controls, and the live.js loader - fed by
    the embedded live-config. This is what makes the page drive the task. The
    page reads `settings.bridge_enabled` per request, so enable it here."""
    from config.settings import settings as app_settings

    monkeypatch.setattr(app_settings, "bridge_enabled", True)

    await _seed_user(db_session)
    async with session_factory() as s:
        s.add(Task(id="task-live", user_id="user_test"))
        await _add_message(s, "task-live", _msgs()[0])
        await _summarize(s, "task-live")
        await s.commit()

    from src.main import app

    _override_web_user(app)
    try:
        resp = client.get("/app/tasks/task-live")
    finally:
        app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.status_code == 200
    body = resp.text
    assert 'id="live-controls"' in body
    assert 'id="chat-input"' in body
    assert 'id="live-config"' in body
    assert "/static/live.js" in body
    # The config must carry the task id and the bridge path for the client.
    assert '"taskId": "task-live"' in body


async def test_shared_page_anonymous_never_renders_live_controls(
    client, db_session, session_factory, monkeypatch
):
    """A public share link viewed anonymously is strictly read-only - it must NOT
    ship the live controls or the socket.io/live.js bundle, even when the bridge is
    enabled. Control is owner-only."""
    from config.settings import settings as app_settings

    monkeypatch.setattr(app_settings, "bridge_enabled", True)

    await _seed_user(db_session)
    async with session_factory() as s:
        s.add(Task(id="task-pub2", user_id="user_test"))
        await _add_message(s, "task-pub2", _msgs()[0])
        s.add(
            TaskShare(
                task_id="task-pub2",
                visibility="public",
                share_url="http://testserver/shared/task-pub2",
            )
        )
        await _summarize(s, "task-pub2")
        await s.commit()

    resp = client.get("/shared/task-pub2")
    assert resp.status_code == 200
    body = resp.text
    assert 'id="live-controls"' not in body
    assert "/static/live.js" not in body
    # Nor what the task cost: a reader of a shared link gets the conversation.
    assert 'class="spend-table"' not in body


async def test_shared_owner_gets_live_controls(
    client, db_session, session_factory, monkeypatch
):
    """The owner opening their own share URL gets the live, drivable surface - so a
    freshly-shared task is remote-controllable straight from its share link."""
    from config.settings import settings as app_settings

    monkeypatch.setattr(app_settings, "bridge_enabled", True)

    await _seed_user(db_session)
    async with session_factory() as s:
        s.add(Task(id="task-own-live", user_id="user_test"))
        await _add_message(s, "task-own-live", _msgs()[0])
        s.add(
            TaskShare(
                task_id="task-own-live",
                visibility="public",
                share_url="http://testserver/shared/task-own-live",
            )
        )
        await _summarize(s, "task-own-live")
        await s.commit()

    from src.main import app

    _override_web_user(app)  # logged in as "user_test" (the owner)
    try:
        resp = client.get("/shared/task-own-live")
    finally:
        app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.status_code == 200
    body = resp.text
    assert 'id="live-controls"' in body
    assert "/static/live.js" in body
    assert '"taskId": "task-own-live"' in body
    # The owner driving their own task is not "read-only".
    assert "read-only" not in body
    # The live header's figures are there for live.js to keep current.
    assert 'id="hdr-own-cost"' in body


async def test_delete_task_removes_task_messages_and_share(
    client, db_session, session_factory
):
    """Owner deleting a task wipes the Task row and everything hanging off it -
    messages and share rows - from the DB, and redirects back to the list."""
    await _seed_user(db_session)
    async with session_factory() as s:
        s.add(Task(id="task-del", user_id="user_test"))
        await _add_message(s, "task-del", _msgs()[0])
        s.add(
            TaskShare(
                task_id="task-del",
                visibility="public",
                share_url="http://testserver/shared/task-del",
            )
        )
        await _summarize(s, "task-del")
        await s.commit()

    from src.main import app

    _override_web_user(app)
    try:
        resp = client.post("/app/tasks/task-del/delete", follow_redirects=False)
    finally:
        app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.status_code == 303
    assert resp.headers["location"] == "/app"

    async with session_factory() as s:
        tasks = (
            await s.execute(select(func.count(Task.id)).where(Task.id == "task-del"))
        ).scalar_one()
        msgs = (
            await s.execute(
                select(func.count(TaskMessage.id)).where(TaskMessage.task_id == "task-del")
            )
        ).scalar_one()
        shares = (
            await s.execute(
                select(func.count(TaskShare.id)).where(TaskShare.task_id == "task-del")
            )
        ).scalar_one()
        assert tasks == 0
        assert msgs == 0
        assert shares == 0


async def test_delete_task_non_owner_is_noop(client, db_session, session_factory):
    """A non-owner POSTing the delete route never touches another user's data:
    the task and its messages survive (silent no-op, still a 303 to the list)."""
    await _seed_user(db_session, user_id="owner", email="owner@example.com")
    async with session_factory() as s:
        s.add(Task(id="task-keep", user_id="owner"))
        await _add_message(s, "task-keep", _msgs()[0])
        await _summarize(s, "task-keep")
        await s.commit()

    from src.main import app

    _override_web_user(app, user_id="intruder", email="intruder@example.com")
    try:
        resp = client.post("/app/tasks/task-keep/delete", follow_redirects=False)
    finally:
        app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.status_code == 303
    async with session_factory() as s:
        tasks = (
            await s.execute(select(func.count(Task.id)).where(Task.id == "task-keep"))
        ).scalar_one()
        assert tasks == 1


async def test_delete_task_requires_session(client):
    """An unauthenticated delete POST redirects to login and deletes nothing."""
    resp = client.post("/app/tasks/whatever/delete", follow_redirects=False)
    assert resp.status_code == 303
    assert resp.headers["location"] == "/app/login"


async def test_shared_link_404s_after_owner_deletes(
    client, db_session, session_factory
):
    """Once the owner deletes the task, its public /shared link 404s."""
    await _seed_user(db_session)
    async with session_factory() as s:
        s.add(Task(id="task-gone", user_id="user_test"))
        await _add_message(s, "task-gone", _msgs()[0])
        s.add(
            TaskShare(
                task_id="task-gone",
                visibility="public",
                share_url="http://testserver/shared/task-gone",
            )
        )
        await _summarize(s, "task-gone")
        await s.commit()

    # Visible before delete.
    assert client.get("/shared/task-gone").status_code == 200

    from src.main import app

    _override_web_user(app)
    try:
        client.post("/app/tasks/task-gone/delete")
    finally:
        app.dependency_overrides.pop(get_web_user_optional, None)

    assert client.get("/shared/task-gone").status_code == 404


async def test_shared_nonowner_stays_readonly(
    client, db_session, session_factory, monkeypatch
):
    """A logged-in viewer who does NOT own the task gets the read-only share view -
    control never leaks to non-owners."""
    from config.settings import settings as app_settings

    monkeypatch.setattr(app_settings, "bridge_enabled", True)

    await _seed_user(db_session, user_id="owner", email="owner@example.com")
    async with session_factory() as s:
        s.add(Task(id="task-other", user_id="owner"))
        await _add_message(s, "task-other", _msgs()[0])
        s.add(
            TaskShare(
                task_id="task-other",
                visibility="public",
                share_url="http://testserver/shared/task-other",
            )
        )
        await _summarize(s, "task-other")
        await s.commit()

    from src.main import app

    _override_web_user(app, user_id="intruder", email="intruder@example.com")
    try:
        resp = client.get("/shared/task-other")
    finally:
        app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.status_code == 200
    body = resp.text
    assert 'id="live-controls"' not in body
    assert "/static/live.js" not in body


# --- task summary (denormalized display columns) ----------------------------


async def test_backfill_fills_the_task_summary_columns(client, db_session, session_factory):
    """The list renders from columns on the task row, so the write path must fill
    them. Before this existed the list re-parsed every message on every view."""
    await _seed_user(db_session)
    _override_current_user(client.app)
    messages = [
        {"ts": 10, "type": "say", "say": "text", "text": "Add retention settings"},
        {
            "ts": 20,
            "type": "say",
            "say": "api_req_started",
            "text": json.dumps(
                {"tokensIn": 1200, "tokensOut": 300, "cacheReads": 900, "cacheWrites": 100, "cost": 0.0125}
            ),
        },
        {"ts": 50, "type": "say", "say": "completion_result", "text": "Done"},
    ]
    files, data = _backfill_files("task-sum", messages)
    try:
        resp = client.post("/api/events/backfill", files=files, data=data)
    finally:
        client.app.dependency_overrides.pop(get_current_user, None)
    assert resp.status_code == 200

    async with session_factory() as s:
        task = (await s.execute(select(Task).where(Task.id == "task-sum"))).scalar_one()
        assert task.title == "Add retention settings"
        assert task.message_count == 3
        assert task.tokens_in == 1200
        assert task.tokens_out == 300
        assert task.cache_reads == 900
        assert task.cache_writes == 100
        assert task.cost == pytest.approx(0.0125)
        assert task.first_ts == 10
        assert task.last_ts == 50


# --- the session span (what counts as time the task ran) --------------------


_HOUR = 3_600_000


def _resume_ask(ts):
    """What the extension stores when a task is reopened from history."""
    return {"ts": ts, "type": "ask", "ask": "resume_task"}


async def test_a_trailing_resume_marker_does_not_extend_the_session_span(
    client, db_session, session_factory
):
    """Reopening a task hours later is not four hours of work.

    The live shape that exposed this: 54 steps over 3m10s, then a `resume_task`
    ask 4h23m after the last of them, and the list reported 4h26m. The span must
    end at the last message of the run itself.
    """
    await _seed_user(db_session)
    _override_current_user(client.app)
    try:
        await _backfill(client, "span-resume", [
            {"ts": 10, "type": "say", "say": "text", "text": "Fix the harness"},
            {"ts": 20, "type": "say", "say": "api_req_started", "text": "{}"},
            {"ts": 190_252, "type": "say", "say": "completion_result", "text": "done"},
            _resume_ask(190_252 + 4 * _HOUR),
        ])
    finally:
        client.app.dependency_overrides.pop(get_current_user, None)

    async with session_factory() as s:
        task = (await s.execute(select(Task).where(Task.id == "span-resume"))).scalar_one()
    assert task.first_ts == 10
    assert task.last_ts == 190_252
    assert duration_ms(task.first_ts, task.last_ts) == 190_242
    # The marker is still a stored row - it is excluded from the span, not hidden.
    assert task.message_count == 4


async def test_time_spent_waiting_for_the_user_stays_in_the_span(
    client, db_session, session_factory
):
    """Only the marker is dropped, never idle time.

    A run that sat for an hour waiting for an answer and then carried on took
    that hour: the task was open and the user was the thing it was blocked on.
    So a resume marker *between* two real messages changes nothing, and neither
    does the gap around it.
    """
    await _seed_user(db_session)
    _override_current_user(client.app)
    try:
        await _backfill(client, "span-mid", [
            {"ts": 10, "type": "say", "say": "text", "text": "Fix the harness"},
            {"ts": 20, "type": "say", "say": "api_req_started", "text": "{}"},
            _resume_ask(_HOUR),
            {"ts": 2 * _HOUR, "type": "say", "say": "completion_result", "text": "done"},
        ])
    finally:
        client.app.dependency_overrides.pop(get_current_user, None)

    async with session_factory() as s:
        task = (await s.execute(select(Task).where(Task.id == "span-mid"))).scalar_one()
    assert task.first_ts == 10
    assert task.last_ts == 2 * _HOUR
    assert duration_ms(task.first_ts, task.last_ts) == 2 * _HOUR - 10


async def test_a_task_of_nothing_but_resume_markers_reports_no_duration(
    client, db_session, session_factory
):
    """No message of its own means no span to state - not a fabricated one."""
    await _seed_user(db_session)
    _override_current_user(client.app)
    try:
        await _backfill(client, "span-empty", [_resume_ask(10), _resume_ask(_HOUR)])
    finally:
        client.app.dependency_overrides.pop(get_current_user, None)

    async with session_factory() as s:
        task = (await s.execute(select(Task).where(Task.id == "span-empty"))).scalar_one()
    assert task.first_ts is None
    assert task.last_ts is None
    assert duration_ms(task.first_ts, task.last_ts) == 0


async def test_a_resume_marker_is_classified_but_is_not_a_quality_signal(
    client, db_session, session_factory
):
    """It is stored as a kind so the span can exclude it on an indexed column.

    That is all it is for: it must not reach any friction count, and a clean run
    that was reopened is still a clean run.
    """
    from src.models.task import TaskMessage
    from src.services.session_quality import KIND_RESUME, GRADE_CLEAN, quality_of

    await _seed_user(db_session)
    _override_current_user(client.app)
    try:
        await _backfill(client, "span-kind", [
            {"ts": 10, "type": "say", "say": "text", "text": "Fix the harness"},
            {"ts": 20, "type": "say", "say": "api_req_started", "text": "{}"},
            {"ts": 30, "type": "say", "say": "completion_result", "text": "done"},
            _resume_ask(40),
        ])
    finally:
        client.app.dependency_overrides.pop(get_current_user, None)

    async with session_factory() as s:
        task = (await s.execute(select(Task).where(Task.id == "span-kind"))).scalar_one()
        kinds = (await s.execute(
            select(TaskMessage.q_kind).where(TaskMessage.task_id == "span-kind")
        )).scalars().all()

    assert kinds.count(KIND_RESUME) == 1
    q = quality_of(task)
    assert q.friction_events == 0
    assert q.grade == GRADE_CLEAN
    assert (q.errors, q.retries, q.interventions, q.condense) == (0, 0, 0, 0)


# --- the opening prompt (hover excerpt) -------------------------------------


_LONG_PROMPT = (
    "<task>\n"
    "Rewrite the pager so every page is reachable, not just the next one.\n"
    "\n"
    "\n"
    "It should keep the search terms when paging, and take a page number\n"
    "once the numbers stop covering the range.\n"
    "</task>\n"
    "<environment_details># VSCode Visible Files\nsrc/routers/web.py\n"
    "# Current Mode\ncode\n</environment_details>"
)


def test_derive_prompt_keeps_what_the_title_flattened():
    """The title is one line of the request; the excerpt is the request.

    Same source message, same stripping of the extension's machine framing -
    the title just cuts it down to a single line for the list's title column.
    """
    from src.services.task_summary import derive_prompt, derive_title

    messages = [{"ts": 1, "type": "say", "say": "text", "text": _LONG_PROMPT}]

    assert derive_title(messages) == (
        "Rewrite the pager so every page is reachable, not just the next one."
    )
    prompt = derive_prompt(messages)
    assert prompt.startswith("Rewrite the pager")
    # The second paragraph - invisible in the title - is the whole point.
    assert "take a page number" in prompt
    # Machine framing never reaches the reader.
    assert "environment_details" not in prompt
    assert "<task>" not in prompt
    # The shape is kept, and a run of blank lines is collapsed to one.
    assert "\n\n" in prompt
    assert "\n\n\n" not in prompt


def test_derive_prompt_caps_a_long_request_at_a_word_boundary():
    """A 40 KB prompt must not become a 40 KB column, nor end mid-word."""
    from src.services.task_summary import PROMPT_MAX, derive_prompt

    text = "Refactor the scheduler carefully " * 200
    prompt = derive_prompt([{"ts": 1, "type": "say", "say": "text", "text": text}])

    assert len(prompt) <= PROMPT_MAX + 1  # the cap, plus the ellipsis
    assert prompt.endswith("…")
    # Whatever word the cap landed in the middle of was dropped, not shown as a
    # fragment ("…the sched…").
    assert prompt[:-1].split()[-1] in {"Refactor", "the", "scheduler", "carefully"}


def test_derive_prompt_cuts_a_blob_with_no_word_boundary():
    """A pasted blob (a base64 payload, a minified file) has nowhere to break;
    the cap must hold anyway rather than falling back to the whole string."""
    from src.services.task_summary import PROMPT_MAX, derive_prompt

    blob = "x" * (PROMPT_MAX * 3)
    prompt = derive_prompt([{"ts": 1, "type": "say", "say": "text", "text": blob}])

    assert len(prompt) == PROMPT_MAX + 1
    assert prompt.endswith("…")


async def test_backfill_stores_the_prompt_excerpt(client, db_session, session_factory):
    """The list reads the excerpt off the task row, so the write path must fill
    it - reading 25 opening messages per page view is exactly the N+1 the
    summary columns exist to prevent."""
    await _seed_user(db_session)
    _override_current_user(client.app)
    messages = [{"ts": 10, "type": "say", "say": "text", "text": _LONG_PROMPT}]
    files, data = _backfill_files("task-prompt", messages)
    try:
        assert client.post("/api/events/backfill", files=files, data=data).status_code == 200
    finally:
        client.app.dependency_overrides.pop(get_current_user, None)

    async with session_factory() as s:
        task = (await s.execute(select(Task).where(Task.id == "task-prompt"))).scalar_one()
        assert "take a page number" in task.prompt_excerpt
        assert "environment_details" not in task.prompt_excerpt


async def test_resharing_replaces_the_prompt_excerpt(client, db_session, session_factory):
    """A re-share replaces the conversation wholesale; the excerpt must follow
    the title rather than describe a message that is no longer stored."""
    await _seed_user(db_session)
    _override_current_user(client.app)
    try:
        first = [{"ts": 1, "type": "say", "say": "text", "text": "Wire up the old thing"}]
        files, data = _backfill_files("task-reshare-prompt", first)
        assert client.post("/api/events/backfill", files=files, data=data).status_code == 200

        second = [{"ts": 1, "type": "say", "say": "text", "text": "Wire up the new thing"}]
        files, data = _backfill_files("task-reshare-prompt", second)
        assert client.post("/api/events/backfill", files=files, data=data).status_code == 200
    finally:
        client.app.dependency_overrides.pop(get_current_user, None)

    async with session_factory() as s:
        task = (
            await s.execute(select(Task).where(Task.id == "task-reshare-prompt"))
        ).scalar_one()
        assert task.prompt_excerpt == "Wire up the new thing"


async def test_task_row_hover_shows_the_prompt_and_the_figures(
    client, db_session, session_factory
):
    """Hovering a row must answer "what did I ask?", not only "what did it cost?"."""
    await _seed_user(db_session)
    async with session_factory() as s:
        s.add(
            Task(
                id="task-hover",
                user_id="user_test",
                title="Rewrite the pager so every page is reachable, not just the next one",
                prompt_excerpt=(
                    "Rewrite the pager so every page is reachable, not just the next one.\n"
                    "\n"
                    "It should keep the search terms when paging."
                ),
                tokens_in=1200,
                tokens_out=300,
                cost=0.0125,
            )
        )
        await s.commit()

    _override_web_user(client.app)
    try:
        resp = client.get("/app")
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.status_code == 200
    # The sentence the title column cannot show, inside the row's hover.
    assert "It should keep the search terms when paging." in resp.text
    # The figures still travel with it.
    assert "↑ In: 1,200" in resp.text
    assert "$ Cost: $0.0125" in resp.text


async def test_hover_wraps_a_paragraph_and_caps_its_height():
    """Native tooltips do not wrap: an unbroken 1000-character paragraph would
    render one line wider than the screen. And a prompt of many short lines is
    within the character cap but taller than a hover should be."""
    from src.routers.web import _PROMPT_WRAP_COLS, _PROMPT_WRAP_LINES, _wrap_prompt

    lines = _wrap_prompt("Refactor the scheduler carefully. " * 30)
    assert max(len(line) for line in lines) <= _PROMPT_WRAP_COLS

    tall = _wrap_prompt("\n".join(f"step {i}" for i in range(40)))
    assert len(tall) == _PROMPT_WRAP_LINES
    assert tall[-1].endswith("…")

    # The elision mark is made room for, not appended past the column: a
    # full-width last line plus "…" is the one line that would overflow.
    dense = _wrap_prompt("wrap me around and around " * 200)
    assert len(dense) == _PROMPT_WRAP_LINES
    assert max(len(line) for line in dense) <= _PROMPT_WRAP_COLS


async def test_a_task_with_no_figures_still_gets_a_hover(client, db_session, session_factory):
    """A run that never reached the model has nothing to report but its request -
    which is when reading it back matters most. The old tooltip was suppressed
    entirely, and rendered the literal string "None"."""
    await _seed_user(db_session)
    async with session_factory() as s:
        s.add(
            Task(
                id="task-nometrics",
                user_id="user_test",
                title="Try the thing",
                prompt_excerpt="Try the thing, then tell me whether the socket reconnects.",
            )
        )
        s.add(Task(id="task-bare", user_id="user_test", title="Nothing known"))
        await s.commit()

    _override_web_user(client.app)
    try:
        resp = client.get("/app")
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.status_code == 200
    assert "whether the socket reconnects" in resp.text
    # A row with neither a prompt nor figures carries no tooltip at all.
    assert 'title="None"' not in resp.text


async def test_resharing_a_task_does_not_double_count(client, db_session, session_factory):
    """Backfill replaces the conversation, so re-sharing must recompute - not add.

    The summary is re-summed from the stored rows rather than accumulated, which
    is what makes this idempotent.
    """
    await _seed_user(db_session)
    _override_current_user(client.app)
    messages = [
        {"ts": 1, "type": "say", "say": "text", "text": "One task"},
        {
            "ts": 2,
            "type": "say",
            "say": "api_req_started",
            "text": json.dumps({"tokensIn": 500, "tokensOut": 50, "cost": 0.01}),
        },
    ]
    try:
        for _ in range(3):
            files, data = _backfill_files("task-idem", messages)
            assert client.post("/api/events/backfill", files=files, data=data).status_code == 200
    finally:
        client.app.dependency_overrides.pop(get_current_user, None)

    async with session_factory() as s:
        task = (await s.execute(select(Task).where(Task.id == "task-idem"))).scalar_one()
        assert task.message_count == 2
        assert task.tokens_in == 500
        assert task.cost == pytest.approx(0.01)


async def test_live_upsert_replaces_metrics_instead_of_adding(db_session, session_factory):
    """A streamed api_req_started only learns its cost in its final revision.

    The row is upserted in place and the task total re-summed, so the interim
    zero-cost revision must not linger and the final must not be added on top of
    it.
    """
    from src.services.telemetry_service import upsert_task_message

    await _seed_user(db_session)
    partial = {
        "ts": 7,
        "type": "say",
        "say": "api_req_started",
        "partial": True,
        "text": json.dumps({"tokensIn": 100, "tokensOut": 0}),
    }
    final = {
        "ts": 7,
        "type": "say",
        "say": "api_req_started",
        "text": json.dumps({"tokensIn": 100, "tokensOut": 250, "cost": 0.02}),
    }

    async with session_factory() as s:
        await upsert_task_message(s, "task-live-sum", "user_test", partial)
        await upsert_task_message(s, "task-live-sum", "user_test", final)
        await s.commit()

    async with session_factory() as s:
        task = (await s.execute(select(Task).where(Task.id == "task-live-sum"))).scalar_one()
        assert task.message_count == 1
        assert task.tokens_in == 100
        assert task.tokens_out == 250
        assert task.cost == pytest.approx(0.02)


async def test_task_list_is_paginated(client, db_session, session_factory):
    """More tasks than one page must not all render at once."""
    from src.routers.web import PAGE_SIZE

    await _seed_user(db_session)
    async with session_factory() as s:
        for i in range(PAGE_SIZE + 5):
            s.add(Task(id=f"task-p{i}", user_id="user_test", title=f"Task number {i}"))
        await s.commit()

    _override_web_user(client.app)
    try:
        first = client.get("/app")
        second = client.get("/app?page=2")
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    assert first.status_code == 200 and second.status_code == 200
    assert first.text.count('class="task-item"') == PAGE_SIZE
    assert second.text.count('class="task-item"') == 5
    assert 'aria-label="Pagination, page 1 of 2"' in first.text


async def _seed_pages(session_factory, count, user_id="user_test", prefix="task-n"):
    """``count`` tasks with distinct timestamps, so page N holds a known slice."""
    from datetime import datetime, timezone, timedelta

    base = datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)
    async with session_factory() as s:
        for i in range(count):
            s.add(
                Task(
                    id=f"{prefix}{i}",
                    user_id=user_id,
                    title=f"Task number {i}",
                    # Newest first: task-n0 leads the list.
                    updated_at=base - timedelta(minutes=i),
                )
            )
        await s.commit()


async def test_pager_links_every_page_in_the_window(client, session_factory, db_session, monkeypatch):
    """Reaching page 5 must cost one click, not four of "Older"."""
    from src.routers import web_tasks

    monkeypatch.setattr(web_tasks, "PAGE_SIZE", 2)
    await _seed_user(db_session)
    await _seed_pages(session_factory, 20)  # 10 pages

    _override_web_user(client.app)
    try:
        resp = client.get("/app")
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.status_code == 200
    # The window around page 1, plus the far end, each as its own link.
    for n in (2, 3, 4, 5, 10):
        assert f'href="/app?scope=roots&page={n}"' in resp.text
    # The page you are on is stated, not offered as a link to itself.
    assert 'aria-current="page"' in resp.text
    assert 'href="/app?scope=roots&page=1"' not in resp.text
    # Pages 6..9 are elided rather than silently dropped.
    assert "pager-gap" in resp.text


async def test_pager_jump_box_appears_only_when_numbers_stop_covering_the_range(
    client, session_factory, db_session, monkeypatch
):
    from src.routers import web_tasks

    monkeypatch.setattr(web_tasks, "PAGE_SIZE", 2)
    await _seed_user(db_session)
    await _seed_pages(session_factory, 8)  # 4 pages: all four are on screen

    _override_web_user(client.app)
    try:
        short = client.get("/app")
        await _seed_pages(session_factory, 12, prefix="task-m")  # now 10 pages
        long = client.get("/app")
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    assert 'class="pager-jump"' not in short.text
    assert 'class="pager-jump"' in long.text
    assert 'max="10"' in long.text


async def test_pager_jumps_straight_to_a_far_page(client, session_factory, db_session, monkeypatch):
    from src.routers import web_tasks

    monkeypatch.setattr(web_tasks, "PAGE_SIZE", 2)
    await _seed_user(db_session)
    await _seed_pages(session_factory, 20)

    _override_web_user(client.app)
    try:
        resp = client.get("/app?page=7")
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.status_code == 200
    # Page 7 of a 2-per-page list ordered newest-first: tasks 12 and 13.
    assert "Task number 12" in resp.text and "Task number 13" in resp.text
    assert "Task number 11" not in resp.text and "Task number 14" not in resp.text
    assert 'aria-label="Pagination, page 7 of 10"' in resp.text


async def test_pager_out_of_range_lands_on_the_nearest_real_page(
    client, session_factory, db_session, monkeypatch
):
    """A typed page number or a stale bookmark must not replace the list with a 422."""
    from src.routers import web_tasks

    monkeypatch.setattr(web_tasks, "PAGE_SIZE", 2)
    await _seed_user(db_session)
    await _seed_pages(session_factory, 20)

    _override_web_user(client.app)
    try:
        beyond = client.get("/app?page=999")
        below = client.get("/app?page=0")
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    assert beyond.status_code == 200
    assert 'aria-label="Pagination, page 10 of 10"' in beyond.text
    assert below.status_code == 200
    assert 'aria-label="Pagination, page 1 of 10"' in below.text


async def test_pager_links_carry_the_search_encoded(client, session_factory, db_session, monkeypatch):
    """Paging must keep the filter, and a search containing & must not truncate
    the URL at the ampersand."""
    from src.routers import web_tasks

    monkeypatch.setattr(web_tasks, "PAGE_SIZE", 2)
    await _seed_user(db_session)
    await _seed_pages(session_factory, 20)

    _override_web_user(client.app)
    try:
        resp = client.get("/app", params={"q": "Task number 1"})
        amp = client.get("/app", params={"q": "a&b"})
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    assert "&amp;q=Task%20number%201" in resp.text  # page links keep the query
    assert 'name="q" value="Task number 1"' in resp.text  # so does the jump form
    assert "q=a%26b" in amp.text


async def test_task_list_search_filters_by_title_and_workspace(client, db_session, session_factory):
    await _seed_user(db_session)
    async with session_factory() as s:
        s.add(Task(id="t-a", user_id="user_test", title="Refactor the parser"))
        s.add(Task(id="t-b", user_id="user_test", title="Unrelated", workspace_path="/home/k/parser-lab"))
        s.add(Task(id="t-c", user_id="user_test", title="Something else"))
        await s.commit()

    _override_web_user(client.app)
    try:
        resp = client.get("/app?q=parser")
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.status_code == 200
    assert "Refactor the parser" in resp.text
    assert "parser-lab" in resp.text
    assert "Something else" not in resp.text


@pytest.mark.parametrize(
    "query, expected",
    [
        ("100%", {"Coverage at 100%"}),
        ("snake_case", {"Rename to snake_case"}),
        ("C:\\Users", {"Path C:\\Users\\k"}),
    ],
)
async def test_task_list_search_matches_wildcards_literally(
    client, db_session, session_factory, query, expected
):
    """``%`` and ``_`` are LIKE wildcards; typed into the search box they must
    mean the characters themselves (DEF-C31). Before the fix "100%" matched
    every title containing "100" and "snake_case" matched "snake case"."""
    titles = {
        "Coverage at 100%",
        "Raise the limit to 1000",
        "Rename to snake_case",
        "Explain snake case vs camel",
        "Path C:\\Users\\k",
    }
    await _seed_user(db_session)
    async with session_factory() as s:
        for i, title in enumerate(sorted(titles)):
            s.add(Task(id=f"t-w{i}", user_id="user_test", title=title))
        await s.commit()

    _override_web_user(client.app)
    try:
        resp = client.get("/app", params={"q": query})
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.status_code == 200
    import html

    shown = {t for t in titles if html.escape(t, quote=False) in resp.text}
    assert shown == expected


async def test_task_list_does_not_read_message_bodies(client, db_session, session_factory, monkeypatch):
    """The whole point of the summary columns: rendering the list must never touch
    the message corpus. Guards against a future change quietly reintroducing the
    N+1 read that cost 2.47s per page view on the live deployment."""
    from src.routers import web_tasks

    await _seed_user(db_session)
    async with session_factory() as s:
        s.add(Task(id="task-noread", user_id="user_test", title="Cheap render", message_count=3))
        await s.flush()
        await _add_message(s, "task-noread", _msgs()[0])
        await s.commit()

    called = False

    async def _boom(*args, **kwargs):
        nonlocal called
        called = True
        return []

    monkeypatch.setattr(web_tasks, "_load_task_messages", _boom)

    _override_web_user(client.app)
    try:
        resp = client.get("/app")
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.status_code == 200
    assert "Cheap render" in resp.text
    assert called is False


# --- subtask tree -----------------------------------------------------------


async def _post_event(client, task_id, parent_task_id=None, event_type="Task Created"):
    props = {"taskId": task_id}
    if parent_task_id:
        props["parentTaskId"] = parent_task_id
        props["isSubtask"] = True
    return client.post("/api/events", json={"type": event_type, "properties": props})


async def test_parent_link_survives_event_arriving_before_the_task(
    client, db_session, session_factory
):
    """The hard case, and the normal one: a subtask announces its parent when it
    starts, but neither task exists as a row until messages are stored - at
    share time that can be hours later."""
    from src.models.relation import TaskRelation

    await _seed_user(db_session)
    _override_current_user(client.app)
    try:
        # 1. Telemetry first - nothing exists yet.
        assert (await _post_event(client, "child-1", "parent-1")).status_code == 200

        async with session_factory() as s:
            rel = (
                await s.execute(select(TaskRelation).where(TaskRelation.child_task_id == "child-1"))
            ).scalar_one()
            assert rel.parent_task_id == "parent-1"
            assert (await s.execute(select(func.count(Task.id)))).scalar_one() == 0

        # 2. Parent shared, then child shared.
        for tid in ("parent-1", "child-1"):
            files, data = _backfill_files(tid, _msgs())
            assert client.post("/api/events/backfill", files=files, data=data).status_code == 200
    finally:
        client.app.dependency_overrides.pop(get_current_user, None)

    async with session_factory() as s:
        child = (await s.execute(select(Task).where(Task.id == "child-1"))).scalar_one()
        assert child.parent_task_id == "parent-1"


async def test_child_stored_before_its_parent_is_adopted_later(
    client, db_session, session_factory
):
    """The reverse order, which happens whenever a subtask finishes and is shared
    while the run that spawned it is still going."""
    await _seed_user(db_session)
    _override_current_user(client.app)
    try:
        assert (await _post_event(client, "child-2", "parent-2")).status_code == 200

        # Child first: its parent has no row, so the stamp must be deferred
        # rather than written as a dangling foreign key.
        files, data = _backfill_files("child-2", _msgs())
        assert client.post("/api/events/backfill", files=files, data=data).status_code == 200

        async with session_factory() as s:
            child = (await s.execute(select(Task).where(Task.id == "child-2"))).scalar_one()
            assert child.parent_task_id is None

        files, data = _backfill_files("parent-2", _msgs())
        assert client.post("/api/events/backfill", files=files, data=data).status_code == 200
    finally:
        client.app.dependency_overrides.pop(get_current_user, None)

    async with session_factory() as s:
        child = (await s.execute(select(Task).where(Task.id == "child-2"))).scalar_one()
        assert child.parent_task_id == "parent-2", "parent's arrival must claim waiting children"


async def test_relation_is_recorded_once_across_many_events(client, db_session, session_factory):
    """Every later event repeats parentTaskId; the link must not accumulate."""
    from src.models.relation import TaskRelation

    await _seed_user(db_session)
    _override_current_user(client.app)
    try:
        for evt in ("Task Created", "LLM Completion", "Tool Used", "Task Message"):
            assert (await _post_event(client, "child-3", "parent-3", evt)).status_code == 200
    finally:
        client.app.dependency_overrides.pop(get_current_user, None)

    async with session_factory() as s:
        count = (
            await s.execute(
                select(func.count(TaskRelation.child_task_id)).where(
                    TaskRelation.child_task_id == "child-3"
                )
            )
        ).scalar_one()
        assert count == 1


async def _seed_tree(session_factory, *specs, user_id="user_test"):
    """specs: (task_id, parent_task_id or None, title), parents before children.

    ``created_at`` is spelled out, one minute apart in spec order: rows written
    in one flush can share a server timestamp, and the tree is ordered by it.
    """
    from datetime import datetime, timedelta, timezone

    start = datetime(2026, 9, 1, tzinfo=timezone.utc)
    async with session_factory() as s:
        for n, (task_id, parent, title) in enumerate(specs):
            s.add(
                Task(
                    id=task_id,
                    user_id=user_id,
                    title=title,
                    parent_task_id=parent,
                    created_at=start + timedelta(minutes=n),
                    updated_at=start + timedelta(minutes=n),
                )
            )
            await s.flush()
        await s.commit()


async def test_run_view_nests_subtasks_under_their_run(client, db_session, session_factory):
    """150 of 387 tasks on the live deployment are subtasks. Listed flat they
    buried the runs among their own fragments; hidden, they left no way to see
    what a run delegated without opening it. The run view nests them instead,
    folded shut, at every depth."""
    await _seed_user(db_session)
    await _seed_tree(
        session_factory,
        ("run-a", None, "The run"),
        ("sub-a", "run-a", "Its subtask"),
        ("leaf-a", "sub-a", "Its leaf"),
        ("run-b", None, "A run with no subtasks"),
    )

    _override_web_user(client.app)
    try:
        roots = client.get("/app")
        everything = client.get("/app?scope=all")
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    page = roots.text
    # Both levels are on the page, each inside its parent's folded subtree.
    assert 'id="subtree-run-a" hidden' in page
    assert 'id="subtree-sub-a" hidden' in page
    assert (
        page.index('id="subtree-run-a"')
        < page.index("Its subtask")
        < page.index('id="subtree-sub-a"')
        < page.index("Its leaf")
    )
    # A toggle wherever there is something to unfold, and nowhere else.
    assert 'aria-controls="subtree-run-a"' in page
    assert 'aria-controls="subtree-sub-a"' in page
    assert 'aria-controls="subtree-run-b"' not in page
    assert 'aria-controls="subtree-leaf-a"' not in page
    # Still a list of runs: the count and the pill are about the runs.
    assert '<span class="count-pill">2</span>' in page
    assert 'class="child-count"' in page
    # "Include their subtasks" removes the whole subtree, so that is the count.
    assert 'value="run-a"\n               data-child-count="2"' in page

    flat = everything.text
    assert "Its subtask" in flat and "Its leaf" in flat
    # The flat view lists subtasks as rows of their own; nesting them there as
    # well would show each one twice.
    assert 'class="task-children"' not in flat
    assert 'class="tree-toggle"' not in flat
    assert 'class="subtask-mark"' in flat
    # Every task is on this one page, subtasks included, and each still counts
    # the subtasks beneath it: being listed does not detach a task from its parent.
    assert 'value="run-a"\n               data-child-count="2"' in flat
    assert 'value="sub-a"\n               data-child-count="1"' in flat


async def test_subtrees_groups_by_parent_oldest_first_within_the_users_tasks(
    db_session, session_factory
):
    from src.services.task_tree import subtree_size, subtrees

    await _seed_user(db_session)
    await _seed_user(db_session, user_id="user_other", email="o@example.com")
    await _seed_tree(
        session_factory,
        ("root", None, "Root"),
        ("first", "root", "Spawned first"),
        ("second", "root", "Spawned second"),
        ("grand", "first", "Grandchild"),
    )
    # Written directly: the write paths never link across users, which is why
    # the read path must not rely on it.
    await _seed_tree(session_factory, ("foreign", "root", "Not yours"), user_id="user_other")

    async with session_factory() as s:
        tree = await subtrees(s, ["root"], "user_test")

    assert [t.id for t in tree["root"]] == ["first", "second"]
    assert [t.id for t in tree["first"]] == ["grand"]
    assert "second" not in tree and "grand" not in tree
    assert subtree_size(tree, "root") == 3
    assert subtree_size(tree, "grand") == 0


async def test_subtree_walk_survives_a_cycle_on_the_page(client, db_session, session_factory):
    """Parent links come from a client. A cycle must neither hang the walk nor
    render a task inside its own subtree."""
    from src.services.task_tree import subtrees

    await _seed_user(db_session)
    await _seed_tree(
        session_factory,
        ("loop-a", None, "Loop A"),
        ("loop-b", "loop-a", "Loop B"),
    )
    async with session_factory() as s:
        await s.execute(
            Task.__table__.update().where(Task.id == "loop-a").values(parent_task_id="loop-b")
        )
        await s.commit()

    await _seed_tree(session_factory, ("self-loop", None, "Its own parent"))
    async with session_factory() as s:
        await s.execute(
            Task.__table__.update().where(Task.id == "self-loop").values(parent_task_id="self-loop")
        )
        await s.commit()

    def edges(tree):
        return {parent: [t.id for t in kids] for parent, kids in tree.items()}

    async with session_factory() as s:
        assert edges(await subtrees(s, ["loop-a"], "user_test")) == {"loop-a": ["loop-b"]}
        # Both ends asked for at once, as the flat view does: the loop is cut
        # at the edge that would close it, so exactly one of the two remains.
        both = edges(await subtrees(s, ["loop-a", "loop-b", "self-loop"], "user_test"))
        assert both in ({"loop-a": ["loop-b"]}, {"loop-b": ["loop-a"]})

    _override_web_user(client.app)
    try:
        resp = client.get("/app/tasks/loop-a")
        flat = client.get("/app?scope=all")
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)
    assert resp.status_code == 200
    assert resp.text.count('href="/app/tasks/loop-b"') == 2  # breadcrumb + panel
    assert flat.status_code == 200


async def test_the_tree_costs_a_query_per_level_not_per_run(
    client, db_session, session_factory, test_engine
):
    """A page of runs loads their subtrees one tree level at a time. Ten runs
    must cost exactly what five do, or the list has grown an N+1 again."""
    from sqlalchemy import event

    await _seed_user(db_session)

    statements: list[str] = []

    def _count(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    async def selects_for_page() -> int:
        statements.clear()
        event.listen(test_engine.sync_engine, "before_cursor_execute", _count)
        try:
            resp = client.get("/app")
        finally:
            event.remove(test_engine.sync_engine, "before_cursor_execute", _count)
        assert resp.status_code == 200
        return sum(1 for s in statements if s.lstrip().upper().startswith("SELECT"))

    await _seed_tree(
        session_factory,
        *[spec for n in range(5) for spec in ((f"r{n}", None, f"Run {n}"), (f"c{n}", f"r{n}", f"Sub {n}"))],
    )
    _override_web_user(client.app)
    try:
        five = await selects_for_page()
        await _seed_tree(
            session_factory,
            *[spec for n in range(5, 10) for spec in ((f"r{n}", None, f"Run {n}"), (f"c{n}", f"r{n}", f"Sub {n}"))],
        )
        ten = await selects_for_page()
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    assert ten == five


async def test_task_detail_shows_the_whole_subtree(client, db_session, session_factory):
    await _seed_user(db_session)
    await _seed_tree(
        session_factory,
        ("top", None, "Top run"),
        ("mid", "top", "Middle subtask"),
        ("deep", "mid", "Deep subtask"),
    )

    _override_web_user(client.app)
    try:
        resp = client.get("/app/tasks/top")
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    page = resp.text
    # The grandchild is reachable from the root, one level in from its parent.
    assert 'href="/app/tasks/deep"' in page
    assert page.index("Middle subtask") < page.index("Deep subtask")
    assert 'style="--depth: 1" href="/app/tasks/deep"' in page
    assert '<h2 class="chart-title">Subtasks <span class="count-pill">2</span>' in page


# --- what a run cost ----------------------------------------------------------


async def _seed_priced_run(session_factory):
    """A run whose own share is the smallest part of what it cost:

        run       $0.25   1 000 in / 100 out
          sub-a   $1.00   5 000 / 500
          sub-b   $0.50   2 000 / 200
            leaf  $0.25   1 000 / 100

    The run: $2.00 and 9 900 tokens; sub-b with its leaf: $0.75 and 3 300.
    """
    await _seed_tree(
        session_factory,
        ("run", None, "Priced run"),
        ("sub-a", "run", "First subtask"),
        ("sub-b", "run", "Second subtask"),
        ("leaf", "sub-b", "Its leaf"),
    )
    figures = {
        "run": (0.25, 1000, 100),
        "sub-a": (1.00, 5000, 500),
        "sub-b": (0.50, 2000, 200),
        "leaf": (0.25, 1000, 100),
    }
    async with session_factory() as s:
        for task_id, (cost, tokens_in, tokens_out) in figures.items():
            await s.execute(
                Task.__table__.update()
                .where(Task.id == task_id)
                .values(cost=cost, tokens_in=tokens_in, tokens_out=tokens_out, cache_reads=10)
            )
        await s.commit()


def _row(page: str, task_id: str) -> str:
    """The markup of one list row, from its checkbox to its delete button."""
    start = page.index(f'value="{task_id}"')
    return page[start : page.index('class="task-delete"', start)]


async def test_a_run_row_shows_what_the_whole_run_cost(client, db_session, session_factory):
    """The list showed a run's own cost only: on the live corpus a $0.1656 row
    whose two subtasks cost $1.2434 more. A task that delegated now shows its
    whole subtree, marked as a sum, with the split in the cell's hover."""
    await _seed_user(db_session)
    await _seed_priced_run(session_factory)

    _override_web_user(client.app)
    try:
        roots = client.get("/app").text
        flat = client.get("/app?scope=all").text
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    run = _row(roots, "run")
    assert '<span class="rollup-mark">Σ</span>$2.0000' in run
    assert '<span class="rollup-mark">Σ</span>9.9k<span class="unit">tok</span>' in run
    assert 'title="$2.0000 for the run: $0.2500 this task + $1.7500 in 3 subtasks"' in run
    assert 'title="9,900 tokens for the run: 1,100 this task + 8,800 in 3 subtasks"' in run

    # A subtask that delegated further is a run of its own, one level down.
    sub_b = _row(roots, "sub-b")
    assert '<span class="rollup-mark">Σ</span>$0.7500' in sub_b
    assert "in 1 subtask&#34;" in sub_b or 'in 1 subtask"' in sub_b

    # A task with nothing beneath it shows its own figures, unmarked.
    for task_id, cost in (("sub-a", "$1.0000"), ("leaf", "$0.2500")):
        row = _row(roots, task_id)
        assert f'<span class="cell-num cell-cost">{cost}</span>' in row
        assert "rollup-mark" not in row

    # The flat view lists the same tasks, so it states the same costs.
    assert '<span class="rollup-mark">Σ</span>$2.0000' in _row(flat, "run")


async def test_the_run_hover_separates_the_task_from_its_subtasks(
    client, db_session, session_factory
):
    await _seed_user(db_session)
    await _seed_priced_run(session_factory)

    _override_web_user(client.app)
    try:
        page = client.get("/app").text
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    run = _row(page, "run")
    hover = run[run.index('class="task-link"') :].split('title="', 1)[1].split('"', 1)[0]
    assert hover.index("This task") < hover.index("$ Cost: $0.2500")
    assert hover.index("$ Cost: $0.2500") < hover.index("Σ With its 3 subtasks")
    assert hover.index("Σ With its 3 subtasks") < hover.index("$ Cost: $2.0000")
    assert "↑ In: 9,000" in hover and "↓ Out: 900" in hover

    # No subtasks, no split: the hover reads exactly as it always did.
    leaf = _row(page, "leaf")
    assert "This task" not in leaf and "With its" not in leaf


def _cell(page: str, cell_id: str) -> str:
    """The text of one cell of the task page's spend table."""
    start = page.index(">", page.index(f'id="{cell_id}"')) + 1
    return page[start : page.index("<", start)]


def _live_config(page: str) -> dict:
    """What the task page hands live.js."""
    start = page.index(">", page.index('<script id="live-config"')) + 1
    return json.loads(page[start : page.index("</script>", start)])


async def test_the_task_page_states_the_run_total(client, db_session, session_factory, monkeypatch):
    """The page showed this task's own $0.1656 at the top and the run's $1.4090
    in the subtask panel's header, with nothing saying which was which, while
    the list showed $1.4090 for the same row. The top now states the run as the
    list does, then this task and its subtasks as its parts."""
    from config.settings import settings as app_settings

    monkeypatch.setattr(app_settings, "bridge_enabled", True)
    await _seed_user(db_session)
    await _seed_priced_run(session_factory)

    _override_web_user(client.app)
    try:
        page = client.get("/app/tasks/run").text
        leaf_page = client.get("/app/tasks/leaf").text
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    # The run first, then its parts, which add up to it.
    order = [page.index(f'class="spend-{row}"') for row in ("run", "own", "subtasks")]
    assert order == sorted(order)
    assert (_cell(page, "hdr-run-cost"), _cell(page, "hdr-run-tokens")) == ("$2.0000", "9.9k")
    assert (_cell(page, "hdr-run-in"), _cell(page, "hdr-run-out")) == ("9k", "900")
    assert (_cell(page, "hdr-own-cost"), _cell(page, "hdr-own-tokens")) == ("$0.2500", "1.1k")
    assert (_cell(page, "hdr-subtasks-cost"), _cell(page, "hdr-subtasks-tokens")) == ("$1.7500", "8.8k")
    # Every subtask beneath the run is counted, not only the direct ones.
    assert '<a href="#subtasks">3 subtasks</a>' in page
    # live.js keeps the run row current by adding the subtasks' part to this
    # task's live figures, so it ships with the page.
    assert _live_config(page)["subtasks"] == {"tokensIn": 8000, "tokensOut": 800, "cost": 1.75}

    # The subtask panel no longer carries a second total; its rows keep the
    # list's rule (a subtask with its own subtasks shows its subtree, marked).
    assert "run-total" not in page
    assert '<span class="rollup-mark">Σ</span>$0.7500' in page
    assert '<span class="cell-num cell-cost">$1.0000</span>' in page
    # The quality panel says which part it describes.
    assert "This task's own conversation only" in page

    # A task with no subtasks is its own run: one row, no split, no scope note.
    assert (_cell(leaf_page, "hdr-own-cost"), _cell(leaf_page, "hdr-own-tokens")) == ("$0.2500", "1.1k")
    assert 'class="spend-run"' not in leaf_page and 'class="spend-subtasks"' not in leaf_page
    assert "own conversation only" not in leaf_page
    assert "subtasks" not in _live_config(leaf_page)


def test_subtree_spend_adds_every_level_and_nothing_else():
    from src.services.task_tree import Spend, subtree_spend

    def task(task_id, cost, tokens_in):
        return Task(id=task_id, cost=cost, tokens_in=tokens_in, tokens_out=0, cache_reads=0, cache_writes=0)

    root, a, b, leaf, stranger = (
        task("root", 0.25, 100),
        task("a", 1.0, 200),
        task("b", 0.5, 300),
        task("leaf", 0.25, 400),
        task("stranger", 9.0, 900),
    )
    tree = {"root": [a, b], "b": [leaf]}

    assert subtree_spend(tree, root) == Spend(cost=2.0, tokens_in=1000)
    assert subtree_spend(tree, b) == Spend(cost=0.75, tokens_in=700)
    assert subtree_spend(tree, stranger) == Spend.of(stranger)
    assert subtree_spend(tree, root) - Spend.of(root) == Spend(cost=1.75, tokens_in=900)


async def test_task_detail_links_up_and_down_the_tree(client, db_session, session_factory):
    await _seed_user(db_session)
    async with session_factory() as s:
        s.add(Task(id="root-x", user_id="user_test", title="Root run"))
        await s.flush()
        s.add(Task(id="mid-x", user_id="user_test", title="Middle task", parent_task_id="root-x"))
        await s.flush()
        s.add(Task(id="leaf-x", user_id="user_test", title="Leaf task", parent_task_id="mid-x"))
        await s.commit()

    _override_web_user(client.app)
    try:
        mid = client.get("/app/tasks/mid-x")
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    assert mid.status_code == 200
    # Up: the breadcrumb reaches the root.
    assert "/app/tasks/root-x" in mid.text
    assert "Root run" in mid.text
    # Down: the subtask panel reaches the child.
    assert "/app/tasks/leaf-x" in mid.text
    assert "Leaf task" in mid.text


async def test_ancestor_walk_survives_a_cycle(db_session, session_factory):
    """Task ids come from a client. A cycle must not hang a page render."""
    from src.services.task_tree import ancestors

    await _seed_user(db_session)
    async with session_factory() as s:
        s.add(Task(id="cyc-a", user_id="user_test", title="A"))
        s.add(Task(id="cyc-b", user_id="user_test", title="B"))
        await s.flush()
        # Forced directly: the write paths never create this, which is exactly
        # why the read path has to defend itself.
        await s.execute(
            Task.__table__.update().where(Task.id == "cyc-a").values(parent_task_id="cyc-b")
        )
        await s.execute(
            Task.__table__.update().where(Task.id == "cyc-b").values(parent_task_id="cyc-a")
        )
        await s.commit()

    async with session_factory() as s:
        task = (await s.execute(select(Task).where(Task.id == "cyc-a"))).scalar_one()
        chain = await ancestors(s, task)

    assert len(chain) <= 2, "the walk must stop instead of looping forever"


# --- bulk delete ------------------------------------------------------------


async def _seed_tasks(session_factory, *specs):
    """specs: (task_id, user_id, parent_task_id or None)."""
    async with session_factory() as s:
        for task_id, user_id, parent in specs:
            s.add(Task(id=task_id, user_id=user_id, title=f"Task {task_id}"))
            await s.flush()
            await _add_message(s, task_id, _msgs()[0])
        await s.flush()
        for task_id, _, parent in specs:
            if parent:
                await s.execute(
                    Task.__table__.update().where(Task.id == task_id).values(parent_task_id=parent)
                )
        await s.commit()


async def _remaining(session_factory):
    async with session_factory() as s:
        rows = await s.execute(select(Task.id).order_by(Task.id))
        return {r[0] for r in rows.all()}


async def test_bulk_delete_removes_the_selection(client, db_session, session_factory):
    await _seed_user(db_session)
    await _seed_tasks(
        session_factory, ("b1", "user_test", None), ("b2", "user_test", None), ("b3", "user_test", None)
    )

    _override_web_user(client.app)
    try:
        resp = client.post(
            "/app/tasks/bulk-delete", data={"task_ids": ["b1", "b3"]}, follow_redirects=False
        )
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.status_code == 303
    assert await _remaining(session_factory) == {"b2"}

    # The conversations went with them.
    async with session_factory() as s:
        left = (
            await s.execute(
                select(func.count(TaskMessage.id)).where(TaskMessage.task_id.in_(["b1", "b3"]))
            )
        ).scalar_one()
    assert left == 0


async def test_bulk_delete_ignores_tasks_the_user_does_not_own(
    client, db_session, session_factory
):
    """The form posts a list of ids and nothing stops a caller from adding
    somebody else's. Ownership is re-checked per id against the database."""
    await _seed_user(db_session)
    await _seed_user(db_session, user_id="user_other", email="other@example.com")
    await _seed_tasks(
        session_factory, ("mine", "user_test", None), ("theirs", "user_other", None)
    )

    _override_web_user(client.app)
    try:
        resp = client.post(
            "/app/tasks/bulk-delete",
            data={"task_ids": ["mine", "theirs"]},
            follow_redirects=False,
        )
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    # The caller's own task goes; the other user's survives, and the response
    # gives away nothing about it.
    assert resp.status_code == 303
    assert await _remaining(session_factory) == {"theirs"}


async def test_bulk_delete_leaves_subtasks_alone_unless_asked(
    client, db_session, session_factory
):
    """Deleting a run must not silently take work the caller never selected;
    orphaned children survive as roots (parent_task_id is ON DELETE SET NULL)."""
    await _seed_user(db_session)
    await _seed_tasks(
        session_factory, ("parent", "user_test", None), ("child", "user_test", "parent")
    )

    _override_web_user(client.app)
    try:
        resp = client.post(
            "/app/tasks/bulk-delete", data={"task_ids": ["parent"]}, follow_redirects=False
        )
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.status_code == 303
    assert await _remaining(session_factory) == {"child"}
    async with session_factory() as s:
        child = (await s.execute(select(Task).where(Task.id == "child"))).scalar_one()
    assert child.parent_task_id is None


async def test_bulk_delete_can_include_the_whole_subtree(client, db_session, session_factory):
    await _seed_user(db_session)
    await _seed_tasks(
        session_factory,
        ("root", "user_test", None),
        ("mid", "user_test", "root"),
        ("leaf", "user_test", "mid"),
        ("unrelated", "user_test", None),
    )

    _override_web_user(client.app)
    try:
        resp = client.post(
            "/app/tasks/bulk-delete",
            data={"task_ids": ["root"], "include_subtasks": "1"},
            follow_redirects=False,
        )
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.status_code == 303
    assert await _remaining(session_factory) == {"unrelated"}, "the walk must reach every depth"


async def test_subtree_walk_survives_a_cycle(db_session, session_factory):
    """Parent links are built from client-supplied ids; a cycle must terminate."""
    from src.services.share_service import delete_tasks

    await _seed_user(db_session)
    await _seed_tasks(session_factory, ("cy-a", "user_test", None), ("cy-b", "user_test", "cy-a"))
    async with session_factory() as s:
        await s.execute(
            Task.__table__.update().where(Task.id == "cy-a").values(parent_task_id="cy-b")
        )
        await s.commit()

    async with session_factory() as s:
        deleted = await delete_tasks(s, ["cy-a"], "user_test", include_subtasks=True)
        await s.commit()

    assert deleted == 2
    assert await _remaining(session_factory) == set()


async def test_bulk_delete_with_no_selection_is_a_no_op(client, db_session, session_factory):
    await _seed_user(db_session)
    await _seed_tasks(session_factory, ("keep", "user_test", None))

    _override_web_user(client.app)
    try:
        resp = client.post("/app/tasks/bulk-delete", data={}, follow_redirects=False)
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.status_code == 303
    assert await _remaining(session_factory) == {"keep"}


async def test_bulk_delete_requires_a_session(client, db_session, session_factory):
    await _seed_user(db_session)
    await _seed_tasks(session_factory, ("guarded", "user_test", None))

    resp = client.post(
        "/app/tasks/bulk-delete", data={"task_ids": ["guarded"]}, follow_redirects=False
    )

    assert resp.status_code == 303
    assert resp.headers["location"] == "/app/login"
    assert await _remaining(session_factory) == {"guarded"}


async def test_bulk_delete_returns_to_the_current_view(client, db_session, session_factory):
    """Deleting from a filtered view must not dump the reader back to page 1 of
    an unfiltered list."""
    await _seed_user(db_session)
    await _seed_tasks(session_factory, ("v1", "user_test", None))

    _override_web_user(client.app)
    try:
        resp = client.post(
            "/app/tasks/bulk-delete",
            data={"task_ids": ["v1"], "scope": "all", "q": "parser"},
            follow_redirects=False,
        )
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.headers["location"] == "/app?scope=all&q=parser"


@pytest.mark.parametrize(
    "query",
    ["a&scope=roots", "fix #12", "two words", "zażółć gęślą", "100% done+more"],
)
async def test_bulk_delete_redirect_keeps_the_search_intact(
    client, db_session, session_factory, query
):
    """The search goes back into the redirect as a query value, so it must be
    URL-encoded: an unencoded ``&`` starts a new parameter (here overriding the
    scope), ``#`` cuts everything after it into a fragment the server never
    sees, and ``+`` would read back as a space (DEF-C31)."""
    from urllib.parse import parse_qs, urlsplit

    await _seed_user(db_session)
    await _seed_tasks(session_factory, ("enc1", "user_test", None))

    _override_web_user(client.app)
    try:
        resp = client.post(
            "/app/tasks/bulk-delete",
            data={"task_ids": ["enc1"], "scope": "all", "q": query},
            follow_redirects=False,
        )
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.status_code == 303
    location = urlsplit(resp.headers["location"])
    assert location.path == "/app"
    assert location.fragment == ""
    assert parse_qs(location.query) == {"scope": ["all"], "q": [query]}


async def test_list_offers_selection_controls(client, db_session, session_factory):
    await _seed_user(db_session)
    await _seed_tasks(session_factory, ("s1", "user_test", None))

    _override_web_user(client.app)
    try:
        resp = client.get("/app")
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    assert 'name="task_ids"' in resp.text
    assert 'id="select-all"' in resp.text
    assert "/app/tasks/bulk-delete" in resp.text
