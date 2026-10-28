"""usage_rollup: the figures of LLM Completion and Embedding Usage events,
summed at ingest per user, quarter of an hour, task and names
(telemetry_service.add_to_rollup), which the metrics and diagnostics pages
read instead of the events.

The Postgres cases run when RECALL_PG_URL is set (tests/conftest.pg_session).
"""

import asyncio
import hashlib
import math
import random
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import (
    BigInteger,
    case,
    cast,
    delete,
    extract,
    func,
    insert,
    literal,
    select,
    text,
)
from sqlalchemy.ext.asyncio import AsyncSession

import src.models.event as event_model
from src.models.event import TelemetryEvent, UsageRollup, quarter_of
from src.models.organization import Membership, Organization
from src.models.project import Project
from src.models.task import Task
from src.models.user import User
from src.services.metrics_service import compute_user_metrics, period_start
from src.services.problems.collect import _request_counts
from src.services.telemetry_service import record_event
from src.services.telemetry_vocab import EMBEDDING_EVENT, LLM_COMPLETION_EVENT
from src.web.presenters.metrics_view import GROUPINGS, MetricsView
from src.web.presenters.task_list import NO_GROUP, NO_KEY
from tests.web_helpers import _seed_user

READER = "user_test"
MEMBER = "user_member"
OUTSIDER = "user_outsider"
ORG = "org_acme"
NOW = datetime(2026, 10, 28, 9, 0, tzinfo=timezone.utc)

# (task id, owner, organization, project)
TASKS = [
    ("r-own", READER, None, "prj_own"),
    ("r-bare", READER, None, None),
    ("r-org", READER, ORG, "prj_org"),
    ("m-org", MEMBER, ORG, "prj_org"),
    ("m-hidden", MEMBER, ORG, "prj_hidden"),
    ("m-own", MEMBER, None, None),
    ("x-own", OUTSIDER, None, "prj_hidden"),
]


@pytest.fixture(params=["db_session", "pg_session"])
def any_db(request):
    return request.getfixturevalue(request.param)


class _Clock(datetime):
    """What TelemetryEvent's created_at default reads as the time."""

    at = NOW

    @classmethod
    def now(cls, tz=None):
        return cls.at


@pytest.fixture
def clock(monkeypatch):
    monkeypatch.setattr(event_model, "datetime", _Clock)
    return _Clock


async def _seed_world(db) -> None:
    """The reader administers ORG, MEMBER belongs to it (no name, so named by
    e-mail), OUTSIDER does not. prj_hidden is OUTSIDER's, so the reader sees
    it by its id."""
    await _seed_user(db)
    await _seed_user(db, MEMBER, email="m@example.com")
    await _seed_user(db, OUTSIDER, email="x@example.com")
    member = await db.get(User, MEMBER)
    member.first_name = member.last_name = ""
    db.add_all(
        [
            Organization(id=ORG, name="Acme"),
            Membership(user_id=READER, organization_id=ORG, role="org:admin"),
            Membership(user_id=MEMBER, organization_id=ORG, role="org:member"),
            Project(
                id="prj_own", tenant_id=READER, user_id=READER, key="o", name="own"
            ),
            Project(
                id="prj_org",
                tenant_id=ORG,
                organization_id=ORG,
                user_id=READER,
                key="g",
                name="org",
            ),
            Project(
                id="prj_hidden", tenant_id=OUTSIDER, user_id=OUTSIDER, key="h", name="x"
            ),
        ]
    )
    await db.flush()
    db.add_all(
        Task(id=task, user_id=user, organization_id=org, project_id=project)
        for task, user, org, project in TASKS
    )
    await db.commit()


