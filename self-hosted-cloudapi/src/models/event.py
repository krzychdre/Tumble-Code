"""TelemetryEvent and UsageRollup models."""

import calendar

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    String,
    Text,
)
from datetime import datetime, timezone

from src.models.base import Base, generate_id


class TelemetryEvent(Base):
    """Telemetry event model."""

    __tablename__ = "telemetry_events"
    __table_args__ = (
        # The metrics page (services/metrics_service) reads one user's events of
        # one type over a created_at range, ordered by created_at. The
        # single-column indexes can only serve one of the three conditions;
        # this one serves all of them and the ORDER BY. Added by migration
        # a3b4c5d6e7f8.
        Index(
            "ix_telemetry_events_user_type_created",
            "user_id",
            "event_type",
            "created_at",
        ),
    )

    id = Column(String, primary_key=True, default=lambda: generate_id("evt_"))
    user_id = Column(
        String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    organization_id = Column(
        String,
        ForeignKey("organizations.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    event_type = Column(String, nullable=False, index=True)
    # Lifted out of `properties` at ingest so the task a completion belongs to is
    # an indexed lookup instead of a JSON scan over the whole event corpus. The
    # blob stays authoritative — this is a key, not a second source of truth.
    # Not a FK: telemetry names tasks that may never be stored as rows.
    task_id = Column(String, nullable=True, index=True)
    # Which client sent the event, "vscode" or "cli" (services/client_kind),
    # lifted out of `properties` at ingest like task_id. Not indexed: the
    # metrics reads narrow by (user_id, event_type, created_at) first, and a
    # two-value column can only filter the rows that index already found.
    client_kind = Column(
        String, nullable=False, default="vscode", server_default="vscode"
    )
    # The figures of an LLM Completion or an Embedding Usage event, lifted out
    # of `properties` at ingest (services/telemetry_vocab.event_columns), so
    # the metrics, diagnostics and task pages read columns instead of parsing
    # every payload of their period. NULL on every other event type; filled
    # on every event of those two types (migration e8f9a0b1c2d3 backfilled
    # the older ones).
    input_tokens = Column(BigInteger, nullable=True)  # an embedding's promptTokens
    output_tokens = Column(BigInteger, nullable=True)
    cache_read_tokens = Column(BigInteger, nullable=True)
    cache_write_tokens = Column(BigInteger, nullable=True)
    cost = Column(Float, nullable=True)
    duration_ms = Column(BigInteger, nullable=True)
    # A name is NULL when the event did not give one.
    model_id = Column(String, nullable=True)
    provider = Column(String, nullable=True)
    mode = Column(String, nullable=True)
    embedding_source = Column(String, nullable=True)
    completion_kind = Column(String, nullable=True)
    usage_reported = Column(Boolean, nullable=True)
    properties = Column(Text, default="{}")
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


# usage_rollup sums the figures per quarter of an hour of UTC. Every zone's
# offset from UTC is a whole number of quarters (Nepal's +05:45 too), so a
# reader's midnight starts a quarter and no quarter straddles one.
QUARTER_SECONDS = 900


def quarter_of(at: datetime) -> int:
    """The quarter of an hour of UTC ``at`` falls in, counted from the epoch."""
    return calendar.timegm(at.utctimetuple()) // QUARTER_SECONDS


class UsageRollup(Base):
    """The figures of LLM Completion and Embedding Usage events, summed per
    user, quarter of an hour, task and combination of names.

    The metrics and diagnostics pages sum these rows instead of the events:
    an organization has millions of completions, and a few hundred thousand
    of these rows. Ingest adds each event into its row in the event's own
    transaction (services/telemetry_service.add_to_rollup); migration
    f2b3c4d5e6a7 built the rows of the events stored before it. The columns
    are the event's columns of the same names (telemetry_vocab.event_columns),
    summed. A row of a past quarter never changes again.
    """

    __tablename__ = "usage_rollup"

    # The event's user. The primary key's order serves the pages' reads: one
    # user's rows of one type over a range of quarters. A deleted user's rows
    # go with them; their events stay with a NULL user, which no page reads.
    user_id = Column(
        String, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    event_type = Column(String, primary_key=True)
    quarter = Column(BigInteger, primary_key=True)  # quarter_of(created_at)
    # The sha256 of the task, the names and the client
    # (telemetry_service.rollup_key). A client makes those as long as it
    # likes, and a Postgres btree entry holds at most 2704 bytes.
    names_key = Column(String(64), primary_key=True)
    # Not a foreign key, like telemetry_events.task_id.
    task_id = Column(String, nullable=True)
    client_kind = Column(String, nullable=False)
    model_id = Column(String, nullable=True)
    provider = Column(String, nullable=True)
    mode = Column(String, nullable=True)
    completion_kind = Column(String, nullable=True)
    embedding_source = Column(String, nullable=True)
    # Sums. An embedding adds its prompt tokens to input_tokens and zero to
    # the figures it does not have.
    input_tokens = Column(BigInteger, nullable=False)
    output_tokens = Column(BigInteger, nullable=False)
    cache_read_tokens = Column(BigInteger, nullable=False)
    cache_write_tokens = Column(BigInteger, nullable=False)
    cost = Column(Float, nullable=False)
    duration_ms = Column(BigInteger, nullable=False)
    # How many events the row sums, and how many of them are completions
    # whose provider reported no usage (usage_reported false).
    events = Column(BigInteger, nullable=False)
    unreported = Column(BigInteger, nullable=False)
    # The earliest created_at of those events: rows that tie keep the order
    # in which their names first occurred.
    first_at = Column(DateTime(timezone=True), nullable=False)
