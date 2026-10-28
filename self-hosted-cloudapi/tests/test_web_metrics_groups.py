"""The metrics page summed per project or per model, and narrowed to one group.

Plan: ai_plans/2026-10-27_10-00_cloud-web-metrics-groups.md. The grouping
table and the view's URLs are web/presenters/metrics_view.py; the sums are
services/metrics_service.aggregate_user_metrics.
"""

import json
import re
from datetime import datetime, timezone
from html import unescape
from urllib.parse import parse_qs, urlsplit

import pytest

from src.auth.web_session import get_web_user_optional
from src.models.event import TelemetryEvent
from src.models.project import Project
from src.models.task import Task
from src.services.metrics_service import compute_user_metrics
from src.web.presenters.metrics_view import GROUPINGS
from tests.web_helpers import _llm_event, _override_web_user, _seed_user

USER = "user_test"
OTHER = "user_other"
WHEN = datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)

# (task id, project id or None, model, input tokens, cost). "t-ghost" has no
# task row and "t-foreign" is another user's task, so both have no project.
EVENTS = [
    ("t-a1", "prj_a", "gpt-a", 1000, 0.30),
    ("t-a2", "prj_a", "llama-b", 500, 0.10),
    ("t-b", "prj_b", "llama-b", 2000, 0.50),
    ("t-none", None, "gpt-a", 100, 0.05),
    ("t-ghost", None, "gpt-a", 10, 0.01),
    ("t-foreign", None, "gpt-a", 20, 0.02),
]


@pytest.fixture
async def seeded(db_session):
    await _seed_user(db_session)
    await _seed_user(db_session, OTHER, email="o@example.com")
    db_session.add_all(
        [
            Project(id="prj_a", tenant_id=USER, user_id=USER, key="a", name="alpha"),
            Project(id="prj_b", tenant_id=USER, user_id=USER, key="b", name="beta"),
            Project(id="prj_x", tenant_id=OTHER, user_id=OTHER, key="x", name="secret"),
        ]
    )
    await db_session.flush()
    db_session.add_all(
        [
            Task(id="t-a1", user_id=USER, project_id="prj_a", models="gpt-a"),
            Task(id="t-a2", user_id=USER, project_id="prj_a", models="llama-b"),
            Task(id="t-b", user_id=USER, project_id="prj_b", models="llama-b"),
            Task(id="t-none", user_id=USER, models="gpt-a"),
            Task(id="t-foreign", user_id=OTHER, project_id="prj_x", models="gpt-a"),
        ]
    )
    db_session.add_all(
        [
            _llm_event(task_id=task, model=model, tin=tin, tout=0, cost=cost)
            for task, _, model, tin, cost in EVENTS
        ]
        + [
            TelemetryEvent(
                user_id=USER,
                event_type="Embedding Usage",
                properties=json.dumps({"promptTokens": 5000, "source": "index"}),
                created_at=WHEN,
            )
        ]
    )
    await db_session.commit()
    return db_session


async def _metrics(db, group, only=""):
    return await compute_user_metrics(
        db, USER, "all", group_key=GROUPINGS[group].event_key, only=only
    )


@pytest.mark.parametrize("group", list(GROUPINGS))
async def test_the_groups_add_up_to_the_page_totals(seeded, group):
    m = await _metrics(seeded, group)
    groups = m["groups"]
    assert sum(g["tokens"] for g in groups) == m["totals"]["total_tokens"]
    assert sum(g["cost"] for g in groups) == pytest.approx(m["totals"]["cost"])
    assert sum(g["count"] for g in groups) == m["totals"]["completions"]
    assert [g["cost"] for g in groups] == sorted(
        (g["cost"] for g in groups), reverse=True
    )
    assert sum(g["share"] for g in groups) == pytest.approx(100, abs=len(groups))


async def test_a_project_is_the_tasks_and_none_collects_the_rest(seeded):
    """No task row, no project, or another user's task: all "No project"."""
    m = await _metrics(seeded, "project")
    assert [(g["key"], g["name"], g["count"], g["tasks"]) for g in m["groups"]] == [
        ("prj_b", "beta", 1, 1),
        ("prj_a", "alpha", 2, 2),
        ("(none)", "No project", 3, 3),
    ]
    assert [g["share"] for g in m["groups"]] == [51, 41, 8]


