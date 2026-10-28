"""The task list as a scanning tool: column headers, sorting, filters, chips.

UI modernization plan (ai_plans/2026-09-27_ui-modernization.md) section 3.2.
Sorting and filtering are server-side and plain GET parameters, so every state
of the list is a URL: it works without scripting, survives a reload, and the
pager, the filter chips and a bulk delete all carry it along.
"""

import re
from pathlib import Path
from datetime import datetime, timedelta, timezone
from html import unescape
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import update

from src.auth.web_session import get_web_user_optional
from src.models.organization import Membership, Organization
from src.models.project import Project
from src.models.task import Task
from src.services.model_attribution import primary_model
from src.services.projects import folder_key
from src.services.task_tree import refresh_run_totals
from src.web.presenters import task_list
from tests.web_helpers import _override_web_user, _seed_user

BASE = datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)


async def _seed(session_factory, *rows, user_id="user_test"):
    """rows: dicts of Task columns; ``age`` (minutes before BASE) sets updated_at.

    The derived columns are written as the write paths write them: the primary
    model with the models label, the run totals once every row exists.
    """
    async with session_factory() as s:
        for n, row in enumerate(rows):
            row = dict(row)
            age = row.pop("age", n)
            models = row.get("models")
            s.add(
                Task(
                    user_id=user_id,
                    created_at=BASE - timedelta(minutes=age),
                    updated_at=BASE - timedelta(minutes=age),
                    primary_model=primary_model(models) if models else None,
                    **row,
                )
            )
            await s.flush()
        await refresh_run_totals(s, [row["id"] for row in rows])
        await s.commit()


async def _seed_projects(session_factory, *projects):
    """projects: (id, name, key) of the reader's personal projects."""
    async with session_factory() as s:
        for project_id, name, key in projects:
            s.add(
                Project(
                    id=project_id,
                    tenant_id="user_test",
                    user_id="user_test",
                    key=key,
                    name=name,
                )
            )
        await s.commit()


_STATIC = Path(__file__).resolve().parent.parent / "src" / "web" / "static"


def _get(client, path, **params):
    """One visit from a fresh browser: nothing remembered from the last one."""
    client.cookies.clear()
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


async def test_the_count_names_what_it_counts(client, db_session, session_factory):
    """Under "Runs" the pill once read "Your tasks 135" beside "All 247": it
    counts runs (a subtask folds into its run), so it says so."""
    await _seed_user(db_session)
    await _seed(
        session_factory,
        {"id": "run-a", "title": "Run A"},
        {"id": "run-b", "title": "Run B"},
        {"id": "sub-a", "title": "Sub A", "parent_task_id": "run-a"},
    )

    def pill(html):
        return re.search(r'<span class="count-pill">([^<]*)</span>', html).group(1)

    runs = _get(client, "/app", group="none").text
    assert pill(runs) == "2 runs"
    assert re.search(r">All 3</a>", runs)
    assert pill(_get(client, "/app", scope="all", group="none").text) == "3 tasks"
    # One row, one noun.
    assert pill(_get(client, "/app", group="none", q="Run A").text) == "1 run"
    assert (
        pill(_get(client, "/app", scope="all", group="none", q="Sub").text) == "1 task"
    )


async def test_every_column_has_a_header(client, db_session, session_factory):
    """Seven columns, and once only the title and the date were labelled.

    Project and model are no longer columns of their own: they ride on a second
    line under the title (so the title gets the free width), and the title's
    header names that line."""
    await _seed_user(db_session)
    await _seed(session_factory, {"id": "t1", "title": "One"})

    html = _get(client, "/app").text

    head = html[html.index('class="task-head"') : html.index('class="task-list"')]
    for label in ("Messages", "Duration", "Tokens", "Cost", "Grade", "Updated"):
        assert f">{label}<" in head, label
    title_head = re.search(
        r'<span class="head-label head-title">(.*?)</span></span>', head
    ).group(1)
    assert (
        title_head.startswith("Task<")
        and "folder" in title_head
        and "model" in title_head
    )
    # A header row, not a data row: the per-row tests count class="task-item".
    assert html.count('class="task-item"') == 1


async def test_the_title_gets_the_free_width_and_project_and_model_ride_under_it(
    client, db_session, session_factory
):
    """At 1280px the title was cut to about 20 characters while two fixed
    badge columns (project, model) took 17rem of the row. The title's track is
    the only elastic one, and the badges sit in the same cell, under it."""
    await _seed_user(db_session)
    await _seed(
        session_factory, {"id": "t1", "title": "One", "workspace_path": "/home/a/proj"}
    )

    html = _get(client, "/app", group="none").text

    row = html[html.index('class="task-link"') :]
    row = row[: row.index("</a>")]
    main = re.search(
        r'<span class="cell-main">(.*?)</span>\s*</span>\s*<span class="cell-num">',
        row,
        re.DOTALL,
    )
    assert main, row
    assert 'class="cell-title"' in main.group(
        1
    ) and 'class="badge badge-workspace"' in main.group(1)
    # No badge columns left beside the title.
    assert "cell-workspace" not in html and "cell-model" not in html

    css = (_STATIC / "app.css").read_text(encoding="utf-8")
    cols = re.search(r"--task-cols:\s*([^;]+);", css).group(1).split()
    assert cols[0] == "minmax(0," and cols[1] == "1fr)"
    assert not any("fr" in c for c in cols[2:]), cols
    # Head, rows and group headers share the one track list, so the labels and
    # the group totals stay over their columns.
    assert css.count("grid-template-columns: var(--task-cols);") == 3


