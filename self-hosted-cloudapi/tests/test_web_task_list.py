"""The task list as a scanning tool: column headers, sorting, filters, chips.

UI modernization plan (ai_plans/2026-09-27_ui-modernization.md) section 3.2.
Sorting and filtering are server-side and plain GET parameters, so every state
of the list is a URL: it works without scripting, survives a reload, and the
pager, the filter chips and a bulk delete all carry it along.
"""

import re
from datetime import datetime, timedelta, timezone
from html import unescape

import pytest

from src.auth.web_session import get_web_user_optional
from src.models.task import Task
from tests.web_helpers import _override_web_user, _seed_user

BASE = datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)


async def _seed(session_factory, *rows, user_id="user_test"):
    """rows: dicts of Task columns; ``age`` (minutes before BASE) sets updated_at."""
    async with session_factory() as s:
        for n, row in enumerate(rows):
            row = dict(row)
            age = row.pop("age", n)
            s.add(
                Task(
                    user_id=user_id,
                    created_at=BASE - timedelta(minutes=age),
                    updated_at=BASE - timedelta(minutes=age),
                    **row,
                )
            )
            await s.flush()
        await s.commit()


def _get(client, path, **params):
    _override_web_user(client.app)
    try:
        return client.get(path, params=params or None)
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)


def _order(html: str) -> list[str]:
    """Task ids in the order their rows appear (checkbox values)."""
    return re.findall(r'name="task_ids" value="([^"]+)"', html)


def _hrefs(html: str) -> list[str]:
    return [unescape(h) for h in re.findall(r'href="(/app\?[^"]*)"', html)]


# --- the header row -----------------------------------------------------------


async def test_every_column_has_a_header(client, db_session, session_factory):
    """Nine columns, and today only the title and the date were labelled."""
    await _seed_user(db_session)
    await _seed(session_factory, {"id": "t1", "title": "One"})

    html = _get(client, "/app").text

    head = html[html.index('class="task-head"'):html.index('class="task-list"')]
    for label in ("Task", "Project", "Model", "Messages", "Duration", "Tokens", "Cost", "Grade", "Updated"):
        assert f">{label}<" in head, label
    # A header row, not a data row: the per-row tests count class="task-item".
    assert html.count('class="task-item"') == 1


async def test_sortable_headers_link_to_the_sorted_list(client, db_session, session_factory):
    await _seed_user(db_session)
    await _seed(session_factory, {"id": "t1", "title": "One"})

    html = _get(client, "/app").text
    hrefs = _hrefs(html)

    # Default: newest first, so "Updated" offers the other direction.
    assert "/app?scope=roots&sort=updated&dir=asc" in hrefs
    # A new column starts at its most useful end: biggest first.
    for key in ("cost", "tokens", "messages"):
        assert f"/app?scope=roots&sort={key}&dir=desc" in hrefs, key
    # The active column says so in words too, not only with an arrow.
    assert re.search(r'<a[^>]*sort=updated[^>]*>Updated<span class="sr-only">, sorted descending</span>', html)


# --- sorting ------------------------------------------------------------------


async def test_sort_by_cost_tokens_and_messages(client, db_session, session_factory):
    await _seed_user(db_session)
    await _seed(
        session_factory,
        {"id": "cheap", "title": "Cheap", "cost": 0.01, "tokens_in": 900, "tokens_out": 10, "message_count": 50},
        {"id": "dear", "title": "Dear", "cost": 2.5, "tokens_in": 100, "tokens_out": 5, "message_count": 3},
        {"id": "mid", "title": "Mid", "cost": 0.4, "tokens_in": 5000, "tokens_out": 50, "message_count": 10},
    )

    assert _order(_get(client, "/app", sort="cost", dir="desc").text) == ["dear", "mid", "cheap"]
    assert _order(_get(client, "/app", sort="cost", dir="asc").text) == ["cheap", "mid", "dear"]
    assert _order(_get(client, "/app", sort="tokens", dir="desc").text) == ["mid", "cheap", "dear"]
    assert _order(_get(client, "/app", sort="messages", dir="desc").text) == ["cheap", "mid", "dear"]
    # Updated: newest first by default, oldest first on request.
    assert _order(_get(client, "/app").text) == ["cheap", "dear", "mid"]
    assert _order(_get(client, "/app", sort="updated", dir="asc").text) == ["mid", "dear", "cheap"]