@pytest.mark.parametrize("group", list(GROUPINGS))
async def test_only_narrows_every_figure_to_the_group(seeded, group):
    full = await _metrics(seeded, group)
    assert full["embeddings"]["has_data"]
    for row in full["groups"]:
        m = await _metrics(seeded, group, only=row["key"])
        assert m["totals"]["total_tokens"] == row["tokens"]
        assert m["totals"]["cost"] == pytest.approx(row["cost"])
        assert m["totals"]["completions"] == row["count"]
        assert m["task_count"] == row["tasks"]
        for breakdown in ("by_model", "by_mode", "by_provider", "by_client"):
            assert sum(b["count"] for b in m[breakdown]) == row["count"]
        assert sum(d["tokens"] for d in m["by_day"]) == row["tokens"]
        # Indexing belongs to no task, so it is in no group.
        assert not m["embeddings"]["has_data"]
        assert [g["key"] for g in m["groups"]] == [row["key"]]


async def test_a_group_without_usage_has_no_data(seeded):
    m = await _metrics(seeded, "project", only="prj_gone")
    assert not m["has_data"]


def _page(http, **params):
    _override_web_user(http.app)
    try:
        return http.get("/app/metrics", params=params)
    finally:
        http.app.dependency_overrides.pop(get_web_user_optional, None)


def _metrics_links(html: str) -> list[dict]:
    return [
        {k: v[0] for k, v in parse_qs(urlsplit(unescape(href)).query).items()}
        for href in re.findall(r'href="(/app/metrics\?[^"]*)"', html)
    ]


@pytest.mark.parametrize(
    "group, only, label, runs",
    [
        ("project", "prj_a", "alpha", 2),
        ("project", "(none)", "No project", 1),
        # A run counts under its main model.
        ("model", "llama-b", "llama-b", 2),
    ],
)
async def test_only_narrows_the_page_and_shows_a_removable_chip(
    client, seeded, group, only, label, runs
):
    html = _page(client, period="all", group=group, only=only).text

    assert f'Session quality <span class="count-pill">{runs} run' in html
    chip = re.search(
        r'<a class="filter-chip" href="([^"]*)"[^>]*>([^<]*)<b>([^<]*)', html
    )
    assert unescape(chip.group(1)) == f"/app/metrics?period=all&group={group}"
    assert (chip.group(2), chip.group(3)) == (f"{GROUPINGS[group].label}: ", label)
    # The table of groups is the way in, not shown inside one group.
    assert 'id="table-groups"' not in html


async def test_every_link_keeps_the_view(client, seeded):
    html = _page(
        client, period="all", client="vscode", group="project", only="prj_a"
    ).text
    links = _metrics_links(html)
    assert all(link["period"] and link["group"] for link in links)
    # Only the client selector changes the client ("All clients" drops it);
    # only the group selector and the chip drop the narrowed group.
    others = [link.get("client") for link in links if link.get("client") != "vscode"]
    assert others == [None, "cli"]
    assert len([link for link in links if "only" not in link]) == 4

    grouped = _page(client, period="all", client="vscode", group="project").text
    rows = re.findall(r'<td class="bd-name"><a href="([^"]*)"', grouped)
    assert [unescape(href) for href in rows] == [
        f"/app/metrics?period=all&client=vscode&group=project&only={key}"
        for key in ("prj_b", "prj_a", "%28none%29")
    ]


async def test_the_grouping_falls_back_to_project_and_is_remembered(client, seeded):
    def active_group(html):
        nav = html.split('aria-label="Group"')[1].split("</nav>")[0]
        return re.search(r'period-opt active" href="[^"]*">([^<]*)<', nav).group(1)

    assert active_group(_page(client, group="bogus").text) == "Project"
    picked = _page(client, period="all", group="model")
    assert "tumble_metrics_group=model" in picked.headers["set-cookie"]
    plain = _page(client, period="all").text
    assert active_group(plain) == "Model"
    assert re.findall(r'<td class="bd-name"><a [^>]*>([^<]*)<', plain) == [
        "llama-b",
        "gpt-a",
    ]

    flat = _page(client, period="all", group="none", only="prj_a").text
    assert 'id="table-groups"' not in flat
    assert "filter-chip" not in flat
    # Not narrowed: all six completions.
    assert "6 API completions" in flat


async def test_a_long_table_shows_the_top_rows_and_links_to_all(client, db_session):
    await _seed_user(db_session)
    db_session.add_all(
        [_llm_event(model=f"m{n}", cost=n / 100, task_id=f"t{n}") for n in range(1, 10)]
    )
    await db_session.commit()

    top = _page(client, period="all", group="model").text
    assert len(re.findall(r'<td class="bd-name"><a ', top)) == 8
    assert "Show all 9 models" in top

    every = _page(client, period="all", group="model", groups="all").text
    assert len(re.findall(r'<td class="bd-name"><a ', every)) == 9
    assert "Show the top 8" in every