async def test_sortable_headers_link_to_the_sorted_list(
    client, db_session, session_factory
):
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
    assert re.search(
        r'<a[^>]*sort=updated[^>]*>Updated<span class="sr-only">, sorted descending</span>',
        html,
    )


# --- sorting ------------------------------------------------------------------


async def test_sort_by_cost_tokens_and_messages(client, db_session, session_factory):
    await _seed_user(db_session)
    await _seed(
        session_factory,
        {
            "id": "cheap",
            "title": "Cheap",
            "cost": 0.01,
            "tokens_in": 900,
            "tokens_out": 10,
            "message_count": 50,
        },
        {
            "id": "dear",
            "title": "Dear",
            "cost": 2.5,
            "tokens_in": 100,
            "tokens_out": 5,
            "message_count": 3,
        },
        {
            "id": "mid",
            "title": "Mid",
            "cost": 0.4,
            "tokens_in": 5000,
            "tokens_out": 50,
            "message_count": 10,
        },
    )

    assert _order(_get(client, "/app", sort="cost", dir="desc").text) == [
        "dear",
        "mid",
        "cheap",
    ]
    assert _order(_get(client, "/app", sort="cost", dir="asc").text) == [
        "cheap",
        "mid",
        "dear",
    ]
    assert _order(_get(client, "/app", sort="tokens", dir="desc").text) == [
        "mid",
        "cheap",
        "dear",
    ]
    assert _order(_get(client, "/app", sort="messages", dir="desc").text) == [
        "cheap",
        "mid",
        "dear",
    ]
    # Updated: newest first by default, oldest first on request.
    assert _order(_get(client, "/app").text) == ["cheap", "dear", "mid"]
    assert _order(_get(client, "/app", sort="updated", dir="asc").text) == [
        "mid",
        "dear",
        "cheap",
    ]


async def test_run_view_sorts_by_what_the_row_shows(
    client, db_session, session_factory
):
    """A run row shows its whole run (itself plus every subtask, marked Σ), so
    sorting by cost must use that figure, or the column would read out of order."""
    await _seed_user(db_session)
    await _seed(
        session_factory,
        {"id": "parent", "title": "Parent", "cost": 0.1, "tokens_in": 10},
        {
            "id": "child",
            "title": "Child",
            "cost": 5.0,
            "tokens_in": 90000,
            "parent_task_id": "parent",
        },
        {
            "id": "grandchild",
            "title": "Grandchild",
            "cost": 1.0,
            "tokens_in": 1,
            "parent_task_id": "child",
        },
        {"id": "solo", "title": "Solo", "cost": 1.0, "tokens_in": 50000},
    )

    roots = _get(client, "/app", sort="cost", dir="desc").text
    assert [t for t in _order(roots) if t in ("parent", "solo")] == ["parent", "solo"]
    roots_tokens = _get(client, "/app", sort="tokens", dir="desc").text
    assert [t for t in _order(roots_tokens) if t in ("parent", "solo")] == [
        "parent",
        "solo",
    ]


async def test_a_cycle_does_not_break_the_run_sort(client, db_session, session_factory):
    await _seed_user(db_session)
    await _seed(
        session_factory,
        {"id": "a", "title": "A", "cost": 1.0},
        {"id": "b", "title": "B", "cost": 2.0, "parent_task_id": "a"},
        {"id": "solo", "title": "Solo", "cost": 2.5},
    )
    # Close the loop after the fact, the way client-supplied links can, and
    # recompute as the link writers do (services/task_tree).
    async with session_factory() as s:
        a = await s.get(Task, "a")
        a.parent_task_id = "b"
        await refresh_run_totals(s, ["a"])
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
async def test_only_allow_listed_sorts_are_honoured(
    params, client, db_session, session_factory
):
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