async def test_run_view_sorts_by_what_the_row_shows(client, db_session, session_factory):
    """A run row shows its whole run (itself plus every subtask, marked Σ), so
    sorting by cost must use that figure, or the column would read out of order."""
    await _seed_user(db_session)
    await _seed(
        session_factory,
        {"id": "parent", "title": "Parent", "cost": 0.1, "tokens_in": 10},
        {"id": "child", "title": "Child", "cost": 5.0, "tokens_in": 90000, "parent_task_id": "parent"},
        {"id": "grandchild", "title": "Grandchild", "cost": 1.0, "tokens_in": 1, "parent_task_id": "child"},
        {"id": "solo", "title": "Solo", "cost": 1.0, "tokens_in": 50000},
    )

    roots = _get(client, "/app", sort="cost", dir="desc").text
    assert [t for t in _order(roots) if t in ("parent", "solo")] == ["parent", "solo"]
    roots_tokens = _get(client, "/app", sort="tokens", dir="desc").text
    assert [t for t in _order(roots_tokens) if t in ("parent", "solo")] == ["parent", "solo"]


async def test_a_cycle_does_not_break_the_run_sort(client, db_session, session_factory):
    await _seed_user(db_session)
    await _seed(
        session_factory,
        {"id": "a", "title": "A", "cost": 1.0},
        {"id": "b", "title": "B", "cost": 2.0, "parent_task_id": "a"},
        {"id": "solo", "title": "Solo", "cost": 2.5},
    )
    # Close the loop after the fact, the way client-supplied links can.
    async with session_factory() as s:
        a = await s.get(Task, "a")
        a.parent_task_id = "b"
        await s.commit()

    resp = _get(client, "/app", sort="cost", dir="desc", scope="all")
    assert resp.status_code == 200
    # a and b each count the other once, not endlessly: 3.0 each, above solo.
    assert _order(resp.text).index("solo") == 2


@pytest.mark.parametrize(
    "params",
    [
        {"sort": "title"},
        {"sort": "cost; DROP TABLE tasks"},
        {"sort": "updated_at"},
        {"dir": "sideways"},
        {"sort": "cost", "dir": "DESC; --"},
    ],
)
async def test_only_allow_listed_sorts_are_honoured(params, client, db_session, session_factory):
    """Anything outside the allow-list falls back to the default instead of
    reaching the query or failing the page."""
    await _seed_user(db_session)
    await _seed(
        session_factory,
        {"id": "new", "title": "New", "cost": 0.0},
        {"id": "old", "title": "Old", "cost": 9.0},
    )

    resp = _get(client, "/app", **params)
    assert resp.status_code == 200
    expected = ["old", "new"] if params.get("sort") == "cost" else ["new", "old"]
    assert _order(resp.text) == expected
    # And the bogus value is not echoed back into the links.
    for bad in ("title", "DROP", "updated_at", "sideways", "--"):
        if bad in str(params.values()):
            assert all(bad not in h for h in _hrefs(resp.text)), bad


async def test_pager_links_keep_the_sort_and_filters(client, db_session, session_factory, monkeypatch):
    from src.routers import web_tasks

    monkeypatch.setattr(web_tasks, "PAGE_SIZE", 2)
    await _seed_user(db_session)
    await _seed(
        session_factory,
        *({"id": f"t{i}", "title": f"Task {i}", "cost": float(i), "models": "glm-5.3"} for i in range(10)),
    )

    html = _get(client, "/app", sort="cost", dir="asc", model="glm", page="2").text
    hrefs = _hrefs(html)
    for n in (1, 3, 4):
        assert f"/app?scope=roots&page={n}&model=glm&sort=cost&dir=asc" in hrefs, n
    # Page 2 of the cheapest-first list: tasks 2 and 3.
    assert _order(html) == ["t2", "t3"]
    # The compact pager a phone shows.
    assert re.search(r'class="pager-status"[^>]*>\s*2 / 5\s*<', html)
    # The jump form keeps them too (only rendered past the numbered window).
    monkeypatch.setattr(web_tasks, "PAGE_SIZE", 1)
    jump = _get(client, "/app", sort="cost", dir="asc", model="glm").text
    form = jump[jump.index('class="pager-jump"'):]
    form = form[:form.index("</form>")]
    assert 'name="sort" value="cost"' in form and 'name="model" value="glm"' in form


