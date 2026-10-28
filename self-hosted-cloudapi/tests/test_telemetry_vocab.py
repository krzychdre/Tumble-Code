"""One telemetry vocabulary (CAPI-M3).

The event names, the completion kinds, their labels, the decoding of a JSON
properties payload and the ``api_req_started`` parser used to be written out
separately in ``metrics_service``, ``model_attribution``,
``retention_service`` and ``task_summary``. A copy that drifts is exactly how
CB-7 happened (two ``_num`` copies disagreed about ``bool``), so this file pins
three things:

1. characterization: what each of the old call sites did, so the move to
   ``services/telemetry_vocab`` provably changes no behaviour;
2. the columns ingest lifts out of an event (``event_columns``), which every
   page reads instead of the payload;
3. identity: every module uses the SAME objects from ``telemetry_vocab``, in the
   style of ``test_format_helpers_are_single_source_of_truth``.
"""

import json

import pytest
from sqlalchemy import select

from src.models.event import TelemetryEvent
from src.services import metrics_service, model_attribution, task_summary
from src.services.telemetry_service import record_event
from src.services.telemetry_vocab import (
    EMBEDDING_EVENT,
    LLM_COMPLETION_EVENT,
    TASK_KIND,
    event_columns,
)
from tests.web_helpers import _event_row, _seed_user

# --- characterization: the two label maps -----------------------------------


def test_the_two_kind_label_maps_agree_on_every_side_call_kind():
    """``KIND_LABELS`` (metrics page) and ``SIDE_CALL_LABELS`` (task detail) must
    read a side call the same way. The only key one has and the other lacks is
    ``task``, which ``side_calls_summary`` skips before it ever looks a label
    up, so a single map serves both."""
    kind_labels = metrics_service.KIND_LABELS
    side_labels = model_attribution.SIDE_CALL_LABELS

    for kind in set(kind_labels) | set(side_labels):
        if kind == TASK_KIND:
            continue
        assert kind_labels.get(kind) == side_labels.get(kind), kind
    assert kind_labels[TASK_KIND] == "Conversation"


def test_side_calls_summary_labels_known_and_unknown_kinds():
    Completion = model_attribution.Completion
    rows = model_attribution.side_calls_summary(
        [
            Completion(
                model="m", mode=None, input_tokens=10, output_tokens=1, kind="task"
            ),
            Completion(
                model="m", mode=None, input_tokens=5, output_tokens=1, kind="condense"
            ),
            Completion(
                model="m", mode=None, input_tokens=3, output_tokens=1, kind="brand-new"
            ),
        ]
    )
    assert [(r["kind"], r["label"]) for r in rows] == [
        ("condense", "Condensing"),
        ("brand-new", "brand-new"),
    ]


# --- the kind read off an event: one rule for both pages --------------------
#
# Owner decision 25: a kind that is not a non-empty string is an ordinary
# conversation turn (``telemetry_vocab.completion_kind``). Ingest stores the
# kind it reads in ``completion_kind``, and the metrics page and the task
# detail page both read that column, so they count an event the same way.

# (raw completionKind, or MISSING for no key) -> the kind both pages use
MISSING = object()
KIND_CASES = [
    pytest.param(MISSING, "task", id="missing"),
    pytest.param(None, "task", id="null"),
    pytest.param("", "task", id="empty"),
    pytest.param("condense", "condense", id="known"),
    pytest.param("brand-new", "brand-new", id="unknown-string"),
    pytest.param(5, "task", id="number"),
    pytest.param(0, "task", id="zero"),
    pytest.param(True, "task", id="boolean"),
    pytest.param(["memory"], "task", id="list"),
    pytest.param({"k": "memory"}, "task", id="object"),
]


def _props_with_kind(raw) -> dict:
    props = {"modelId": "m", "inputTokens": 1, "outputTokens": 1}
    if raw is not MISSING:
        props["completionKind"] = raw
    return props


@pytest.mark.parametrize("raw, kind", KIND_CASES)
def test_completion_kind_stored_at_ingest(raw, kind):
    columns = event_columns(LLM_COMPLETION_EVENT, _props_with_kind(raw))
    assert columns["completion_kind"] == kind