async def test_pager_links_keep_the_sort_and_filters(
    client, db_session, session_factory, monkeypatch
):
    monkeypatch.setattr(task_list, "PAGE_SIZE", 2)
    await _seed_user(db_session)
    await _seed(
        session_factory,
        *(
            {"id": f"t{i}", "title": f"Task {i}", "cost": float(i), "models": "glm-5.3"}
            for i in range(10)
        ),
    )

    html = _get(
        client, "/app", group="none", sort="cost", dir="asc", model="glm", page="2"
    ).text
    hrefs = _hrefs(html)
    for n in (1, 3, 4):
        assert (
            f"/app?scope=roots&group=none&page={n}&model=glm&sort=cost&dir=asc" in hrefs
        ), n
    # Page 2 of the cheapest-first list: tasks 2 and 3.
    assert _order(html) == ["t2", "t3"]
    # The compact pager a phone shows.
    assert re.search(r'class="pager-status"[^>]*>\s*2 / 5\s*<', html)
    # The jump form keeps them too (only rendered past the numbered window).
    monkeypatch.setattr(task_list, "PAGE_SIZE", 1)
    jump = _get(client, "/app", group="none", sort="cost", dir="asc", model="glm").text
    form = jump[jump.index('class="pager-jump"') :]
    form = form[: form.index("</form>")]
    assert 'name="sort" value="cost"' in form and 'name="model" value="glm"' in form


# --- filters ------------------------------------------------------------------


async def _seed_filterable(session_factory):
    """Three projects; beta's two runs ran in two worktrees of its repository."""
    await _seed_projects(
        session_factory,
        ("prj_alpha", "alpha", "github.com/a/alpha"),
        ("prj_beta", "beta", "github.com/a/beta"),
        ("prj_gamma", "gamma", folder_key("user_test", "C:\\work\\g-tool")),
    )
    await _seed(
        session_factory,
        {
            "id": "clean",
            "title": "Clean run",
            "workspace_path": "/home/a/Projekty/alpha",
            "project_id": "prj_alpha",
            "models": "claude-opus-5",
            "q_completed": True,
            "age": 60 * 24 * 10,  # 2026-05-22
        },
        {
            "id": "friction",
            "title": "Friction run",
            "workspace_path": "/home/a/Projekty/beta",
            "project_id": "prj_beta",
            "models": "glm-5.3,claude-opus-5",
            "q_completed": True,
            "q_errors": 2,
            "age": 60 * 24 * 2,  # 2026-05-30
        },
        {
            "id": "repeats",
            "title": "Repeated work",
            "workspace_path": "/tmp/beta-wt-fix",
            "project_id": "prj_beta",
            "models": "glm-5.3",
            "q_completed": True,
            "q_tool_paths": 5,
            "q_distinct_tool_paths": 3,
            "age": 60,  # 2026-06-01
        },
        {
            "id": "unfinished",
            "title": "Unfinished run",
            "workspace_path": "C:\\work\\g-tool",
            "project_id": "prj_gamma",
            "models": None,
            "q_completed": False,
            "age": 0,
        },
        {
            "id": "kid",
            "title": "Kid",
            "parent_task_id": "unfinished",
            "q_completed": True,
            "age": 1,
        },
    )


@pytest.mark.parametrize(
    "params, expected",
    [
        # Both worktrees of beta's repository.
        ({"project": "prj_beta"}, ["repeats", "friction"]),
        ({"project": "prj_gamma"}, ["unfinished"]),
        # The search finds a project's name, not only paths and titles.
        ({"q": "gamma"}, ["unfinished"]),
        ({"model": "opus"}, ["friction", "clean"]),
        ({"grade": "clean"}, ["clean"]),
        ({"grade": "friction"}, ["repeats", "friction"]),
        ({"grade": "unfinished"}, ["unfinished"]),
        ({"since": "2026-05-30"}, ["unfinished", "repeats", "friction"]),
        ({"until": "2026-05-30"}, ["friction", "clean"]),
        ({"since": "2026-05-23", "until": "2026-05-31"}, ["friction"]),
        ({"subtasks": "1"}, ["unfinished"]),
        (
            {"project": "prj_beta", "model": "glm", "grade": "friction"},
            ["repeats", "friction"],
        ),
        # Unusable values are ignored rather than failing the page.
        ({"grade": "excellent"}, ["unfinished", "repeats", "friction", "clean"]),
        ({"since": "yesterday"}, ["unfinished", "repeats", "friction", "clean"]),
        ({"subtasks": "maybe"}, ["unfinished", "repeats", "friction", "clean"]),
    ],
)
async def test_filters_narrow_the_list(
    params, expected, client, db_session, session_factory
):
    await _seed_user(db_session)
    await _seed_filterable(session_factory)

    resp = _get(client, "/app", **params)
    assert resp.status_code == 200
    # "kid" is nested under its run, not a row of the list of runs.
    assert [t for t in _order(resp.text) if t != "kid"] == expected


async def test_the_model_filter_matches_wildcards_literally(
    client, db_session, session_factory
):
    await _seed_user(db_session)
    await _seed(
        session_factory,
        {"id": "pct", "title": "Pct", "models": "q-100%_done"},
        {"id": "other", "title": "Other", "models": "q-100x-done"},
    )
    assert _order(_get(client, "/app", group="none", model="100%_").text) == ["pct"]


