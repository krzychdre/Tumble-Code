"""The metrics page summed per project, model or user, narrowed to one group,
and an organization's space.

Plans: ai_plans/2026-10-27_10-00_cloud-web-metrics-groups.md and
ai_plans/2026-10-27_10-30_cloud-web-org-metrics.md. The grouping table and the
view's URLs are web/presenters/metrics_view.py; the sums are
services/metrics_service.compute_user_metrics.
"""

import json
import re
from datetime import datetime, timedelta, timezone
from html import unescape
from urllib.parse import parse_qs, urlsplit

import pytest
from sqlalchemy import text

from src.auth.web_session import get_web_user_optional
from src.models.organization import Membership, Organization
from src.models.project import Project
from src.models.task import Task
from src.models.user import User
from src.services.metrics_service import compute_user_metrics
from src.web.presenters.metrics_view import GROUPINGS, MetricsView
from tests.web_helpers import (
    _event_row,
    _llm_event,
    _override_web_user,
    _seed_user,
    _store,
)

USER = "user_test"
OTHER = "user_other"
# Admin of another organization only.
RIVAL = "user_rival"
ORG = "org_acme"
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


async def _seed(db):
    await _seed_user(db)
    await _seed_user(db, OTHER, email="o@example.com")
    db.add_all(
        [
            Project(id="prj_a", tenant_id=USER, user_id=USER, key="a", name="alpha"),
            Project(id="prj_b", tenant_id=USER, user_id=USER, key="b", name="beta"),
            Project(id="prj_x", tenant_id=OTHER, user_id=OTHER, key="x", name="secret"),
        ]
    )
    await db.flush()
    db.add_all(
        [
            # One model each, so it is also the primary one, as
            # model_attribution.refresh_task_models stores it.
            Task(
                id=task,
                user_id=user,
                project_id=project,
                models=model,
                primary_model=model,
            )
            for task, user, project, model in (
                ("t-a1", USER, "prj_a", "gpt-a"),
                ("t-a2", USER, "prj_a", "llama-b"),
                ("t-b", USER, "prj_b", "llama-b"),
                ("t-none", USER, None, "gpt-a"),
                ("t-foreign", OTHER, "prj_x", "gpt-a"),
            )
        ]
    )
    await _store(
        db,
        [
            _llm_event(
                task_id=task,
                model=model,
                tin=tin,
                tout=0,
                cost=cost,
                created_at=WHEN + timedelta(minutes=n),
            )
            for n, (task, _, model, tin, cost) in enumerate(EVENTS)
        ]
        + [
            _event_row(
                "Embedding Usage",
                {"promptTokens": 5000, "source": "index"},
                USER,
                created_at=WHEN,
            )
        ],
    )
    await db.commit()


@pytest.fixture
async def seeded(db_session):
    await _seed(db_session)
    return db_session


# The reader is an admin of ORG, OTHER a plain member with no name (a group of
# theirs is named by e-mail). ORG's runs: one of the reader's, two of OTHER's.
# Not ORG's: RIVAL's run in their own organization, and RIVAL's event naming
# OTHER's task.
async def _seed_organization(db):
    await _seed_user(db, RIVAL, email="r@example.com")
    other = await db.get(User, OTHER)
    other.first_name = other.last_name = ""
    db.add_all(
        [
            Organization(id=ORG, name="Acme"),
            Organization(id="org_rival", name="Rival"),
            Membership(user_id=USER, organization_id=ORG, role="org:admin"),
            Membership(user_id=OTHER, organization_id=ORG, role="org:member"),
            Membership(user_id=RIVAL, organization_id="org_rival", role="org:admin"),
        ]
    )
    await db.flush()
    db.add(
        Project(
            id="prj_org",
            tenant_id=ORG,
            organization_id=ORG,
            user_id=USER,
            key="o",
            name="shared",
        )
    )
    await db.flush()
    org_tasks = [
        ("o-mine", USER, ORG, "prj_org", "gpt-a"),
        ("o-other", OTHER, ORG, "prj_org", "llama-b"),
        ("o-other2", OTHER, ORG, None, "gpt-a"),
        ("o-rival", RIVAL, "org_rival", None, "gpt-a"),
    ]
    db.add_all(
        [
            Task(
                id=task,
                user_id=user,
                organization_id=org,
                project_id=project,
                models=model,
                primary_model=model,
            )
            for task, user, org, project, model in org_tasks
        ]
    )
    org_events = [
        (USER, "o-mine", "gpt-a", 400, 0.2),
        (OTHER, "o-other", "llama-b", 300, 0.4),
        (OTHER, "o-other2", "gpt-a", 100, 0.1),
        (RIVAL, "o-rival", "gpt-a", 5000, 2.0),
        (RIVAL, "o-other", "gpt-a", 999, 9.0),
    ]
    await _store(
        db,
        [
            _llm_event(
                user,
                task_id=task,
                model=model,
                tin=tin,
                tout=0,
                cost=cost,
                created_at=WHEN + timedelta(hours=1, minutes=n),
            )
            for n, (user, task, model, tin, cost) in enumerate(org_events)
        ],
    )
    await db.commit()


