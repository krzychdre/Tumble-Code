"""Lift the figures of LLM Completion and Embedding Usage events into columns.

The metrics page, the diagnostics page and the task page read an event's
tokens, cost, request duration, model, provider, mode and kind. They lived only
in the JSON ``properties`` text, so every read fetched and parsed the whole
payload of every event in its period. Ingest now stamps them into columns
(services/telemetry_vocab.event_columns); this adds the columns and fills them
on the events stored before, with a frozen copy of that rule.

Nullable without a default: no other event type has these figures. An
embedding's prompt tokens go to input_tokens, its source to embedding_source.

The stored payloads are what clients sent, any of them hand-made: a figure
outside the bounds of one request reads as 0 and a name is cleaned as ingest
cleans it, so no stored value can make the backfill fail.

Revision ID: e8f9a0b1c2d3
Revises: d4e5f6a7b8c1
Create Date: 2026-10-28 00:30:00.000000

"""

import json
import math
import unicodedata

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "e8f9a0b1c2d3"
down_revision = "d4e5f6a7b8c1"
branch_labels = None
depends_on = None

COLUMNS = (
    ("input_tokens", sa.BigInteger()),
    ("output_tokens", sa.BigInteger()),
    ("cache_read_tokens", sa.BigInteger()),
    ("cache_write_tokens", sa.BigInteger()),
    ("cost", sa.Float()),
    ("duration_ms", sa.BigInteger()),
    ("model_id", sa.String()),
    ("provider", sa.String()),
    ("mode", sa.String()),
    ("embedding_source", sa.String()),
    ("completion_kind", sa.String()),
    ("usage_reported", sa.Boolean()),
)
LLM_COMPLETION_EVENT = "LLM Completion"
EMBEDDING_EVENT = "Embedding Usage"
BATCH = 5000
# utils/format's bounds of one request and telemetry_vocab.NAME_MAX_BYTES.
MAX_TOKENS = 10**9
MAX_COST = 10_000.0
MAX_MS = 24 * 3600 * 1000
NAME_MAX_BYTES = 256
# A real payload of these events is under 1 KB. A longer one, which only a
# hand-made request stores, reads as empty, so a batch holds at most
# BATCH x PAYLOAD_MAX characters.
PAYLOAD_MAX = 16384


def _figure(value, limit):
    """utils/format.figure as it was when this ran."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return 0
    if isinstance(value, float) and not math.isfinite(value):
        return 0
    return value if 0 <= value <= limit else 0


def _name(value):
    """services/telemetry_vocab.clean_name as it was when this ran."""
    if not isinstance(value, str):
        return None
    kept = "".join(
        ch for ch in value if unicodedata.category(ch) not in ("Cc", "Cf", "Cs")
    )
    return kept.encode()[:NAME_MAX_BYTES].decode(errors="ignore").strip() or None


def _event_columns(event_type: str, props: dict) -> dict:
    """services/telemetry_vocab.event_columns as it was when this ran."""
    if event_type == LLM_COMPLETION_EVENT:
        return {
            "input_tokens": int(_figure(props.get("inputTokens"), MAX_TOKENS)),
            "output_tokens": int(_figure(props.get("outputTokens"), MAX_TOKENS)),
            "cache_read_tokens": int(_figure(props.get("cacheReadTokens"), MAX_TOKENS)),
            "cache_write_tokens": int(
                _figure(props.get("cacheWriteTokens"), MAX_TOKENS)
            ),
            "cost": float(_figure(props.get("cost"), MAX_COST)),
            "duration_ms": int(_figure(props.get("durationMs"), MAX_MS)),
            "model_id": _name(props.get("modelId")),
            "provider": _name(props.get("apiProvider")),
            "mode": _name(props.get("mode")),
            "completion_kind": _name(props.get("completionKind")) or "task",
            "usage_reported": props.get("usageReported") is not False,
        }
    return {
        "input_tokens": int(_figure(props.get("promptTokens"), MAX_TOKENS)),
        "embedding_source": _name(props.get("source")),
    }


def _props(payload) -> dict:
    """The payload's JSON object. Python's json accepts the NaN that
    json.dumps writes (and jsonb rejects); a payload that is not an object
    reads as an empty one, so every event of the two types gets figures."""
    try:
        props = json.loads(payload or "{}")
    except (ValueError, TypeError):
        return {}
    return props if isinstance(props, dict) else {}


def upgrade() -> None:
    for name, type_ in COLUMNS:
        op.add_column("telemetry_events", sa.Column(name, type_, nullable=True))

    _backfill()


def _backfill() -> None:
    """Stamp the figures on every stored completion and embedding.

    Walked in batches by id (keyset, not OFFSET: the walk updates the table it
    reads), so a corpus of any size stays within a sane amount of memory.
    """
    conn = op.get_bind()
    updates = {}
    for event_type in (LLM_COMPLETION_EVENT, EMBEDDING_EVENT):
        names = list(_event_columns(event_type, {}))
        updates[event_type] = sa.text(
            "UPDATE telemetry_events SET "
            + ", ".join(f"{name} = :{name}" for name in names)
            + " WHERE id = :row_id"
        )

    last_id = ""
    while True:
        rows = conn.execute(
            sa.text(
                "SELECT id, event_type, "
                "CASE WHEN length(properties) > :payload_max THEN NULL "
                "ELSE properties END "
                "FROM telemetry_events "
                "WHERE id > :last AND event_type IN (:completion, :embedding) "
                "ORDER BY id LIMIT :limit"
            ),
            {
                "payload_max": PAYLOAD_MAX,
                "last": last_id,
                "completion": LLM_COMPLETION_EVENT,
                "embedding": EMBEDDING_EVENT,
                "limit": BATCH,
            },
        ).fetchall()
        if not rows:
            break
        last_id = rows[-1][0]

        params = {event_type: [] for event_type in updates}
        for row_id, event_type, payload in rows:
            params[event_type].append(
                {"row_id": row_id, **_event_columns(event_type, _props(payload))}
            )
        for event_type, batch in params.items():
            if batch:
                conn.execute(updates[event_type], batch)


def downgrade() -> None:
    for name, _type in reversed(COLUMNS):
        op.drop_column("telemetry_events", name)