def _random_events(rng: random.Random, count: int) -> list[tuple]:
    """(user, created_at, event type, properties): names from short lists, so
    events share rows, at instants around quarters and local midnights."""
    instants = [
        NOW - timedelta(days=rng.randrange(100), seconds=rng.randrange(86400))
        for _ in range(25)
    ]
    for day in (0, 6, 29):
        midnight = NOW.replace(hour=0, minute=0, second=0) - timedelta(days=day)
        for zone in ("Asia/Kathmandu", "America/St_Johns"):
            local = midnight.astimezone(ZoneInfo(zone)).replace(
                hour=0, minute=0, second=0
            )
            # In UTC, as ingest stamps it: SQLite stores the wall time.
            local = local.astimezone(timezone.utc)
            instants += [local, local - timedelta(microseconds=1)]
    tasks = [task for task, *_ in TASKS] + ["ghost", None]
    events = []
    for _ in range(count):
        user = rng.choice([READER, READER, MEMBER, OUTSIDER])
        at = rng.choice(instants) + timedelta(seconds=rng.choice([0, 0, 1, 299, 899]))
        client = {"clientKind": rng.choice(["vscode", "cli"])}
        if rng.random() < 0.15:
            props = {
                "promptTokens": rng.randrange(100_000),
                **(
                    {"source": rng.choice(["index", "search", ""])}
                    if rng.random() < 0.8
                    else {}
                ),
                **client,
            }
            events.append((user, at, EMBEDDING_EVENT, props))
            continue
        props = {
            "taskId": rng.choice(tasks),
            "modelId": rng.choice(["glm", "gpt", "", "ünï-model", None]),
            "apiProvider": rng.choice(["zai", "openai", None]),
            "mode": rng.choice(["code", "ask", None]),
            "inputTokens": rng.randrange(50_000),
            "outputTokens": rng.randrange(5_000),
            "cacheReadTokens": rng.randrange(1_000),
            "cacheWriteTokens": rng.randrange(1_000),
            "cost": rng.choice([0, rng.random(), rng.random() / 1000]),
            **client,
        }
        if rng.random() < 0.7:
            props["durationMs"] = rng.randrange(60_000)
        kind = rng.choice([None, "task", "condense", 7])
        if kind is not None:
            props["completionKind"] = kind
        reported = rng.choice([None, True, False])
        if reported is not None:
            props["usageReported"] = reported
        events.append((user, at, LLM_COMPLETION_EVENT, props))
    return events


async def _ingest(db, clock, events) -> None:
    """Through the real ingest path, one event at a time."""
    for user, at, event_type, props in events:
        clock.at = at
        await record_event(db, user, None, event_type, props)
    await db.commit()


async def _one_row_per_event(db) -> None:
    """Replace usage_rollup by one row per event, with the quarter computed
    in SQL: what the pages read when they summed the events themselves."""
    e = TelemetryEvent
    await db.execute(delete(UsageRollup))
    await db.execute(
        insert(UsageRollup).from_select(
            [
                "user_id",
                "event_type",
                "quarter",
                "names_key",
                "task_id",
                "client_kind",
                "model_id",
                "provider",
                "mode",
                "completion_kind",
                "embedding_source",
                "input_tokens",
                "output_tokens",
                "cache_read_tokens",
                "cache_write_tokens",
                "cost",
                "duration_ms",
                "events",
                "unreported",
                "first_at",
            ],
            select(
                e.user_id,
                e.event_type,
                cast(func.floor(extract("epoch", e.created_at)), BigInteger) // 900,
                e.id,
                e.task_id,
                e.client_kind,
                e.model_id,
                e.provider,
                e.mode,
                e.completion_kind,
                e.embedding_source,
                e.input_tokens,
                func.coalesce(e.output_tokens, 0),
                func.coalesce(e.cache_read_tokens, 0),
                func.coalesce(e.cache_write_tokens, 0),
                func.coalesce(e.cost, 0.0),
                func.coalesce(e.duration_ms, 0),
                literal(1),
                case((e.usage_reported.is_(False), 1), else_=0),
                e.created_at,
            ).where(e.event_type.in_([LLM_COMPLETION_EVENT, EMBEDDING_EVENT])),
        )
    )
    await db.commit()


# (period, the reader's zone, client)
VIEWS = [
    ("all", "UTC", None),
    ("90d", "Asia/Kathmandu", "cli"),
    ("30d", "America/St_Johns", None),
    ("7d", "Asia/Kathmandu", "vscode"),
    ("today", "Europe/Warsaw", None),
]


