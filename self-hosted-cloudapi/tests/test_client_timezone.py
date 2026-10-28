"""The reader's time zone (utils/clientzone): "today", daily buckets and date
filters are their calendar days, not UTC ones.

The case that started it: a Warsaw reader's night session between 00:00 and
02:00 local time is still the previous day in UTC, so a UTC "today" dropped it.
Every expectation here is independent of the host's own zone; run the file
with TZ=UTC and TZ=Pacific/Kiritimati to see that.
"""

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from src.auth.web_session import get_web_user_optional
from src.models.task import Task
from src.services.metrics_service import compute_user_metrics, period_start
from src.services.problems.base import SOURCE_TELEMETRY, Occurrence
from src.services.problems.views import _group_view
from src.utils.clientzone import UTC, as_utc, day_start_utc, local_day, parse_zone
from src.services.problems.collect import _request_counts
from tests.web_helpers import (
    _event_row,
    _llm_event,
    _override_web_user,
    _seed_user,
    _store,
)

WARSAW = ZoneInfo("Europe/Warsaw")
NOW = datetime(2026, 10, 5, 8, 0, tzinfo=timezone.utc)  # 10:00 in Warsaw


# --- utils/clientzone -----------------------------------------------------------


@pytest.mark.parametrize(
    "name, expected",
    [
        ("Europe/Warsaw", "Europe/Warsaw"),
        ("America/Los_Angeles", "America/Los_Angeles"),
        ("UTC", "UTC"),
        (None, "UTC"),
        ("", "UTC"),
        ("Mars/Olympus", "UTC"),
        ("../../etc/passwd", "UTC"),
        ("/etc/localtime", "UTC"),
        ("x" * 100, "UTC"),
    ],
)
def test_parse_zone_falls_back_to_utc(name, expected):
    assert parse_zone(name).key == expected


def test_naive_stamps_are_utc():
    naive = datetime(2026, 10, 4, 23, 30)
    assert as_utc(naive) == datetime(2026, 10, 4, 23, 30, tzinfo=timezone.utc)
    assert local_day(naive, WARSAW) == date(2026, 10, 5)
    assert local_day(naive, UTC) == date(2026, 10, 4)


@pytest.mark.parametrize(
    "day, zone, start, hours",
    [
        (date(2026, 10, 5), "Europe/Warsaw", "2026-10-04T22:00:00+00:00", 24),
        # Summer time ends: a 25-hour day.
        (date(2026, 10, 25), "Europe/Warsaw", "2026-10-24T22:00:00+00:00", 25),
        # Summer time starts: a 23-hour day.
        (date(2026, 3, 29), "Europe/Warsaw", "2026-03-28T23:00:00+00:00", 23),
        (date(2026, 10, 5), "America/Los_Angeles", "2026-10-05T07:00:00+00:00", 24),
        (date(2026, 10, 5), "Asia/Kolkata", "2026-10-04T18:30:00+00:00", 24),
    ],
)
def test_day_start_utc_follows_the_zone_and_dst(day, zone, start, hours):
    z = ZoneInfo(zone)
    begin = day_start_utc(day, z)
    assert begin.isoformat() == start
    assert day_start_utc(day + timedelta(days=1), z) - begin == timedelta(hours=hours)


# --- periods ---------------------------------------------------------------------


@pytest.mark.parametrize(
    "period, zone, expected",
    [
        ("today", WARSAW, "2026-10-04T22:00:00+00:00"),
        ("today", UTC, "2026-10-05T00:00:00+00:00"),
        # Seven whole local days, today included.
        ("7d", WARSAW, "2026-09-28T22:00:00+00:00"),
        ("7d", UTC, "2026-09-29T00:00:00+00:00"),
        # Both still in summer time, so the bound is 22:00 UTC the day before.
        ("30d", WARSAW, "2026-09-05T22:00:00+00:00"),
        ("90d", WARSAW, "2026-07-07T22:00:00+00:00"),
    ],
)
def test_periods_start_at_a_local_midnight(period, zone, expected):
    assert period_start(period, NOW, zone).isoformat() == expected


def test_all_time_has_no_start():
    assert period_start("all", NOW, WARSAW) is None


# --- metrics ---------------------------------------------------------------------