# --- filters ------------------------------------------------------------------


async def _seed_filterable(session_factory):
    await _seed(
        session_factory,
        {
            "id": "clean",
            "title": "Clean run",
            "workspace_path": "/home/a/Projekty/alpha",
            "models": "claude-opus-5",
            "q_completed": True,
            "age": 60 * 24 * 10,  # 2026-05-22
        },
        {
            "id": "friction",
            "title": "Friction run",
            "workspace_path": "/home/a/Projekty/beta",
            "models": "glm-5.3,claude-opus-5",
            "q_completed": True,
            "q_errors": 2,
            "age": 60 * 24 * 2,  # 2026-05-30
        },
        {
            "id": "repeats",
            "title": "Repeated work",
            "workspace_path": "/home/a/Projekty/beta",
            "models": "glm-5.3",
            "q_completed": True,
            "q_tool_paths": 5,
            "q_distinct_tool_paths": 3,
            "age": 60,  # 2026-06-01
        },
        {
            "id": "unfinished",
            "title": "Unfinished run",
            "workspace_path": "C:\\work\\gamma",
            "models": None,
            "q_completed": False,
            "age": 0,
        },
        {"id": "kid", "title": "Kid", "parent_task_id": "unfinished", "q_completed": True, "age": 1},
    )


@pytest.mark.parametrize(
    "params, expected",
    [
        ({"project": "beta"}, ["repeats", "friction"]),
        ({"project": "GAMMA"}, ["unfinished"]),
        ({"model": "opus"}, ["friction", "clean"]),
        ({"grade": "clean"}, ["clean"]),
        ({"grade": "friction"}, ["repeats", "friction"]),
        ({"grade": "unfinished"}, ["unfinished"]),
        ({"since": "2026-05-30"}, ["unfinished", "repeats", "friction"]),
        ({"until": "2026-05-30"}, ["friction", "clean"]),
        ({"since": "2026-05-23", "until": "2026-05-31"}, ["friction"]),
        ({"subtasks": "1"}, ["unfinished"]),
        ({"project": "beta", "model": "glm", "grade": "friction"}, ["repeats", "friction"]),
        # Unusable values are ignored rather than failing the page.
        ({"grade": "excellent"}, ["unfinished", "repeats", "friction", "clean"]),
        ({"since": "yesterday"}, ["unfinished", "repeats", "friction", "clean"]),
        ({"subtasks": "maybe"}, ["unfinished", "repeats", "friction", "clean"]),
    ],
)
async def test_filters_narrow_the_list(params, expected, client, db_session, session_factory):
    await _seed_user(db_session)
    await _seed_filterable(session_factory)

    resp = _get(client, "/app", **params)
    assert resp.status_code == 200
    # "kid" is nested under its run, not a row of the list of runs.
    assert [t for t in _order(resp.text) if t != "kid"] == expected


async def test_project_and_model_filters_match_wildcards_literally(client, db_session, session_factory):
    await _seed_user(db_session)
    await _seed(
        session_factory,
        {"id": "pct", "title": "Pct", "workspace_path": "/w/100%_done"},
        {"id": "other", "title": "Other", "workspace_path": "/w/100x-done"},
    )
    assert _order(_get(client, "/app", project="100%_").text) == ["pct"]


async def test_the_filter_form_is_a_plain_get_form(client, db_session, session_factory):
    """Works without scripting: every filter is a named field of one GET form
    that also carries the scope and sort, so applying a filter keeps them."""
    await _seed_user(db_session)
    await _seed_filterable(session_factory)

    html = _get(client, "/app", sort="cost", dir="asc", scope="all").text
    form = html[html.index('id="filter-form"'):]
    form = form[:form.index("</form>")]
    assert 'method="get"' in form and 'action="/app"' in form
    for name in ("q", "project", "model", "grade", "since", "until", "subtasks"):
        assert f'name="{name}"' in form, name
    assert 'name="scope" value="all"' in form
    assert 'name="sort" value="cost"' in form
    assert 'name="dir" value="asc"' in form
    assert 'type="submit"' in form
    # Suggestions come from the user's own projects and models.
    assert '<option value="beta">' in html
    assert '<option value="glm-5.3">' in html
    assert '<option value="claude-opus-5">' in html


