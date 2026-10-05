"""The reader's time zone, and every calendar computation done in it.

Timestamps are stored in UTC. What a person reads, and every "day" (today, a
daily bucket, a date filter), is in the zone of whoever is looking: a Warsaw
reader's today starts at 22:00 UTC the evening before, and counting from UTC
midnight instead loses their first two hours.

The zone comes from the ``tumble_tz`` cookie, which ``static/app.js`` writes
from the browser's own ``Intl`` zone. No cookie, or a name this server's tz
database does not know, means UTC.

All day math goes through ``day_start_utc``: never add ``timedelta(days=1)`` to
an aware local datetime, because a day is 23 or 25 hours long when daylight
saving time starts or ends.
"""

from datetime import date, datetime, time, timezone
from functools import lru_cache
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import Request

TZ_COOKIE = "tumble_tz"
UTC = ZoneInfo("UTC")


@lru_cache(maxsize=64)
def parse_zone(name: Optional[str]) -> ZoneInfo:
    """The zone called ``name``, or UTC for anything unusable."""
    if not name or len(name) > 64 or name.startswith("/") or ".." in name:
        return UTC
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return UTC


def client_zone(request: Request) -> ZoneInfo:
    return parse_zone(request.cookies.get(TZ_COOKIE))


def as_utc(stamp: datetime) -> datetime:
    """``stamp`` as an aware UTC datetime. SQLite hands timestamps back naive;
    they are stored in UTC."""
    if stamp.tzinfo is None:
        return stamp.replace(tzinfo=timezone.utc)
    return stamp.astimezone(timezone.utc)


def local_day(stamp: datetime, zone: ZoneInfo) -> date:
    """The reader's calendar day ``stamp`` falls on."""
    return as_utc(stamp).astimezone(zone).date()


def day_start_utc(day: date, zone: ZoneInfo) -> datetime:
    """The UTC instant the reader's ``day`` starts at (their local midnight).

    The round trip through UTC also settles the few zones whose clocks jump
    over midnight itself on a switch day.
    """
    return datetime.combine(day, time.min, tzinfo=zone).astimezone(timezone.utc)


def today(zone: ZoneInfo, now: Optional[datetime] = None) -> date:
    return local_day(now or datetime.now(timezone.utc), zone)