async def _seed_night(db_session):
    """One call at 01:30 Warsaw (still 4 October in UTC), one at 23:30 Warsaw on the 4th."""
    await _seed_user(db_session)
    await _store(
        db_session,
        [
            _llm_event(
                task_id="night",
                tin=1000,
                tout=0,
                created_at=datetime(2026, 10, 4, 23, 30, tzinfo=timezone.utc),
            ),
            _llm_event(
                task_id="evening",
                tin=10,
                tout=0,
                created_at=datetime(2026, 10, 4, 21, 30, tzinfo=timezone.utc),
            ),
        ],
    )
    await db_session.commit()


async def test_today_counts_the_local_night(db_session):
    await _seed_night(db_session)

    local = await compute_user_metrics(
        db_session, "user_test", "today", now=NOW, zone=WARSAW
    )
    assert local["totals"]["input"] == 1000

    utc = await compute_user_metrics(
        db_session, "user_test", "today", now=NOW, zone=UTC
    )
    assert utc["totals"]["input"] == 0


async def test_daily_buckets_are_local_days(db_session):
    await _seed_night(db_session)

    local = await compute_user_metrics(
        db_session, "user_test", "all", now=NOW, zone=WARSAW
    )
    assert [(d["day"], d["tokens"]) for d in local["by_day"]] == [
        ("2026-10-04", 10),
        ("2026-10-05", 1000),
    ]

    utc = await compute_user_metrics(db_session, "user_test", "all", now=NOW, zone=UTC)
    assert [(d["day"], d["tokens"]) for d in utc["by_day"]] == [("2026-10-04", 1010)]


# The daily figures are summed per quarter of an hour of UTC in SQL, then per
# local day (services/metrics_service._by_day): on Postgres too (any_db).
@pytest.mark.parametrize(
    "zone, day",
    [
        # Midnight is at a quarter past the hour in UTC.
        ("Asia/Kathmandu", date(2026, 10, 5)),
        # Summer time ends: a 25-hour day.
        ("Europe/Warsaw", date(2026, 10, 25)),
        # Summer time starts: a 23-hour day.
        ("Europe/Warsaw", date(2026, 3, 29)),
    ],
)
async def test_daily_buckets_end_exactly_at_local_midnight(any_db, zone, day):
    """A call a microsecond before either midnight of the day is the day
    before it; one at midnight is the day itself."""
    z = ZoneInfo(zone)
    start = day_start_utc(day, z)
    end = day_start_utc(day + timedelta(days=1), z)
    tick = timedelta(microseconds=1)
    await _seed_user(any_db)
    await _store(
        any_db,
        [
            _llm_event(tin=10**n, tout=0, created_at=stamp)
            for n, stamp in enumerate([start - tick, start, end - tick, end])
        ],
    )
    await any_db.commit()

    m = await compute_user_metrics(any_db, "user_test", "all", now=NOW, zone=z)
    assert [(d["day"], d["tokens"]) for d in m["by_day"]] == [
        ((day - timedelta(days=1)).isoformat(), 1),
        (day.isoformat(), 110),
        ((day + timedelta(days=1)).isoformat(), 1000),
    ]


@pytest.mark.parametrize("zone", ["Asia/Kathmandu", "America/St_Johns"])
async def test_a_period_starts_exactly_at_the_local_midnight(any_db, zone):
    """A call at the first instant of the period counts, one a microsecond
    before it does not: in the totals, in the indexing figure and in the
    diagnostics' request counts."""
    z = ZoneInfo(zone)
    start = period_start("7d", NOW, z)
    before = start - timedelta(microseconds=1)
    await _seed_user(any_db)
    await _store(
        any_db,
        [
            _llm_event(tin=1, tout=0, created_at=before),
            _llm_event(tin=10, tout=0, created_at=start),
            _event_row("Embedding Usage", {"promptTokens": 100}, created_at=before),
            _event_row("Embedding Usage", {"promptTokens": 1000}, created_at=start),
        ],
    )
    await any_db.commit()

    m = await compute_user_metrics(any_db, "user_test", "7d", now=NOW, zone=z)
    assert (m["totals"]["input"], m["embeddings"]["tokens"]) == (10, 1000)
    assert sum((await _request_counts(any_db, "user_test", start)).values()) == 1


# --- problems --------------------------------------------------------------------