async def test_the_filter_form_is_a_plain_get_form(client, db_session, session_factory):
    """Works without scripting: every filter is a named field of one GET form
    that also carries the scope and sort, so applying a filter keeps them."""
    await _seed_user(db_session)
    await _seed_filterable(session_factory)

    html = _get(client, "/app", sort="cost", dir="asc", scope="all").text
    form = html[html.index('id="filter-form"') :]
    form = form[: form.index("</form>")]
    assert 'method="get"' in form and 'action="/app"' in form
    for name in ("q", "project", "model", "grade", "since", "until", "subtasks"):
        assert f'name="{name}"' in form, name
    assert 'name="scope" value="all"' in form
    assert 'name="sort" value="cost"' in form
    assert 'name="dir" value="asc"' in form
    assert 'type="submit"' in form


async def test_the_pickers_offer_every_project_and_model_whatever_is_picked(
    client, db_session, session_factory
):
    """The options are the projects and models of the user's own tasks, not
    what the filtered list holds; a project is picked by id and offered by
    name, and a value no task has any more is still shown."""
    await _seed_user(db_session)
    await _seed_filterable(session_factory)
    # A project of no task of the reader's is not offered.
    await _seed_projects(session_factory, ("prj_idle", "idle", "github.com/a/idle"))

    html = _get(client, "/app", project="prj_beta", model="gone-model").text

    def picker(name):
        part = html[html.index(f'<select class="filter-pick" name="{name}">') :]
        part = part[: part.index("</select>")]
        return re.findall(r'<option value="([^"]*)"( selected)?>([^<]*)<', part)

    assert picker("project") == [
        ("", "", "Any"),
        ("prj_alpha", "", "alpha"),
        ("prj_beta", " selected", "beta"),
        ("prj_gamma", "", "gamma"),
    ]
    assert picker("model") == [
        ("", "", "Any"),
        ("claude-opus-5", "", "claude-opus-5"),
        ("glm-5.3", "", "glm-5.3"),
        ("gone-model", " selected", "gone-model"),
    ]


async def test_active_filters_show_as_removable_chips(
    client, db_session, session_factory
):
    await _seed_user(db_session)
    await _seed_filterable(session_factory)

    html = _get(
        client,
        "/app",
        project="prj_beta",
        grade="friction",
        q="run",
        sort="cost",
        dir="asc",
    ).text
    chips = re.findall(
        r'<a class="filter-chip" href="([^"]+)"[^>]*>(.*?)</a>', html, re.DOTALL
    )
    by_label = {
        re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", label)).strip(): unescape(href)
        for href, label in chips
    }

    assert set(by_label) == {"Search: run ✕", "Project: beta ✕", "Grade: Friction ✕"}
    # Each chip drops its own filter and keeps everything else.
    assert (
        by_label["Project: beta ✕"]
        == "/app?scope=roots&q=run&grade=friction&sort=cost&dir=asc"
    )
    assert (
        by_label["Grade: Friction ✕"]
        == "/app?scope=roots&q=run&project=prj_beta&sort=cost&dir=asc"
    )
    assert (
        by_label["Search: run ✕"]
        == "/app?scope=roots&project=prj_beta&grade=friction&sort=cost&dir=asc"
    )
    # And one link clears them all, keeping the scope and sort.
    assert "/app?scope=roots&sort=cost&dir=asc" in _hrefs(html)


async def test_no_chips_without_filters(client, db_session, session_factory):
    await _seed_user(db_session)
    await _seed_filterable(session_factory)
    assert 'class="filter-chip"' not in _get(client, "/app").text


async def test_a_filtered_empty_list_offers_the_way_back(
    client, db_session, session_factory
):
    await _seed_user(db_session)
    await _seed_filterable(session_factory)

    html = _get(client, "/app", project="nowhere", grade="clean").text
    assert _order(html) == []
    assert "No tasks match these filters" in html
    empty = html[html.index('class="empty"') :]
    assert 'class="filter-chip"' in empty
    assert "/app?scope=roots" in _hrefs(empty)


@pytest.mark.parametrize("name", ["project", "only"])
async def test_a_folder_path_from_an_old_view_matches_nothing(
    name, client, db_session, session_factory
):
    """Before projects were ids the project filter and a "Show all" link
    carried a folder path. An old link, and the view it left remembered, show
    an empty list with the chip to remove, not an error."""
    await _seed_user(db_session)
    await _seed_filterable(session_factory)
    path = "/home/a/Projekty/beta"

    _override_web_user(client.app)
    try:
        client.cookies.clear()
        linked = client.get("/app", params={name: path})
        remembered = client.get("/app")
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    for resp in (linked, remembered):
        assert resp.status_code == 200
        assert _order(resp.text) == []
        assert "No tasks match these filters" in resp.text
        assert f'aria-label="Remove filter Project: {path}"' in resp.text


