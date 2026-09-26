"""The words the cloud API uses to read extension telemetry, defined once.

Event names, completion kinds and their labels, the decoding of an event's JSON
``properties`` and of a stored ``api_req_started`` message used to be written
out separately in ``metrics_service``, ``model_attribution``,
``retention_service`` and ``task_summary``. Copies drift (CB-7 was two ``_num``
copies that disagreed about ``bool``), so every reader imports them from here;
``tests/test_telemetry_vocab.py`` checks that by object identity.

Keep the names and kinds in sync with ``packages/types/src/telemetry.ts``
(``TelemetryEventName`` and the ``CompletionKind`` enum).
"""

from __future__ import annotations

import json
from typing import Iterable, Iterator, Optional

# TelemetryEventName.LLM_COMPLETION: one per completed request, carrying tokens,
# cost, model, provider, mode and the task it belongs to.
LLM_COMPLETION_EVENT = "LLM Completion"

# TelemetryEventName.EMBEDDING_USAGE: tokens spent turning code into vectors.
# A separate event and a separate figure on the metrics page: indexing a
# repository is hundreds of thousands of input tokens with no output and no
# price, so adding it to the conversation total would bury what the
# conversation actually cost.
EMBEDDING_EVENT = "Embedding Usage"

# Which part of the extension made a completion. Only ``task`` calls are turns
# of the conversation; the rest is the machinery around it (summarising the
# history, rewriting a prompt, ranking memories). Rows written before the
# extension started reporting the kind carry none, and every one of them is a
# task turn.
TASK_KIND = "task"

# How each kind reads on a page. A kind that is not listed falls back to its raw
# name at the call site rather than being dropped, so a new kind shows up as an
# unexplained row instead of silently vanishing from the totals.
KIND_LABELS: dict[str, str] = {
    TASK_KIND: "Conversation",
    "condense": "Condensing",
    "enhance": "Prompt enhancement",
    "memory": "Memory recall",
}

def completion_kind(props: dict) -> str:
    """The kind of the completion an ``LLM Completion`` event records.

    Any non-empty string is taken as is (an unknown one still gets its own row,
    see ``KIND_LABELS``). A missing, null or empty kind, and one that is not a
    string at all (a number, a boolean, a list), is an ordinary conversation
    turn, ``TASK_KIND``: the extension only ever sends ``CompletionKind``
    strings, and an event from before it reported the kind has none. The
    metrics page and the task detail page both read the kind through this
    function, so they count the same event the same way (owner decision 25).
    """
    kind = props.get("completionKind")
    return kind if isinstance(kind, str) and kind else TASK_KIND


# The ``say`` of the stored message that records one API request.
API_REQ_STARTED = "api_req_started"


def parse_event_props(payload) -> Optional[dict]:
    """Decode a ``telemetry_events.properties`` payload, or None if unusable.

    The column is TEXT holding JSON. A missing or empty payload reads as ``{}``
    (an event with no properties is still an event); anything that does not
    decode to a JSON object is None, and the caller skips it.
    """
    try:
        props = json.loads(payload or "{}")
    except (json.JSONDecodeError, TypeError):
        return None
    return props if isinstance(props, dict) else None


def iter_event_props(payloads: Iterable) -> Iterator[dict]:
    """The decodable property dicts among ``payloads``, in order."""
    for payload in payloads:
        props = parse_event_props(payload)
        if props is not None:
            yield props


def api_req_started_payload(msg) -> Optional[dict]:
    """The decoded JSON of an ``api_req_started`` message, or None.

    None for anything that is not a request, for a request with no text yet,
    and for a partial whose text is not (yet) a JSON object. The message
    ``type`` is not checked here: ``task_summary`` requires ``"say"`` on top,
    ``model_attribution`` does not, and each keeps its own rule.
    """
    if not isinstance(msg, dict) or msg.get("say") != API_REQ_STARTED:
        return None
    text = msg.get("text")
    if not text:
        return None
    try:
        obj = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return None
    return obj if isinstance(obj, dict) else None