async def test_completion_kind_on_the_metrics_page_counts_a_malformed_kind_as_a_turn(
    db_session,
):
    """A numeric, boolean, list or empty kind lands in the Conversation row,
    exactly as the task detail page counts it, instead of a row of its own."""
    await _seed_user(db_session)
    for kind in (5, True, ["memory"], "", "memory"):
        db_session.add(
            _event_row(
                LLM_COMPLETION_EVENT,
                {
                    "modelId": "m",
                    "inputTokens": 1,
                    "outputTokens": 0,
                    "completionKind": kind,
                },
            )
        )
    await db_session.commit()

    m = await metrics_service.compute_user_metrics(
        db_session, "user_test", period="all"
    )
    rows = {row["name"]: (row["label"], row["tokens"]) for row in m["by_kind"]}
    assert rows == {"task": ("Conversation", 4), "memory": ("Memory recall", 1)}


# --- the columns ingest lifts out of an event --------------------------------

# Every column event_columns fills for some event type.
LIFTED = sorted(
    set(event_columns(LLM_COMPLETION_EVENT, {}))
    | set(event_columns(EMBEDDING_EVENT, {}))
)
NO_FIGURES = dict.fromkeys(LIFTED)

INGEST_CASES = [
    pytest.param(
        LLM_COMPLETION_EVENT,
        {
            "taskId": "t1",
            "modelId": "glm",
            "apiProvider": "zai",
            "mode": "code",
            "inputTokens": 1000,
            "outputTokens": 20,
            "cacheReadTokens": 300,
            "cacheWriteTokens": 40,
            "cost": 0.25,
            "durationMs": 1500,
            "completionKind": "condense",
            "usageReported": True,
        },
        {
            "input_tokens": 1000,
            "output_tokens": 20,
            "cache_read_tokens": 300,
            "cache_write_tokens": 40,
            "cost": 0.25,
            "duration_ms": 1500,
            "model_id": "glm",
            "provider": "zai",
            "mode": "code",
            "completion_kind": "condense",
            "usage_reported": True,
        },
        id="completion",
    ),
    # Nothing but the task: every number 0, every name NULL, a reported turn.
    pytest.param(
        LLM_COMPLETION_EVENT,
        {"taskId": "t1"},
        {
            "input_tokens": 0,
            "output_tokens": 0,
            "cache_read_tokens": 0,
            "cache_write_tokens": 0,
            "cost": 0.0,
            "duration_ms": 0,
            "completion_kind": TASK_KIND,
            "usage_reported": True,
        },
        id="completion-missing-fields",
    ),
    # Strings and booleans are no numbers, a float duration is stored whole,
    # an empty name is no name.
    pytest.param(
        LLM_COMPLETION_EVENT,
        {
            "modelId": "",
            "apiProvider": "",
            "mode": "",
            "inputTokens": "900",
            "outputTokens": True,
            "cacheReadTokens": False,
            "cost": "1.5",
            "durationMs": 1500.0,
            "usageReported": False,
        },
        {
            "input_tokens": 0,
            "output_tokens": 0,
            "cache_read_tokens": 0,
            "cache_write_tokens": 0,
            "cost": 0.0,
            "duration_ms": 1500,
            "completion_kind": TASK_KIND,
            "usage_reported": False,
        },
        id="completion-odd-values",
    ),
    # What a hostile client or its own server can report: a figure outside
    # one request's bounds is none, the bounds themselves are kept.
    pytest.param(
        LLM_COMPLETION_EVENT,
        {
            "inputTokens": 10**19,
            "outputTokens": -5,
            "cacheReadTokens": 10**9,
            "cacheWriteTokens": 1e9 + 1,
            "cost": 1e300,
            "durationMs": 24 * 3600 * 1000 + 1,
        },
        {
            "input_tokens": 0,
            "output_tokens": 0,
            "cache_read_tokens": 10**9,
            "cache_write_tokens": 0,
            "cost": 0.0,
            "duration_ms": 0,
            "completion_kind": TASK_KIND,
            "usage_reported": True,
        },
        id="completion-out-of-bounds",
    ),
    pytest.param(
        LLM_COMPLETION_EVENT,
        {"cost": -1000, "durationMs": 24 * 3600 * 1000, "inputTokens": 0.5},
        {
            "input_tokens": 0,
            "output_tokens": 0,
            "cache_read_tokens": 0,
            "cache_write_tokens": 0,
            "cost": 0.0,
            "duration_ms": 24 * 3600 * 1000,
            "completion_kind": TASK_KIND,
            "usage_reported": True,
        },
        id="completion-negative-cost",
    ),
    # Only a string is a name; control, format and surrogate characters go,
    # and a name is cut to 256 bytes on a character boundary.
    pytest.param(
        LLM_COMPLETION_EVENT,
        {
            "modelId": " evil\x00mo\u200bdel\n",
            "apiProvider": "\ud800zai",
            "mode": 5,
            "completionKind": "con\x00dense",
        },
        {
            "input_tokens": 0,
            "output_tokens": 0,
            "cache_read_tokens": 0,
            "cache_write_tokens": 0,
            "cost": 0.0,
            "duration_ms": 0,
            "model_id": "evilmodel",
            "provider": "zai",
            "completion_kind": "condense",
            "usage_reported": True,
        },
        id="completion-odd-names",
    ),
    pytest.param(
        LLM_COMPLETION_EVENT,
        {"modelId": "m" + "\U0001f600" * 100, "mode": ["code"], "apiProvider": {}},
        {
            "input_tokens": 0,
            "output_tokens": 0,
            "cache_read_tokens": 0,
            "cache_write_tokens": 0,
            "cost": 0.0,
            "duration_ms": 0,
            "model_id": "m" + "\U0001f600" * 63,
            "completion_kind": TASK_KIND,
            "usage_reported": True,
        },
        id="completion-long-name",
    ),
    pytest.param(
        EMBEDDING_EVENT,
        {"promptTokens": 5000, "totalTokens": 5000, "source": "index-scan"},
        {"input_tokens": 5000, "embedding_source": "index-scan"},
        id="embedding",
    ),
    pytest.param(
        EMBEDDING_EVENT,
        {"promptTokens": 2 * 10**9, "source": 7},
        {"input_tokens": 0},
        id="embedding-out-of-bounds",
    ),
    pytest.param(
        EMBEDDING_EVENT,
        {"promptTokens": "12"},
        {"input_tokens": 0},
        id="embedding-odd-values",
    ),
    pytest.param(
        "Task Message",
        {"taskId": "t1", "modelId": "glm", "inputTokens": 5},
        {},
        id="other-event",
    ),
]