async def test_the_results_are_one_swappable_region(
    client, db_session, session_factory
):
    """tasklist.js re-fetches the same page and swaps these regions by id, so
    the filter form (and the caret in it) is never replaced."""
    await _seed_user(db_session)
    await _seed_filterable(session_factory)

    html = _get(client, "/app", grade="friction").text
    results = html.index('id="task-results"')
    assert html.index('id="filter-form"') < results
    assert html.index('id="bulk-form"') > results
    assert "data-swap" in html[results - 200 : results + 50]
    assert re.search(r'id="list-count"[^>]*data-swap', html)


@pytest.mark.parametrize(
    "params, hidden, location",
    [
        (
            {"project": "prj_beta", "sort": "cost", "dir": "asc", "q": "run"},
            {
                "scope": "roots",
                "q": "run",
                "project": "prj_beta",
                "sort": "cost",
                "dir": "asc",
            },
            "/app?scope=roots&q=run&project=prj_beta&sort=cost&dir=asc",
        ),
        # A narrowed group is part of the view too.
        (
            {"group": "model", "only": "glm-5.3", "sort": "cost", "dir": "asc"},
            {
                "scope": "roots",
                "group": "model",
                "only": "glm-5.3",
                "sort": "cost",
                "dir": "asc",
            },
            "/app?scope=roots&group=model&only=glm-5.3&sort=cost&dir=asc",
        ),
    ],
)
async def test_bulk_delete_returns_to_the_same_view(
    params, hidden, location, client, db_session, session_factory
):
    await _seed_user(db_session)
    await _seed_filterable(session_factory)

    _override_web_user(client.app)
    try:
        page = client.get("/app", params=params).text
        form = page[page.index('id="bulk-form"') :]
        found = dict(
            re.findall(
                r'<input type="hidden" name="(\w+)" value="([^"]*)"',
                form[: form.index("<ul")],
            )
        )
        assert found == hidden
        resp = client.post(
            "/app/tasks/bulk-delete",
            data={
                "task_ids": ["friction"],
                **{k: unescape(v) for k, v in found.items()},
            },
            follow_redirects=False,
        )
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.status_code == 303
    assert resp.headers["location"] == location


@pytest.mark.parametrize(
    "params",
    [
        {
            "scope": "all",
            "group": "none",
            "project": "prj_beta",
            "sort": "cost",
            "dir": "asc",
        },
        # Characters a query string and a cookie both treat specially.
        {"group": "model", "q": 'a+b&c=%"; d', "only": "glm-5.3"},
    ],
)
async def test_a_bare_visit_opens_on_the_view_last_looked_at(
    params, client, db_session, session_factory
):
    """The nav link is a bare /app; it restores the last view. A URL with
    parameters is a whole view, wins over the remembered one and replaces it."""
    await _seed_user(db_session)
    await _seed_filterable(session_factory)
    fresh = _get(client, "/app").text

    _override_web_user(client.app)
    try:
        picked = client.get("/app", params=params).text
        restored = client.get("/app").text
        cleared = client.get("/app", params={"scope": "roots"}).text
        after_clear = client.get("/app").text
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    # Every link on the page is built from the view, so equal links are an
    # equal view.
    assert _hrefs(restored) == _hrefs(picked) != _hrefs(fresh)
    assert _order(restored) == _order(picked)
    assert _hrefs(cleared) == _hrefs(after_clear) == _hrefs(fresh)


async def test_select_mode_and_density_controls_are_on_the_page(
    client, db_session, session_factory
):
    """Select mode (the phone layout hides the checkboxes until it is on) is a
    real checkbox, so it works without scripting; the density toggle is a
    preference and is revealed by the script that implements it."""
    await _seed_user(db_session)
    await _seed_filterable(session_factory)

    html = _get(client, "/app").text
    assert re.search(r'<input type="checkbox" id="select-mode"[^>]*>', html)
    assert re.search(
        r'<button type="button" id="density-toggle"[^>]*aria-pressed="false"[^>]*hidden',
        html,
    )


# --- groups -------------------------------------------------------------------


def _groups(html: str) -> list[dict]:
    """The group headers in page order: label, header text (tags dropped), the
    task ids under it (nested subtasks included) and its "Show all" link."""
    out = []
    for part in html.split('<details class="task-group"')[1:]:
        part = part[: part.index("</details>")]
        head = part[: part.index("</summary>")]
        more = re.search(r'class="group-more" href="([^"]*)"', part)
        out.append(
            {
                "label": re.search(r'class="group-label"[^>]*>([^<]*)<', head).group(1),
                "text": " ".join(re.sub(r"<[^>]+>", " ", head).split()),
                "ids": _order(part),
                "more": unescape(more.group(1)) if more else None,
                "html": part,
            }
        )
    return out


