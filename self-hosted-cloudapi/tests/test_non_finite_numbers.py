"""NaN and Infinity in token and cost figures (found by CAPI-M8).

Python's ``json.loads`` accepts the non-standard constants ``NaN``,
``Infinity`` and ``-Infinity`` (and turns an out-of-range literal such as
``1e999`` into ``inf``); TypeScript's ``JSON.parse`` rejects the constants, so
the extension ignores such a request. Here the float used to reach ``int()``,
which raises on NaN and infinity, so one such ``api_req_started`` message made
``message_metrics`` throw and failed the whole backfill of the conversation.

The rule now: an ``api_req_started`` text with a non-standard constant is
treated like malformed JSON (ignored, as TypeScript does), and ``num`` reads a
non-finite float as 0 like any other non-number, so no coercion on the way to
an integer column can raise.
"""

import json
import math

import pytest
from sqlalchemy import func, select

from src.models.task import Task, TaskMessage
from src.services.task_summary import message_metrics
from src.utils.format import num

NON_FINITE_TEXTS = [
    pytest.param('{"tokensIn":NaN,"tokensOut":10}', id="NaN"),
    pytest.param('{"tokensIn":Infinity,"tokensOut":10}', id="Infinity"),
    pytest.param('{"tokensIn":-Infinity,"tokensOut":10}', id="-Infinity"),
    pytest.param('{"tokensIn":100,"tokensOut":10,"cost":NaN}', id="NaN-cost"),
]


def _req(text: str, ts: int = 1) -> dict:
    return {"ts": ts, "type": "say", "say": "api_req_started", "text": text}


@pytest.mark.parametrize("text", NON_FINITE_TEXTS)
def test_api_req_started_payload_ignores_non_standard_constants(text):
    from src.services.telemetry_vocab import api_req_started_payload

    assert api_req_started_payload(_req(text)) is None


@pytest.mark.parametrize("text", NON_FINITE_TEXTS)
def test_message_metrics_reads_a_non_standard_constant_as_no_figures(text):
    assert message_metrics(_req(text)).as_columns() == {
        "tokens_in": 0,
        "tokens_out": 0,
        "cache_reads": 0,
        "cache_writes": 0,
        "cost": 0.0,
        "duration_ms": 0,
    }


def test_message_metrics_does_not_raise_on_an_out_of_range_number():
    # 1e999 is valid JSON (JSON.parse gives Infinity); json.loads gives inf.
    m = message_metrics(_req('{"tokensIn":1e999,"tokensOut":10,"cost":-1e999}'))
    assert (m.tokens_in, m.tokens_out, m.cost) == (0, 10, 0.0)


def test_message_metrics_reads_a_figure_beyond_one_request_as_no_figure():
    """The client writes the message, and its own server can report any
    usage: a figure outside the bounds of one request (utils/format.figure)
    counts as none, so a run's totals cannot overflow or go negative. The
    bounds themselves are kept."""
    figures = {
        "tokensIn": 9 * 10**18,
        "tokensOut": -5,
        "cacheReads": 10**9,
        "cacheWrites": 10**9 + 1,
        "cost": 1e300,
        "durationMs": 24 * 3600 * 1000,
    }
    assert message_metrics(_req(json.dumps(figures))).as_columns() == {
        "tokens_in": 0,
        "tokens_out": 0,
        "cache_reads": 10**9,
        "cache_writes": 0,
        "cost": 0.0,
        "duration_ms": 24 * 3600 * 1000,
    }
    condense = {
        "type": "say",
        "say": "condense_context",
        "contextCondense": {"cost": -1.0, "durationMs": 10**20},
    }
    assert message_metrics(condense) == message_metrics({})


@pytest.mark.parametrize("value", [math.nan, math.inf, -math.inf])
def test_num_reads_a_non_finite_float_as_zero(value):
    assert num(value) == 0


def test_task_detail_attribution_does_not_raise_on_non_finite_figures():
    from src.services import model_attribution
    from src.services.telemetry_vocab import LLM_COMPLETION_EVENT, event_columns

    assert model_attribution._request_tokens(
        _req('{"tokensIn":1e999,"tokensOut":1}')
    ) == (0, 1)
    # Event properties arrive decoded by json.loads too, which accepts NaN;
    # ingest stores such a figure as 0.
    props = json.loads(
        '{"modelId":"m","inputTokens":NaN,"outputTokens":Infinity,"cost":NaN}'
    )
    columns = event_columns(LLM_COMPLETION_EVENT, props)
    assert (columns["input_tokens"], columns["output_tokens"], columns["cost"]) == (
        0,
        0,
        0.0,
    )


async def test_backfill_imports_a_conversation_with_a_nan_request(
    client, db_session, session_factory
):
    """The NaN request contributes nothing; every message, it included, is stored."""
    from src.dependencies import get_current_user
    from src.main import app
    from tests.web_helpers import _backfill_files, _override_current_user, _seed_user

    messages = [
        {"ts": 1, "type": "say", "say": "text", "text": "Build me a feature"},
        _req('{"tokensIn":100,"tokensOut":10,"cost":0.001}', ts=2),
        _req('{"tokensIn":NaN,"tokensOut":Infinity,"cost":NaN}', ts=3),
        {"ts": 4, "type": "say", "say": "completion_result", "text": "Done"},
    ]
    await _seed_user(db_session)
    _override_current_user(app)
    files, data = _backfill_files("task-nan", messages)
    try:
        resp = client.post("/api/events/backfill", files=files, data=data)
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert resp.status_code == 200, resp.text
    async with session_factory() as s:
        count = (
            await s.execute(
                select(func.count(TaskMessage.id)).where(
                    TaskMessage.task_id == "task-nan"
                )
            )
        ).scalar_one()
        assert count == 4
        task = (await s.execute(select(Task).where(Task.id == "task-nan"))).scalar_one()
        assert (task.tokens_in, task.tokens_out) == (100, 10)
        assert task.cost == pytest.approx(0.001)