async def test_active_filters_show_as_removable_chips(client, db_session, session_factory):
    await _seed_user(db_session)
    await _seed_filterable(session_factory)

    html = _get(client, "/app", project="beta", grade="friction", q="run", sort="cost", dir="asc").text
    chips = re.findall(r'<a class="filter-chip" href="([^"]+)"[^>]*>(.*?)</a>', html, re.DOTALL)
    by_label = {re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", label)).strip(): unescape(href) for href, label in chips}

    assert set(by_label) == {"Search: run ✕", "Project: beta ✕", "Grade: Friction ✕"}
    # Each chip drops its own filter and keeps everything else.
    assert by_label["Project: beta ✕"] == "/app?scope=roots&q=run&grade=friction&sort=cost&dir=asc"
    assert by_label["Grade: Friction ✕"] == "/app?scope=roots&q=run&project=beta&sort=cost&dir=asc"
    assert by_label["Search: run ✕"] == "/app?scope=roots&project=beta&grade=friction&sort=cost&dir=asc"
    # And one link clears them all, keeping the scope and sort.
    assert "/app?scope=roots&sort=cost&dir=asc" in _hrefs(html)


async def test_no_chips_without_filters(client, db_session, session_factory):
    await _seed_user(db_session)
    await _seed_filterable(session_factory)
    assert 'class="filter-chip"' not in _get(client, "/app").text


async def test_a_filtered_empty_list_offers_the_way_back(client, db_session, session_factory):
    await _seed_user(db_session)
    await _seed_filterable(session_factory)

    html = _get(client, "/app", project="nowhere", grade="clean").text
    assert _order(html) == []
    assert "No tasks match these filters" in html
    empty = html[html.index('class="empty"'):]
    assert 'class="filter-chip"' in empty
    assert "/app?scope=roots" in _hrefs(empty)


async def test_the_results_are_one_swappable_region(client, db_session, session_factory):
    """tasklist.js re-fetches the same page and swaps these regions by id, so
    the filter form (and the caret in it) is never replaced."""
    await _seed_user(db_session)
    await _seed_filterable(session_factory)

    html = _get(client, "/app", grade="friction").text
    results = html.index('id="task-results"')
    assert html.index('id="filter-form"') < results
    assert html.index('id="bulk-form"') > results
    assert 'data-swap' in html[results - 200:results + 50]
    assert re.search(r'id="list-count"[^>]*data-swap', html)


async def test_bulk_delete_returns_to_the_same_view(client, db_session, session_factory):
    await _seed_user(db_session)
    await _seed_filterable(session_factory)

    _override_web_user(client.app)
    try:
        page = client.get("/app", params={"project": "beta", "sort": "cost", "dir": "asc", "q": "run"}).text
        form = page[page.index('id="bulk-form"'):]
        hidden = dict(re.findall(r'<input type="hidden" name="(\w+)" value="([^"]*)"', form[:form.index("<ul")]))
        assert hidden == {"scope": "roots", "q": "run", "project": "beta", "sort": "cost", "dir": "asc"}
        resp = client.post(
            "/app/tasks/bulk-delete",
            data={"task_ids": ["friction"], **{k: unescape(v) for k, v in hidden.items()}},
            follow_redirects=False,
        )
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.status_code == 303
    assert resp.headers["location"] == "/app?scope=roots&q=run&project=beta&sort=cost&dir=asc"


async def test_select_mode_and_density_controls_are_on_the_page(client, db_session, session_factory):
    """Select mode (the phone layout hides the checkboxes until it is on) is a
    real checkbox, so it works without scripting; the density toggle is a
    preference and is revealed by the script that implements it."""
    await _seed_user(db_session)
    await _seed_filterable(session_factory)

    html = _get(client, "/app").text
    assert re.search(r'<input type="checkbox" id="select-mode"[^>]*>', html)
    assert re.search(r'<button type="button" id="density-toggle"[^>]*aria-pressed="false"[^>]*hidden', html)
