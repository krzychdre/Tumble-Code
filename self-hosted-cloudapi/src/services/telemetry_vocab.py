"""The words the cloud API uses to read extension telemetry, defined once.

Event names, completion kinds and their labels, the decoding of an event's JSON
``properties`` and of a stored ``api_req_started`` message used to be written
out separately in ``metrics_service``, ``model_attribution``,
``retention_service`` and ``task_summary``. Copies drift (CB-7 was two ``_num``
copies that disagreed about ``bool``), so every reader imports them from here;
``tests/test_telemetry_vocab.py`` checks that by object identity.
``event_columns`` is the one rule for the figures ingest lifts out of an
event into columns, which the pages read instead of the JSON.

Keep the names and kinds in sync with ``packages/types/src/telemetry.ts``
(``TelemetryEventName`` and the ``CompletionKind`` enum).
"""

from __future__ import annotations

import json
import unicodedata
from typing import Optional

from src.utils.format import (
    MAX_REQUEST_COST,
    MAX_REQUEST_MS,
    MAX_REQUEST_TOKENS,
    figure,
)

# TelemetryEventName.LLM_COMPLETION: one per completed request, carrying tokens,
# cost, model, provider, mode and the task it belongs to.
LLM_COMPLETION_EVENT = "LLM Completion"

# TelemetryEventName.EMBEDDING_USAGE: tokens spent turning code into vectors.
# A separate event and a separate figure on the metrics page: indexing a
# repository is hundreds of thousands of input tokens with no output and no
# price, so adding it to the conversation total would bury what the
# conversation actually cost.
EMBEDDING_EVENT = "Embedding Usage"

# TelemetryEventName.TASK_MESSAGE and TASK_CONVERSATION_MESSAGE: copies of the
# conversation itself, not something that happened in the extension.
TASK_MESSAGE_EVENT = "Task Message"
CONVERSATION_MESSAGE_EVENT = "Conversation Message"

# TelemetryEventName.EXCEPTION: an Error the extension passed to
# captureException, with its name, message, a shortened stack and its own
# fields (provider, modelId, taskId, ...).
EXCEPTION_EVENT = "Exception"

# The events the diagnostics page counts as errors, with how each reads there.
ERROR_EVENT_LABELS: dict[str, str] = {
    EXCEPTION_EVENT: "Exception",
    "Code Index Error": "Code index",
    "Diff Application Error": "Diff not applied",
    "Consecutive Mistake Error": "Mistake limit reached",
    "Schema Validation Error": "Settings failed validation",
    "Shell Integration Error": "Shell integration unavailable",
    "Model Cache Empty Response": "Empty model list",
}

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


# The longest name stored, in UTF-8 bytes: far above any real model id (the
# longest live one has 41 characters, a Bedrock ARN about 90).
NAME_MAX_BYTES = 256


def clean_name(value) -> Optional[str]:
    """A client-sent name (model, provider, mode, kind, source) as stored, or
    None when there is none.

    Only a string is a name. Control, format and surrogate characters go (a
    NUL or a lone surrogate is text Postgres refuses, a bidi override would
    reorder a page), the ends are trimmed, and the rest is cut to
    ``NAME_MAX_BYTES`` on a character boundary.
    """
    if not isinstance(value, str):
        return None
    kept = "".join(
        ch for ch in value if unicodedata.category(ch) not in ("Cc", "Cf", "Cs")
    )
    return kept.encode()[:NAME_MAX_BYTES].decode(errors="ignore").strip() or None


def completion_kind(props: dict) -> str:
    """The kind of the completion an ``LLM Completion`` event records.

    Any name is taken as ``clean_name`` reads it (an unknown one still gets
    its own row, see ``KIND_LABELS``). A missing, null or empty kind, and one
    that is not a string at all (a number, a boolean, a list), is an ordinary
    conversation turn, ``TASK_KIND``: the extension only ever sends
    ``CompletionKind`` strings, and an event from before it reported the kind
    has none. The metrics page and the task detail page both read the kind
    stored through this function, so they count the same event the same way
    (owner decision 25).
    """
    return clean_name(props.get("completionKind")) or TASK_KIND


def event_columns(event_type: str, props: dict) -> dict:
    """The ``telemetry_events`` columns ingest lifts out of an event's properties.

    An ``LLM Completion`` gives its tokens, cost, request duration, model,
    provider, mode, kind and whether its usage was reported; an ``Embedding
    Usage`` its prompt tokens (in ``input_tokens``) and its source. Any other
    event gives none, and its columns stay NULL.

    A number is ``figure`` of the value (anything but a finite number within
    the bounds of one request is 0), stored whole: the extension counts tokens
    and milliseconds in integers. A name is ``clean_name`` of the value; a
    missing one is NULL, and each reader names that case its own way
    ("unknown" on the metrics page, ``UNKNOWN_MODEL`` in diagnostics, no
    attribution on the task page). ``usage_reported`` is False only when the
    client said so. Migration e8f9a0b1c2d3 applied a frozen copy of this rule
    to the events stored before it.
    """
    if event_type == LLM_COMPLETION_EVENT:
        return {
            "input_tokens": int(figure(props.get("inputTokens"), MAX_REQUEST_TOKENS)),
            "output_tokens": int(figure(props.get("outputTokens"), MAX_REQUEST_TOKENS)),
            "cache_read_tokens": int(
                figure(props.get("cacheReadTokens"), MAX_REQUEST_TOKENS)
            ),
            "cache_write_tokens": int(
                figure(props.get("cacheWriteTokens"), MAX_REQUEST_TOKENS)
            ),
            "cost": float(figure(props.get("cost"), MAX_REQUEST_COST)),
            "duration_ms": int(figure(props.get("durationMs"), MAX_REQUEST_MS)),
            "model_id": clean_name(props.get("modelId")),
            "provider": clean_name(props.get("apiProvider")),
            "mode": clean_name(props.get("mode")),
            "completion_kind": completion_kind(props),
            "usage_reported": props.get("usageReported") is not False,
        }
    if event_type == EMBEDDING_EVENT:
        return {
            "input_tokens": int(figure(props.get("promptTokens"), MAX_REQUEST_TOKENS)),
            "embedding_source": clean_name(props.get("source")),
        }
    return {}


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


def _reject_constant(name: str):
    """``json.loads`` hook for ``NaN``, ``Infinity`` and ``-Infinity``.

    They are not JSON: TypeScript's ``JSON.parse`` rejects the whole text, so
    the extension ignores such a request. Raising here makes Python do the
    same instead of handing a NaN to ``int()``, which raises.
    """
    raise ValueError(f"non-standard JSON constant {name}")


def api_req_started_payload(msg) -> Optional[dict]:
    """The decoded JSON of an ``api_req_started`` message, or None.

    None for anything that is not a request, for a request with no text yet,
    for a partial whose text is not (yet) a JSON object, and for a text using
    the non-standard constants ``NaN``/``Infinity`` (``JSON.parse`` rejects
    those too). The message ``type`` is not checked here: ``task_summary``
    requires ``"say"`` on top, ``model_attribution`` does not, and each keeps
    its own rule.
    """
    if not isinstance(msg, dict) or msg.get("say") != API_REQ_STARTED:
        return None
    text = msg.get("text")
    if not text:
        return None
    try:
        obj = json.loads(text, parse_constant=_reject_constant)
    except (ValueError, TypeError):  # JSONDecodeError is a ValueError
        return None
    return obj if isinstance(obj, dict) else None