@pytest.mark.parametrize("event_type, props, columns", INGEST_CASES)
async def test_ingest_stores_the_figures_of_an_event(
    db_session, event_type, props, columns
):
    await _seed_user(db_session)

    await record_event(db_session, "user_test", None, event_type, props)

    stored = (
        await db_session.execute(
            select(*(getattr(TelemetryEvent, name) for name in LIFTED))
        )
    ).one()
    assert dict(stored._mapping) == {**NO_FIGURES, **columns}


# --- characterization: the two api_req_started parsers ----------------------

_REQ = {
    "tokensIn": 100,
    "tokensOut": 20,
    "cacheReads": 7,
    "cacheWrites": 3,
    "cost": 0.25,
}


@pytest.mark.parametrize(
    "msg, pair, metrics",
    [
        # A finished request: both readers see the figures.
        (
            {"type": "say", "say": "api_req_started", "text": json.dumps(_REQ)},
            (100, 20),
            (100, 20, 7, 3, 0.25),
        ),
        # Still in flight: no figures, so no token pair to match on.
        (
            {"type": "say", "say": "api_req_started", "text": "{}"},
            None,
            (0, 0, 0, 0, 0.0),
        ),
        (
            {"type": "say", "say": "api_req_started", "text": ""},
            None,
            (0, 0, 0, 0, 0.0),
        ),
        ({"type": "say", "say": "api_req_started"}, None, (0, 0, 0, 0, 0.0)),
        # A partial whose text is not valid JSON yet.
        (
            {"type": "say", "say": "api_req_started", "text": '{"tokensIn": 1'},
            None,
            (0, 0, 0, 0, 0.0),
        ),
        # Valid JSON that is not an object.
        (
            {"type": "say", "say": "api_req_started", "text": "[1]"},
            None,
            (0, 0, 0, 0, 0.0),
        ),
        ({"type": "say", "say": "api_req_started", "text": 5}, None, (0, 0, 0, 0, 0.0)),
        # Not a request at all.
        (
            {"type": "say", "say": "text", "text": json.dumps(_REQ)},
            None,
            (0, 0, 0, 0, 0.0),
        ),
        # The one disagreement: ``type`` is only checked by task_summary. A
        # request under a non-"say" type still yields a token pair for the
        # attribution join but contributes nothing to the task totals.
        (
            {"type": "ask", "say": "api_req_started", "text": json.dumps(_REQ)},
            (100, 20),
            (0, 0, 0, 0, 0.0),
        ),
    ],
)
def test_the_two_api_req_started_readers(msg, pair, metrics):
    assert model_attribution._request_tokens(msg) == pair
    got = task_summary.message_metrics(msg)
    assert (
        got.tokens_in,
        got.tokens_out,
        got.cache_reads,
        got.cache_writes,
        got.cost,
    ) == metrics