async def _pages(db) -> dict:
    """Every view of both spaces, every grouping, unnarrowed and narrowed to
    each of its groups and to "no key"; and the diagnostics' request counts."""
    pages = {}
    for space in ("", ORG):
        for group in [NO_GROUP, *GROUPINGS]:
            if not space and group == "user":
                continue
            for period, zone, client in VIEWS:
                view = MetricsView(space, period, client, group, "")
                args = dict(
                    now=NOW,
                    client=client,
                    zone=ZoneInfo(zone),
                    group_by=view.grouping.events if view.grouping else None,
                    organization_id=space or None,
                )
                page = await compute_user_metrics(db, READER, period, **args)
                pages[(space, group, period, "")] = page
                if not view.grouping:
                    continue
                for only in [NO_KEY, *(g["key"] for g in page["groups"])]:
                    narrowed = MetricsView(space, period, client, group, only)
                    pages[(space, group, period, only)] = await compute_user_metrics(
                        db, READER, period, narrow=narrowed.events_condition(), **args
                    )
    for period, zone, client in VIEWS:
        start = period_start(period, NOW, ZoneInfo(zone))
        pages[("requests", period)] = dict(
            await _request_counts(db, READER, start, client or "")
        )
    return pages


def _same(a, b, where="") -> None:
    """Equal, except that floats may differ in their last bits: the two sides
    add the costs up in different orders."""
    if isinstance(a, dict):
        assert isinstance(b, dict) and a.keys() == b.keys(), where
        for key in a:
            _same(a[key], b[key], f"{where}.{key}")
    elif isinstance(a, list):
        assert isinstance(b, list) and len(a) == len(b), where
        for n, (x, y) in enumerate(zip(a, b)):
            _same(x, y, f"{where}[{n}]")
    elif isinstance(a, float):
        assert math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-12), (where, a, b)
    else:
        assert a == b and type(a) is type(b), (where, a, b)


async def _rows(db) -> list:
    """usage_rollup summed per row identity: the rows themselves when ingest
    built them, the events summed when there is one row per event."""
    r = UsageRollup
    identity = (
        r.user_id,
        r.event_type,
        r.quarter,
        r.task_id,
        r.client_kind,
        r.model_id,
        r.provider,
        r.mode,
        r.completion_kind,
        r.embedding_source,
    )
    sums = [
        func.sum(column)
        for column in (
            r.input_tokens,
            r.output_tokens,
            r.cache_read_tokens,
            r.cache_write_tokens,
            r.cost,
            r.duration_ms,
            r.events,
            r.unreported,
        )
    ]
    rows = await db.execute(
        select(*identity, *sums, func.min(r.first_at)).group_by(*identity)
    )
    return sorted((list(row) for row in rows), key=repr)


@pytest.mark.parametrize("seed", [1, 2])
async def test_the_rollup_reads_like_the_events_it_sums(any_db, clock, seed):
    """Random events through record_event, then the rows and every page
    twice: from the rollup ingest built, and from one row per event, the
    events as they are. Every figure, name and order is the same."""
    await _seed_world(any_db)
    await _ingest(any_db, clock, _random_events(random.Random(seed), 400))
    summed = await any_db.scalar(select(func.count()).select_from(UsageRollup))

    rolled_up = (await _rows(any_db), await _pages(any_db))
    await _one_row_per_event(any_db)
    per_event = (await _rows(any_db), await _pages(any_db))

    assert summed < 400, "the events must share rows for the test to mean anything"
    assert len(rolled_up[0]) == summed
    _same(rolled_up[0], per_event[0])
    assert rolled_up[1].keys() == per_event[1].keys()
    for key in rolled_up[1]:
        _same(rolled_up[1][key], per_event[1][key], str(key))


async def _until_writers_wait(db, count: int) -> None:
    """Return once ``count`` sessions of this database wait for a lock."""
    for _ in range(400):
        waiting = await db.scalar(
            text(
                "SELECT count(*) FROM pg_stat_activity "
                "WHERE datname = current_database() AND wait_event_type = 'Lock'"
            )
        )
        # pg_stat_activity is read once per transaction.
        await db.rollback()
        if waiting == count:
            return
        await asyncio.sleep(0.025)
    raise AssertionError(f"{count} writers never waited for the row")