async def _seed_spend(session_factory):
    """Two projects and tasks without one. alpha is a repository whose runs
    ran in two worktrees, one with a subtask, so its run total differs from the
    sum of its rows' own figures; beta is a folder without git."""
    await _seed_projects(
        session_factory,
        ("prj_alpha", "alpha", "github.com/a/alpha"),
        ("prj_beta", "beta", folder_key("user_test", "/w/beta")),
    )
    await _seed(
        session_factory,
        {
            "id": "a1",
            "title": "A1",
            "workspace_path": "/w/alpha",
            "project_id": "prj_alpha",
            "cost": 0.1,
            "tokens_in": 100,
            "duration_ms": 30_000,
            "message_count": 2,
            "age": 30,
        },
        {
            "id": "a1-sub",
            "title": "A1 sub",
            "workspace_path": "/w/alpha",
            "project_id": "prj_alpha",
            "parent_task_id": "a1",
            "cost": 1.0,
            "tokens_in": 1000,
            "duration_ms": 60_000,
            "message_count": 3,
            "age": 31,
        },
        {
            "id": "a2",
            "title": "A2",
            "workspace_path": "/tmp/alpha-wt",
            "project_id": "prj_alpha",
            "cost": 0.2,
            "tokens_in": 200,
            "duration_ms": 15_000,
            "message_count": 4,
            "age": 20,
        },
        {
            "id": "b1",
            "title": "B1",
            "workspace_path": "/w/beta",
            "project_id": "prj_beta",
            "cost": 5.0,
            "age": 0,
        },
        # A folder no client has reported yet has no project either.
        {"id": "n1", "title": "N1", "workspace_path": "/w/unbound", "age": 10},
    )


@pytest.mark.parametrize(
    "scope, alpha_count, messages, pill",
    [
        # A run's row shows its whole run's spend, so the group sums run
        # totals; messages, like the rows, are each task's own.
        ("roots", "2 runs", "6 msg", "4 runs · 3 projects"),
        # Every task is a row of its own: own figures, the subtask counted once.
        ("all", "3 tasks", "9 msg", "5 tasks · 3 projects"),
    ],
)
async def test_the_list_is_grouped_by_project_by_default(
    scope, alpha_count, messages, pill, client, db_session, session_factory
):
    await _seed_user(db_session)
    await _seed_spend(session_factory)

    html = _get(client, "/app", scope=scope).text
    groups = _groups(html)

    assert f'<span class="count-pill">{pill}</span>' in html
    # Every group starts closed, also the one a filter or a search picked.
    closed = '<details class="task-group" data-group="project:{}">'
    assert closed.format("prj_alpha") in html
    assert closed.format("(none)") in html
    picked = _get(client, "/app", scope=scope, project="prj_alpha").text
    assert closed.format("prj_alpha") in picked
    searched = _get(client, "/app", scope=scope, q="beta").text
    assert closed.format("prj_beta") in searched
    # Newest activity first; tasks without a project get a group of their own.
    assert [g["label"] for g in groups] == ["beta", "No project", "alpha"]
    # Both worktrees of alpha's repository are one group, under its key.
    alpha = groups[2]
    assert alpha["ids"] == ["a2", "a1", "a1-sub"]
    for figure in (
        alpha_count,
        "github.com/a/alpha",
        messages,
        "Σ 1m 45s",
        "Σ 1.3k tok",
        "Σ $1.3000",
    ):
        assert figure in alpha["text"], figure
    assert "folder without git" in groups[0]["text"]
    assert "Σ $5.0000" in groups[0]["text"]
    # No spend, no figure, no key.
    assert "github.com" not in groups[1]["text"]
    assert "folder" not in groups[1]["text"]
    assert "$" not in groups[1]["text"]

    by_cost = _get(client, "/app", scope=scope, sort="cost", dir="desc").text
    assert [g["label"] for g in _groups(by_cost)] == ["beta", "alpha", "No project"]


@pytest.mark.parametrize(
    "group, expected",
    [
        (
            "project",
            [
                ("gamma", ["unfinished", "kid"]),
                ("beta", ["repeats", "friction"]),
                ("alpha", ["clean"]),
            ],
        ),
        # The primary (first) model only: "friction" ran glm-5.3 then opus.
        (
            "model",
            [
                ("No model", ["unfinished", "kid"]),
                ("glm-5.3", ["repeats", "friction"]),
                ("claude-opus-5", ["clean"]),
            ],
        ),
        (
            "user",
            [("t@example.com", ["unfinished", "kid", "repeats", "friction", "clean"])],
        ),
    ],
)
async def test_each_grouping_keys_a_run_by_its_own_value(
    group, expected, client, db_session, session_factory
):
    """A subtask folds into its run's group, whatever its own columns say."""
    await _seed_user(db_session)
    await _seed_filterable(session_factory)

    groups = _groups(_get(client, "/app", group=group).text)
    assert [(g["label"], g["ids"]) for g in groups] == expected