def test_problem_reach_counts_local_days():
    def occurrence(stamp):
        return Occurrence(
            source=SOURCE_TELEMETRY,
            category="index",
            tool=None,
            text="boom",
            when=stamp,
        )

    members = [
        occurrence(datetime(2026, 10, 4, 21, 30, tzinfo=timezone.utc)),
        occurrence(datetime(2026, 10, 4, 23, 30, tzinfo=timezone.utc)),
    ]
    assert _group_view("sig", members, zone=UTC)["reach"] == 1
    assert _group_view("sig", members, zone=WARSAW)["reach"] == 2


# --- web: the cookie ---------------------------------------------------------------


def _page(client, path, zone=None, **params):
    if zone is not None:
        client.cookies.set("tumble_tz", zone)
    _override_web_user(client.app)
    try:
        return client.get(path, params=params or None)
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)
        client.cookies.clear()


@pytest.mark.parametrize(
    "cookie, rendered",
    [(None, "UTC"), ("Europe/Warsaw", "Europe/Warsaw"), ("Not/AZone", "UTC")],
)
async def test_pages_say_which_zone_they_were_computed_in(
    client, db_session, cookie, rendered
):
    await _seed_user(db_session)
    body = _page(client, "/app/metrics", cookie).text
    assert f'<body data-tz="{rendered}">' in body


async def test_metrics_page_today_uses_the_cookie_zone(client, db_session, monkeypatch):
    from src.services import metrics_service

    await _seed_night(db_session)
    real_today = metrics_service.today
    monkeypatch.setattr(
        metrics_service, "today", lambda zone, now=None: real_today(zone, NOW)
    )

    warsaw = _page(client, "/app/metrics", "Europe/Warsaw", period="today").text
    utc = _page(client, "/app/metrics", None, period="today").text
    assert "No usage recorded" not in warsaw
    assert "No usage recorded" in utc


async def test_task_list_dates_are_local_days(client, db_session, session_factory):
    await _seed_user(db_session)
    async with session_factory() as session:
        # 00:30 on 1 June in Warsaw, 31 May in UTC.
        stamp = datetime(2026, 5, 31, 22, 30, tzinfo=timezone.utc)
        session.add(
            Task(
                id="night",
                user_id="user_test",
                title="Night",
                created_at=stamp,
                updated_at=stamp,
            )
        )
        await session.commit()

    def listed(zone, **params):
        return (
            'name="task_ids" value="night"'
            in _page(client, "/app", zone, **params).text
        )

    assert listed("Europe/Warsaw", since="2026-06-01")
    assert not listed("Europe/Warsaw", until="2026-05-31")
    assert not listed(None, since="2026-06-01")
    assert listed(None, until="2026-05-31")


# --- what the pages print ----------------------------------------------------------


def test_fmt_local_names_the_zone():
    from src.utils.clientzone import fmt_local

    stamp = datetime(2026, 10, 4, 23, 30)  # naive, as SQLite returns it
    assert fmt_local(stamp, WARSAW) == "2026-10-05 01:30 CEST"
    assert fmt_local(stamp, UTC) == "2026-10-04 23:30 UTC"
    assert (
        fmt_local(datetime(2026, 12, 1, 12, 0, tzinfo=timezone.utc), WARSAW)
        == "2026-12-01 13:00 CET"
    )


def test_problem_times_are_the_readers():
    stamp = datetime(2026, 10, 4, 23, 30, tzinfo=timezone.utc)
    view = _group_view(
        "sig",
        [
            Occurrence(
                source=SOURCE_TELEMETRY,
                category="index",
                tool=None,
                text="x",
                when=stamp,
            )
        ],
        zone=WARSAW,
    )
    assert (
        view["first_seen"]
        == view["last_seen"]
        == view["sample"]["when"]
        == "2026-10-05 01:30 CEST"
    )


async def test_task_list_prints_local_times(client, db_session, session_factory):
    await _seed_user(db_session)
    async with session_factory() as session:
        stamp = datetime(2026, 5, 31, 22, 30, tzinfo=timezone.utc)
        session.add(
            Task(
                id="night",
                user_id="user_test",
                title="Night",
                created_at=stamp,
                updated_at=stamp,
            )
        )
        await session.commit()

    warsaw = _page(client, "/app", "Europe/Warsaw").text
    assert (
        '<span class="cell-date" title="2026-06-01 00:30 CEST">2026-06-01 00:30</span>'
        in warsaw
    )
    utc = _page(client, "/app", None).text
    assert (
        '<span class="cell-date" title="2026-05-31 22:30 UTC">2026-05-31 22:30</span>'
        in utc
    )