# --- the shared module ------------------------------------------------------


def test_parse_event_props_reads_only_json_objects():
    from src.services.telemetry_vocab import parse_event_props

    assert parse_event_props('{"a": 1}') == {"a": 1}
    assert parse_event_props("not json") is None
    assert parse_event_props("[1]") is None
    assert parse_event_props("") == {}
    assert parse_event_props(None) == {}
    assert parse_event_props(b'{"c": 3}') == {"c": 3}


@pytest.mark.parametrize(
    "msg, expected",
    [
        ({"say": "api_req_started", "text": json.dumps(_REQ)}, _REQ),
        ({"type": "ask", "say": "api_req_started", "text": "{}"}, {}),
        ({"say": "api_req_started", "text": ""}, None),
        ({"say": "api_req_started"}, None),
        ({"say": "api_req_started", "text": "{"}, None),
        ({"say": "api_req_started", "text": "[1]"}, None),
        ({"say": "api_req_started", "text": 5}, None),
        ({"say": "text", "text": "{}"}, None),
        ("not a dict", None),
    ],
)
def test_api_req_started_payload(msg, expected):
    from src.services.telemetry_vocab import api_req_started_payload

    assert api_req_started_payload(msg) == expected


def test_telemetry_vocabulary_is_single_source_of_truth():
    """Every module names events, kinds and labels with the SAME objects from
    ``telemetry_vocab``, and decodes payloads with the same functions. If a
    module re-defines a local copy, identity fails."""
    from src.services import retention_service, telemetry_service
    from src.services import telemetry_vocab as vocab

    assert vocab.LLM_COMPLETION_EVENT == "LLM Completion"
    assert vocab.EMBEDDING_EVENT == "Embedding Usage"
    assert vocab.TASK_KIND == "task"

    assert metrics_service.LLM_COMPLETION_EVENT is vocab.LLM_COMPLETION_EVENT
    assert metrics_service.EMBEDDING_EVENT is vocab.EMBEDDING_EVENT
    assert metrics_service.KIND_LABELS is vocab.KIND_LABELS

    assert model_attribution.LLM_COMPLETION_EVENT is vocab.LLM_COMPLETION_EVENT
    assert model_attribution.TASK_KIND is vocab.TASK_KIND
    assert model_attribution.SIDE_CALL_LABELS is vocab.KIND_LABELS
    assert model_attribution.api_req_started_payload is vocab.api_req_started_payload

    assert task_summary.api_req_started_payload is vocab.api_req_started_payload
    assert telemetry_service.LLM_COMPLETION_EVENT is vocab.LLM_COMPLETION_EVENT
    assert telemetry_service.event_columns is vocab.event_columns

    # Retention protects every event the metrics page reads. Extend, never shrink.
    assert retention_service.PROTECTED_EVENT_TYPES[0] is vocab.LLM_COMPLETION_EVENT
    assert retention_service.PROTECTED_EVENT_TYPES[1] is vocab.EMBEDDING_EVENT