@pytest.mark.parametrize("member", [True, False])
async def test_a_project_is_named_only_to_a_reader_who_can_see_it(
    member, client, db_session, session_factory
):
    """An organization's project is named to its members. A reader who left
    the organization keeps their tasks, in a group named by the bare id."""
    await _seed_user(db_session)
    await _seed_user(db_session, "user_other", email="o@example.com")
    async with session_factory() as s:
        s.add(Organization(id="org_x", name="Acme"))
        await s.flush()
        s.add(
            Project(
                id="prj_org",
                tenant_id="org_x",
                organization_id="org_x",
                user_id="user_other",
                key="github.com/x/secret",
                name="Secret plan",
            )
        )
        if member:
            s.add(Membership(user_id="user_test", organization_id="org_x"))
        await s.commit()
    await _seed(session_factory, {"id": "t1", "title": "T1", "project_id": "prj_org"})

    grouped = _get(client, "/app").text
    narrowed = _get(client, "/app", only="prj_org").text
    filtered = _get(client, "/app", group="none", project="prj_org").text
    searched = _get(client, "/app", group="none", q="secret").text

    label = "Secret plan" if member else "prj_org"
    assert [g["label"] for g in _groups(grouped)] == [label]
    for page in (narrowed, filtered):
        assert _order(page) == ["t1"]
        assert f'aria-label="Remove filter Project: {label}"' in page
    assert _order(searched) == (["t1"] if member else [])
    for page in (grouped, narrowed, filtered, searched):
        assert ("Secret plan" in page) == member
    assert ("github.com/x/secret" in grouped) == member


async def test_a_group_header_replaces_the_badge_it_would_repeat(
    client, db_session, session_factory
):
    """The folder badge stays under a project header: a project holds every
    worktree of its repository."""
    await _seed_user(db_session)
    await _seed_filterable(session_factory)

    def badges(html, task_id, kind):
        row = html[html.index(f'name="task_ids" value="{task_id}"') :]
        row = row[: row.index("</a>")]
        return f"badge-{kind}" in row

    flat = _get(client, "/app", group="none").text
    by_project = _get(client, "/app").text
    by_model = _get(client, "/app", group="model").text

    assert badges(flat, "repeats", "workspace") and badges(flat, "repeats", "model")
    assert badges(by_project, "repeats", "workspace")
    assert badges(by_project, "repeats", "model")
    # Under its model's header a one-model run loses the badge; a run that
    # switched models keeps it, since the header names only the first.
    assert not badges(by_model, "repeats", "model")
    assert badges(by_model, "friction", "model")
    assert badges(by_model, "repeats", "workspace")


@pytest.mark.parametrize(
    "group, members, decoys, more, chip, chip_href",
    [
        (
            "project",
            # Two worktrees of one repository.
            [{"project_id": "prj_lab", "workspace_path": "/x/Lab"}] * 3
            + [{"project_id": "prj_lab", "workspace_path": "/tmp/lab-wt"}] * 3,
            # Another project; five rows need no "Show all".
            [{"project_id": "prj_cloud", "workspace_path": "/x/Lab/cloud"}] * 5
            + [{"workspace_path": "/x/Lab"}],
            "/app?scope=roots&only=prj_lab",
            "Project: Lab",
            "/app?scope=roots",
        ),
        (
            "project",
            [{}] * 6,
            [{"project_id": "prj_lab", "workspace_path": "/x/Lab"}],
            "/app?scope=roots&only=%28none%29",
            "Project: No project",
            "/app?scope=roots",
        ),
        (
            "model",
            [{"models": "glm_5"}] * 3 + [{"models": "glm_5, opus"}] * 3,
            # Secondary model, a longer name, and "_" read as a LIKE wildcard.
            [
                {"models": "opus, glm_5"},
                {"models": "glm_5x"},
                {"models": "glmX5, opus"},
            ],
            "/app?scope=roots&group=model&only=glm_5",
            "Model: glm_5",
            "/app?scope=roots&amp;group=model",
        ),
    ],
)
async def test_show_all_narrows_the_list_to_exactly_one_group(
    group, members, decoys, more, chip, chip_href, client, db_session, session_factory
):
    await _seed_user(db_session)
    await _seed_projects(
        session_factory,
        ("prj_lab", "Lab", "github.com/x/lab"),
        ("prj_cloud", "cloud", "github.com/x/cloud"),
    )
    await _seed(
        session_factory,
        *(
            {"id": f"m{n}", "title": f"M{n}", "age": n, **row}
            for n, row in enumerate(members)
        ),
        *(
            {"id": f"d{n}", "title": f"D{n}", "age": 10 + n, **row}
            for n, row in enumerate(decoys)
        ),
    )
    member_ids = [f"m{n}" for n in range(6)]

    html = _get(client, "/app", group=group).text
    [full] = [g for g in _groups(html) if g["more"]]
    assert "6 runs" in full["text"]
    assert full["ids"] == member_ids[:5]
    assert full["more"] == more
    assert "Show all 6 runs in" in full["html"]

    narrowed = _get(client, full["more"]).text
    assert _order(narrowed) == member_ids
    assert 'class="task-group"' not in narrowed
    assert (
        f'<a class="filter-chip" href="{chip_href}" aria-label="Remove filter {chip}"'
        in narrowed
    )


