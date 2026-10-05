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
from tests.web_helpers import _llm_event, _override_web_user, _seed_user

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
    db_session.add_all(
        [
            _llm_event(task_id="night", tin=1000, tout=0, created_at=datetime(2026, 10, 4, 23, 30, tzinfo=timezone.utc)),
            _llm_event(task_id="evening", tin=10, tout=0, created_at=datetime(2026, 10, 4, 21, 30, tzinfo=timezone.utc)),
        ]
    )
    await db_session.commit()


async def test_today_counts_the_local_night(db_session):
    await _seed_night(db_session)

    local = await compute_user_metrics(db_session, "user_test", "today", now=NOW, zone=WARSAW)
    assert local["totals"]["input"] == 1000

    utc = await compute_user_metrics(db_session, "user_test", "today", now=NOW, zone=UTC)
    assert utc["totals"]["input"] == 0


async def test_daily_buckets_are_local_days(db_session):
    await _seed_night(db_session)

    local = await compute_user_metrics(db_session, "user_test", "all", now=NOW, zone=WARSAW)
    assert [(d["day"], d["tokens"]) for d in local["by_day"]] == [("2026-10-04", 10), ("2026-10-05", 1000)]

    utc = await compute_user_metrics(db_session, "user_test", "all", now=NOW, zone=UTC)
    assert [(d["day"], d["tokens"]) for d in utc["by_day"]] == [("2026-10-04", 1010)]


# --- problems --------------------------------------------------------------------


def test_problem_reach_counts_local_days():
    def occurrence(stamp):
        return Occurrence(source=SOURCE_TELEMETRY, category="index", tool=None, text="boom", when=stamp)

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
async def test_pages_say_which_zone_they_were_computed_in(client, db_session, cookie, rendered):
    await _seed_user(db_session)
    body = _page(client, "/app/metrics", cookie).text
    assert f'<body data-tz="{rendered}">' in body


async def test_metrics_page_today_uses_the_cookie_zone(client, db_session, monkeypatch):
    from src.services import metrics_service

    await _seed_night(db_session)
    real_today = metrics_service.today
    monkeypatch.setattr(metrics_service, "today", lambda zone, now=None: real_today(zone, NOW))

    warsaw = _page(client, "/app/metrics", "Europe/Warsaw", period="today").text
    utc = _page(client, "/app/metrics", None, period="today").text
    assert "No usage recorded" not in warsaw
    assert "No usage recorded" in utc


async def test_task_list_dates_are_local_days(client, db_session, session_factory):
    await _seed_user(db_session)
    async with session_factory() as session:
        # 00:30 on 1 June in Warsaw, 31 May in UTC.
        stamp = datetime(2026, 5, 31, 22, 30, tzinfo=timezone.utc)
        session.add(Task(id="night", user_id="user_test", title="Night", created_at=stamp, updated_at=stamp))
        await session.commit()

    def listed(zone, **params):
        return 'name="task_ids" value="night"' in _page(client, "/app", zone, **params).text

    assert listed("Europe/Warsaw", since="2026-06-01")
    assert not listed("Europe/Warsaw", until="2026-05-31")
    assert not listed(None, since="2026-06-01")
    assert listed(None, until="2026-05-31")