async def test_concurrent_ingests_into_one_row_all_count(pg_session, clock):
    """Postgres: while one transaction holds the row (first a new row, then
    an existing one), nineteen more add an event into it. Each waits, then
    adds to what the first committed: no increment is lost."""
    db = pg_session
    await _seed_user(db)
    props = {"taskId": "t", "modelId": "glm", "inputTokens": 7, "cost": 0.5}

    async def ingest(session):
        await record_event(session, READER, None, LLM_COMPLETION_EVENT, props)
        await session.commit()

    for _ in range(2):
        async with AsyncSession(db.bind) as holder:
            await record_event(holder, READER, None, LLM_COMPLETION_EVENT, props)
            sessions = [AsyncSession(db.bind) for _ in range(19)]
            waiting = [asyncio.create_task(ingest(s)) for s in sessions]
            await _until_writers_wait(db, 19)
            await holder.commit()
            await asyncio.gather(*waiting)
            for s in sessions:
                await s.close()

    row = (await db.execute(select(UsageRollup))).scalar_one()
    assert (row.events, row.input_tokens, row.cost) == (40, 280, 20.0)


async def test_names_of_any_length_fit_the_key(pg_session, clock):
    """Postgres: the client names its task and model. Ids as long as the
    events' own task index allows still make one row, because the row is
    keyed by their hash (a btree entry holds at most 2704 bytes)."""
    db = pg_session
    await _seed_user(db)
    noise = "".join(hashlib.sha256(str(n).encode()).hexdigest() for n in range(80))
    props = {"taskId": noise[:2500], "modelId": noise[2500:5000], "inputTokens": 3}
    await record_event(db, READER, None, LLM_COMPLETION_EVENT, props)
    await record_event(db, READER, None, LLM_COMPLETION_EVENT, props)
    await db.commit()

    m = await compute_user_metrics(db, READER, "all", now=NOW)
    assert (m["totals"]["completions"], m["task_count"]) == (2, 1)


async def test_an_organizations_totals_hold_any_sum(pg_session):
    """Postgres: each figure of a row fits a BIGINT; a row's input and output
    tokens together, and the members' rows together, do not. The page adds
    them as NUMERIC instead of failing."""
    db = pg_session
    await _seed_world(db)
    big = 2**62
    db.add_all(
        UsageRollup(
            user_id=user,
            event_type=LLM_COMPLETION_EVENT,
            quarter=quarter_of(NOW),
            names_key=task,
            task_id=task,
            client_kind="vscode",
            completion_kind="task",
            input_tokens=big,
            output_tokens=big,
            cache_read_tokens=big,
            cache_write_tokens=big,
            cost=1.0,
            duration_ms=big,
            events=1,
            unreported=0,
            first_at=NOW,
        )
        for task, user in (("r-org", READER), ("m-org", MEMBER))
    )
    await db.commit()

    m = await compute_user_metrics(
        db,
        READER,
        "all",
        now=NOW,
        organization_id=ORG,
        group_by=GROUPINGS["user"].events,
    )
    totals = m["totals"]
    assert totals["input"] == totals["cache_read"] == totals["cache_write"] == 2**63
    assert m["duration_ms"] == totals["output"] == 2**63
    assert m["by_day"][0]["tokens"] == totals["total_tokens"] == 2**64
    assert [g["tokens"] for g in m["groups"]] == [2**63, 2**63]


async def test_deleting_a_user_deletes_their_rows_only(db_session, clock):
    """The rows of two users in one task, quarter and names are two rows;
    deleting one user takes theirs away and leaves the other's page as it
    was (their events stay with no user, which no page reads)."""
    db = db_session
    await _seed_world(db)
    props = {"taskId": "m-org", "modelId": "glm", "inputTokens": 5}
    for user in (READER, MEMBER):
        await record_event(db, user, None, LLM_COMPLETION_EVENT, props)
    await db.commit()
    before = await compute_user_metrics(db, READER, "all", now=NOW)

    await db.execute(delete(User).where(User.id == MEMBER))
    await db.commit()

    users = (await db.execute(select(UsageRollup.user_id))).scalars().all()
    assert users == [READER]
    assert await compute_user_metrics(db, READER, "all", now=NOW) == before