async def test_groups_are_paged_and_list_their_first_rows_in_the_views_order(
    client, db_session, session_factory, monkeypatch
):
    """The groups are summed in one query and paged; each group on the page
    then lists its first GROUP_ROWS runs in the sorted order, the group of
    tasks without a project too."""
    monkeypatch.setattr(task_list, "PAGE_SIZE", 2)
    monkeypatch.setattr(task_list, "GROUP_ROWS", 2)
    await _seed_user(db_session)
    await _seed_projects(
        session_factory,
        ("prj_alpha", "alpha", "github.com/a/alpha"),
        ("prj_beta", "beta", "github.com/a/beta"),
        ("prj_gamma", "gamma", "github.com/a/gamma"),
    )
    await _seed(
        session_factory,
        {"id": "a1", "title": "A1", "project_id": "prj_alpha", "cost": 1.0},
        {"id": "a2", "title": "A2", "project_id": "prj_alpha", "cost": 3.0},
        {"id": "b1", "title": "B1", "project_id": "prj_beta", "cost": 0.5},
        {"id": "g1", "title": "G1", "project_id": "prj_gamma", "cost": 10.0},
        {"id": "n1", "title": "N1", "cost": 2.0},
        {"id": "n2", "title": "N2", "cost": 0.1},
        # The costliest run of its group only through its subtask.
        {"id": "n3", "title": "N3"},
        {"id": "n3-sub", "title": "N3 sub", "parent_task_id": "n3", "cost": 5.0},
    )

    first = _get(client, "/app", sort="cost", dir="desc").text
    second = _get(client, "/app", sort="cost", dir="desc", page="2").text

    # Group sums: gamma 10, no project 7.1, alpha 4, beta 0.5.
    assert [(g["label"], g["ids"]) for g in _groups(first)] == [
        ("gamma", ["g1"]),
        ("No project", ["n3", "n3-sub", "n1"]),
    ]
    assert (
        _groups(first)[1]["more"]
        == "/app?scope=roots&only=%28none%29&sort=cost&dir=desc"
    )
    assert [(g["label"], g["ids"]) for g in _groups(second)] == [
        ("alpha", ["a2", "a1"]),
        ("beta", ["b1"]),
    ]
    assert 'aria-label="Pagination, page 2 of 2"' in second
    assert '<span class="count-pill">7 runs · 4 projects</span>' in second


async def test_a_group_its_run_leaves_while_the_page_is_read_has_no_rows(
    db_session, session_factory, monkeypatch
):
    """The groups are summed in one statement and their first rows ranked in
    the next. A run that leaves its group in between (linked as a subtask
    here; moved to a project, renamed model or deleted alike) leaves the
    group's header without rows."""
    await _seed_user(db_session)
    await _seed_projects(
        session_factory,
        ("prj_alpha", "alpha", "github.com/a/alpha"),
        ("prj_beta", "beta", "github.com/a/beta"),
    )
    await _seed(
        session_factory,
        {"id": "a1", "title": "A1", "project_id": "prj_alpha"},
        {"id": "b1", "title": "B1", "project_id": "prj_beta"},
    )
    read = db_session.execute

    async def execute(statement, *args, **kwargs):
        if "row_number" in str(statement):
            await read(update(Task).where(Task.id == "a1").values(parent_task_id="b1"))
        return await read(statement, *args, **kwargs)

    monkeypatch.setattr(db_session, "execute", execute)
    page = await task_list.list_page(
        db_session,
        task_list.ListView.parse(),
        "user_test",
        "t@example.com",
        ZoneInfo("UTC"),
        1,
    )

    assert [(g["label"], len(g["rows"])) for g in page["groups"]] == [
        ("alpha", 0),
        ("beta", 1),
    ]


async def test_group_none_is_the_flat_list_and_switching_drops_the_narrowing(
    client, db_session, session_factory
):
    await _seed_user(db_session)
    await _seed_filterable(session_factory)

    flat = _get(client, "/app", group="none").text
    assert 'class="task-group"' not in flat
    assert _order(flat) == ["unfinished", "kid", "repeats", "friction", "clean"]
    # A flat list has no group to narrow to; an unknown grouping is the default.
    assert _order(_get(client, "/app", group="none", only="glm-5.3").text) == _order(
        flat
    )
    assert [g["label"] for g in _groups(_get(client, "/app", group="bogus").text)] == [
        "gamma",
        "beta",
        "alpha",
    ]

    narrowed = _get(
        client, "/app", group="model", only="glm-5.3", sort="cost", dir="asc"
    ).text
    nav = narrowed[narrowed.index('id="group-control"') :]
    nav = nav[: nav.index("</nav>")]
    assert _hrefs(nav) == [
        "/app?scope=roots&sort=cost&dir=asc",
        "/app?scope=roots&group=model&sort=cost&dir=asc",
        "/app?scope=roots&group=user&sort=cost&dir=asc",
        "/app?scope=roots&group=none&sort=cost&dir=asc",
    ]
