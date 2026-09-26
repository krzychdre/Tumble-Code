"""One telemetry vocabulary (CAPI-M3).

The event names, the completion kinds, their labels, the "decode a JSON
properties payload, skip anything that is not an object" loop and the
``api_req_started`` parser used to be written out separately in
``metrics_service``, ``model_attribution``, ``retention_service`` and
``task_summary``. A copy that drifts is exactly how CB-7 happened (two ``_num``
copies disagreed about ``bool``), so this file pins two things:

1. characterization: what each of the old call sites did, so the move to
   ``services/telemetry_vocab`` provably changes no behaviour;
2. identity: every module uses the SAME objects from ``telemetry_vocab``, in the
   style of ``test_format_helpers_are_single_source_of_truth``.
"""

import json

import pytest

from src.services import metrics_service, model_attribution, task_summary
from src.services.telemetry_vocab import TASK_KIND

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
            Completion(model="m", mode=None, input_tokens=10, output_tokens=1, kind="task"),
            Completion(model="m", mode=None, input_tokens=5, output_tokens=1, kind="condense"),
            Completion(model="m", mode=None, input_tokens=3, output_tokens=1, kind="brand-new"),
        ]
    )
    assert [(r["kind"], r["label"]) for r in rows] == [
        ("condense", "Condensing"),
        ("brand-new", "brand-new"),
    ]


# --- the kind read off an event: one rule for both pages --------------------
#
# The metrics page used to read the kind as ``str(kind or "task")``, so a
# malformed numeric kind became its own row "5", while the task detail page
# (``completion_from_properties``) counted it as a conversation turn. Owner
# decision 25: both pages treat a kind that is not a non-empty string as an
# ordinary conversation turn, through ``telemetry_vocab.completion_kind``.

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
def test_completion_kind(raw, kind):
    from src.services.telemetry_vocab import completion_kind

    assert completion_kind(_props_with_kind(raw)) == kind


@pytest.mark.parametrize("raw, kind", KIND_CASES)
def test_completion_kind_on_the_task_detail_page(raw, kind):
    completion = model_attribution.completion_from_properties(_props_with_kind(raw))
    assert completion is not None
    assert completion.kind == kind


async def test_completion_kind_on_the_metrics_page_counts_a_malformed_kind_as_a_turn(db_session):
    """A numeric, boolean, list or empty kind lands in the Conversation row,
    exactly as the task detail page counts it, instead of a row of its own."""
    from tests.test_web_and_share import _seed_user
    from src.models.event import TelemetryEvent

    await _seed_user(db_session)
    for kind in (5, True, ["memory"], "", "memory"):
        db_session.add(
            TelemetryEvent(
                user_id="user_test",
                event_type="LLM Completion",
                properties=json.dumps(
                    {"modelId": "m", "inputTokens": 1, "outputTokens": 0, "completionKind": kind}
                ),
            )
        )
    await db_session.commit()

    m = await metrics_service.compute_user_metrics(db_session, "user_test", period="all")
    rows = {row["name"]: (row["label"], row["tokens"]) for row in m["by_kind"]}
    assert rows == {"task": ("Conversation", 4), "memory": ("Memory recall", 1)}


# --- characterization: skipping undecodable payloads ------------------------


async def test_metrics_and_attribution_skip_payloads_that_are_not_json_objects(db_session):
    from tests.test_web_and_share import _seed_user
    from src.models.event import TelemetryEvent

    await _seed_user(db_session)
    good = {"taskId": "t1", "modelId": "m", "inputTokens": 7, "outputTokens": 3}
    for payload in ("not json", "[1, 2]", "42", None, json.dumps(good)):
        db_session.add(
            TelemetryEvent(
                user_id="user_test",
                task_id="t1",
                event_type="LLM Completion",
                properties=payload,
            )
        )
    for payload in ("{", '"x"', json.dumps({"promptTokens": 9, "source": "s"})):
        db_session.add(
            TelemetryEvent(user_id="user_test", event_type="Embedding Usage", properties=payload)
        )
    await db_session.commit()

    m = await metrics_service.compute_user_metrics(db_session, "user_test", period="all")
    # ``None`` decodes as ``{}``: an empty completion is still a completion.
    assert m["totals"]["completions"] == 2
    assert m["totals"]["total_tokens"] == 10
    assert m["embeddings"]["calls"] == 1
    assert m["embeddings"]["tokens"] == 9

    completions = await model_attribution.completions_for_task(db_session, "t1", "user_test")
    assert [(c.model, c.input_tokens, c.output_tokens) for c in completions] == [("m", 7, 3)]


# --- characterization: the two api_req_started parsers ----------------------

_REQ = {"tokensIn": 100, "tokensOut": 20, "cacheReads": 7, "cacheWrites": 3, "cost": 0.25}


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
        ({"type": "say", "say": "api_req_started", "text": "{}"}, None, (0, 0, 0, 0, 0.0)),
        ({"type": "say", "say": "api_req_started", "text": ""}, None, (0, 0, 0, 0, 0.0)),
        ({"type": "say", "say": "api_req_started"}, None, (0, 0, 0, 0, 0.0)),
        # A partial whose text is not valid JSON yet.
        ({"type": "say", "say": "api_req_started", "text": '{"tokensIn": 1'}, None, (0, 0, 0, 0, 0.0)),
        # Valid JSON that is not an object.
        ({"type": "say", "say": "api_req_started", "text": "[1]"}, None, (0, 0, 0, 0, 0.0)),
        ({"type": "say", "say": "api_req_started", "text": 5}, None, (0, 0, 0, 0, 0.0)),
        # Not a request at all.
        ({"type": "say", "say": "text", "text": json.dumps(_REQ)}, None, (0, 0, 0, 0, 0.0)),
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
    assert (got.tokens_in, got.tokens_out, got.cache_reads, got.cache_writes, got.cost) == metrics


# --- the shared module ------------------------------------------------------


def test_iter_event_props_yields_only_json_objects():
    from src.services.telemetry_vocab import iter_event_props, parse_event_props

    payloads = ['{"a": 1}', "not json", "[1]", "3", None, "", '{"b": 2}']
    assert list(iter_event_props(payloads)) == [{"a": 1}, {}, {}, {"b": 2}]
    assert parse_event_props("[1]") is None
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
    assert metrics_service.iter_event_props is vocab.iter_event_props
    assert metrics_service.parse_event_props is vocab.parse_event_props
    assert metrics_service.completion_kind is vocab.completion_kind

    assert model_attribution.LLM_COMPLETION_EVENT is vocab.LLM_COMPLETION_EVENT
    assert model_attribution.TASK_KIND is vocab.TASK_KIND
    assert model_attribution.SIDE_CALL_LABELS is vocab.KIND_LABELS
    assert model_attribution.iter_event_props is vocab.iter_event_props
    assert model_attribution.api_req_started_payload is vocab.api_req_started_payload
    assert model_attribution.completion_kind is vocab.completion_kind

    assert task_summary.api_req_started_payload is vocab.api_req_started_payload
    assert telemetry_service.LLM_COMPLETION_EVENT is vocab.LLM_COMPLETION_EVENT

    # Retention protects every event the metrics page reads. Extend, never shrink.
    assert retention_service.PROTECTED_EVENT_TYPES[0] is vocab.LLM_COMPLETION_EVENT
    assert retention_service.PROTECTED_EVENT_TYPES[1] is vocab.EMBEDDING_EVENT