@pytest.fixture
async def org_seeded(seeded):
    await _seed_organization(seeded)
    return seeded


async def _metrics(db, group, only="", space=None):
    view = MetricsView(space or "", "all", None, group, only)
    return await compute_user_metrics(
        db,
        USER,
        "all",
        group_by=view.grouping.events,
        narrow=view.events_condition(),
        organization_id=space,
    )


# Every grouping each space offers.
SPACE_GROUPS = [
    (space, group)
    for space in (None, ORG)
    for group, grouping in GROUPINGS.items()
    if space or not grouping.organization_only
]


@pytest.mark.parametrize("space, group", SPACE_GROUPS)
async def test_the_groups_add_up_to_the_page_totals(org_seeded, space, group):
    m = await _metrics(org_seeded, group, space=space)
    groups = m["groups"]
    assert sum(g["tokens"] for g in groups) == m["totals"]["total_tokens"]
    assert sum(g["cost"] for g in groups) == pytest.approx(m["totals"]["cost"])
    assert sum(g["count"] for g in groups) == m["totals"]["completions"]
    assert [g["cost"] for g in groups] == sorted(
        (g["cost"] for g in groups), reverse=True
    )
    assert sum(g["share"] for g in groups) == pytest.approx(100, abs=len(groups))


def _rounded(metrics: dict) -> dict:
    """The figures with every float rounded: the two databases add the
    costs up in their own order."""
    return json.loads(json.dumps(metrics), parse_float=lambda s: round(float(s), 9))


@pytest.mark.parametrize("space, group", SPACE_GROUPS)
async def test_postgres_sums_every_group_like_sqlite(
    org_seeded, pg_session, space, group
):
    """The same page from Postgres, unnarrowed and narrowed to each group, as
    from the SQLite this file checks."""
    await _seed(pg_session)
    await _seed_organization(pg_session)
    groups = (await _metrics(org_seeded, group, space=space))["groups"]
    for only in ["", *(g["key"] for g in groups)]:
        assert _rounded(await _metrics(pg_session, group, only, space)) == _rounded(
            await _metrics(org_seeded, group, only, space)
        )


async def test_a_project_is_the_tasks_and_none_collects_the_rest(seeded):
    """No task row, no project, or another user's task: all "No project"."""
    m = await _metrics(seeded, "project")
    assert [(g["key"], g["name"], g["count"], g["tasks"]) for g in m["groups"]] == [
        ("prj_b", "beta", 1, 1),
        ("prj_a", "alpha", 2, 2),
        ("(none)", "No project", 3, 3),
    ]
    assert [g["share"] for g in m["groups"]] == [51, 41, 8]


async def test_a_project_the_reader_may_not_see_is_named_by_its_id(seeded):
    """The reader ran a task in an organization's project, then left it."""
    seeded.add(Organization(id="org_left", name="Left"))
    await seeded.flush()
    seeded.add(
        Project(
            id="prj_left",
            tenant_id="org_left",
            organization_id="org_left",
            user_id=USER,
            key="l",
            name="former",
        )
    )
    await seeded.flush()
    seeded.add(
        Task(
            id="t-left", user_id=USER, organization_id="org_left", project_id="prj_left"
        )
    )
    await _store(seeded, [_llm_event(task_id="t-left", tin=1, tout=0, cost=0.0)])
    await seeded.commit()

    m = await _metrics(seeded, "project")
    assert ("prj_left", "prj_left") in [(g["key"], g["name"]) for g in m["groups"]]


@pytest.mark.parametrize("space, group", SPACE_GROUPS)
async def test_only_narrows_every_figure_to_the_group(org_seeded, space, group):
    full = await _metrics(org_seeded, group, space=space)
    # Indexing belongs to no task, so it is in no organization.
    assert full["embeddings"]["has_data"] == (space is None)
    for row in full["groups"]:
        m = await _metrics(org_seeded, group, only=row["key"], space=space)
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


async def test_rows_that_tie_keep_the_order_they_were_first_used_in(db_session):
    """Same tokens and cost: the model used first is listed first, in the
    table of groups and in the "By model" breakdown."""
    await _seed_user(db_session)
    await _store(
        db_session,
        [
            _llm_event(model="zeta", created_at=WHEN),
            _llm_event(model="alpha", created_at=WHEN + timedelta(hours=1)),
        ],
    )
    await db_session.commit()

    m = await _metrics(db_session, "model")
    assert [g["key"] for g in m["groups"]] == ["zeta", "alpha"]
    assert [b["name"] for b in m["by_model"]] == ["zeta", "alpha"]


async def test_a_group_counts_each_task_once(db_session):
    await _seed_user(db_session)
    await _store(
        db_session, [_llm_event(task_id=task) for task in ("t-1", "t-1", "t-2")]
    )
    await db_session.commit()

    m = await _metrics(db_session, "model")
    assert [(g["count"], g["tasks"]) for g in m["groups"]] == [(3, 2)]


@pytest.mark.parametrize("space, group", SPACE_GROUPS)
async def test_a_task_in_two_groups_is_one_task_of_the_page(org_seeded, space, group):
    """A task that used two models is in two model groups."""
    await _store(
        org_seeded,
        [
            _llm_event(task_id=task, model="llama-b", created_at=WHEN)
            for task in ("t-a1", "o-mine")
        ],
    )
    await org_seeded.commit()

    m = await _metrics(org_seeded, group, space=space)
    plain = await compute_user_metrics(org_seeded, USER, "all", organization_id=space)
    assert m["task_count"] == plain["task_count"]


async def test_postgres_plans_every_load_for_its_values(pg_session):
    """asyncpg prepares the statements, and a generic plan cannot see the
    user, the period or the group: on a narrowed page it read a heavy user's
    events once per task. However often a connection loads the page, none
    of its statements gets one."""
    await _seed(pg_session)
    await _seed_organization(pg_session)
    for _ in range(7):
        await _metrics(pg_session, "project", only="prj_org", space=ORG)
    plans = await pg_session.execute(
        text(
            "SELECT sum(generic_plans), sum(custom_plans) FROM pg_prepared_statements "
            "WHERE statement LIKE '%FROM usage_rollup%' "
            "AND statement NOT LIKE '%pg_prepared_statements%'"
        )
    )
    assert plans.one() == (0, 3 * 7)


async def test_a_group_without_usage_has_no_data(seeded):
    m = await _metrics(seeded, "project", only="prj_gone")
    assert not m["has_data"]


def _page(http, user=USER, **params):
    _override_web_user(http.app, user)
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
    "space, group, only, label, runs",
    [
        ("", "project", "prj_a", "alpha", 2),
        ("", "project", "(none)", "No project", 1),
        # A run counts under its main model.
        ("", "model", "llama-b", "llama-b", 2),
        (ORG, "project", "prj_org", "shared", 2),
        # Named by e-mail: OTHER has no name.
        (ORG, "user", OTHER, "o@example.com", 2),
    ],
)
async def test_only_narrows_the_page_and_shows_a_removable_chip(
    client, org_seeded, space, group, only, label, runs
):
    html = _page(client, period="all", space=space, group=group, only=only).text

    assert f'Session quality <span class="count-pill">{runs} run' in html
    chip = re.search(
        r'<a class="filter-chip" href="([^"]*)"[^>]*>([^<]*)<b>([^<]*)', html
    )
    in_space = f"&space={space}" if space else ""
    assert unescape(chip.group(1)) == f"/app/metrics?period=all{in_space}&group={group}"
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
    await _store(
        db_session,
        [
            _llm_event(model=f"m{n}", cost=n / 100, task_id=f"t{n}")
            for n in range(1, 10)
        ],
    )
    await db_session.commit()

    top = _page(client, period="all", group="model").text
    assert len(re.findall(r'<td class="bd-name"><a ', top)) == 8
    assert "Show all 9 models" in top

    every = _page(client, period="all", group="model", groups="all").text
    assert len(re.findall(r'<td class="bd-name"><a ', every)) == 9
    assert "Show the top 8" in every


# --- an organization's space -------------------------------------------------


def _options(html: str, nav: str) -> list[str]:
    """The labels of a selector, the active one marked with a star."""
    block = html.split(f'aria-label="{nav}"')[1].split("</nav>")[0]
    return [
        label + ("*" if active else "")
        for active, label in re.findall(
            r'period-opt( active)?" href="[^"]*">([^<]*)<', block
        )
    ]


async def test_an_organization_counts_every_member_on_its_tasks_only(org_seeded):
    m = await _metrics(org_seeded, "user", space=ORG)
    # Not RIVAL's run in their organization, nor RIVAL's event naming
    # OTHER's task.
    assert m["totals"]["completions"] == 3
    assert m["totals"]["cost"] == pytest.approx(0.7)
    assert [(g["key"], g["name"], g["count"], g["tasks"]) for g in m["groups"]] == [
        (OTHER, "o@example.com", 2, 2),
        (USER, "Test User", 1, 1),
    ]


async def test_an_admin_sees_the_organizations_space(client, org_seeded):
    mine = _page(client, period="all").text
    assert _options(mine, "Space") == ["Mine*", "Acme"]
    assert "User" not in _options(mine, "Group")
    # The reader's own usage, their run in the organization included.
    assert "7 API completions" in mine

    html = _page(client, period="all", space=ORG, group="user").text
    assert _options(html, "Space") == ["Mine", "Acme*"]
    assert _options(html, "Group") == ["Project", "Model", "User*", "None"]
    assert "3 API completions" in html
    assert 'Session quality <span class="count-pill">3 runs' in html
    assert 'data-metric="indexing"' not in html
    # Only the "Mine" option leaves the space.
    links = _metrics_links(html)
    assert [link for link in links if link.get("space") != ORG] == [
        {"period": "all", "group": "user"}
    ]
    rows = re.findall(r'<td class="bd-name"><a href="([^"]*)"[^>]*>([^<]*)<', html)
    assert [(unescape(href), name) for href, name in rows] == [
        (
            f"/app/metrics?period=all&space={ORG}&group=user&only={OTHER}",
            "o@example.com",
        ),
        (f"/app/metrics?period=all&space={ORG}&group=user&only={USER}", "Test User"),
    ]


@pytest.mark.parametrize(
    "user, spaces",
    [
        # A plain member: no selector at all.
        (OTHER, None),
        # An admin of another organization: their own, not this one.
        (RIVAL, ["Mine*", "Rival"]),
    ],
)
async def test_only_an_admin_gets_the_organizations_space(
    client, org_seeded, user, spaces
):
    html = _page(client, user=user, period="all", space=ORG, group="user").text

    if spaces is None:
        assert 'aria-label="Space"' not in html
    else:
        assert _options(html, "Space") == spaces
    assert all(link.get("space") != ORG for link in _metrics_links(html))
    # The reader's own usage, grouped the default way.
    assert _options(html, "Group")[0] == "Project*"
    assert "User" not in _options(html, "Group")
    own = await compute_user_metrics(org_seeded, user, "all")
    assert f"{own['totals']['completions']} API completions" in html


async def test_the_user_grouping_is_not_remembered_into_the_readers_own_page(
    client, org_seeded
):
    picked = _page(client, period="all", space=ORG, group="user")
    assert "tumble_metrics_group=user" in picked.headers["set-cookie"]
    assert _options(_page(client, period="all").text, "Group")[0] == "Project*"
    assert _options(_page(client, period="all", space=ORG).text, "Group")[2] == "User*"
