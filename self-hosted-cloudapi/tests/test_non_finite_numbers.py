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
    }


def test_message_metrics_does_not_raise_on_an_out_of_range_number():
    # 1e999 is valid JSON (JSON.parse gives Infinity); json.loads gives inf.
    m = message_metrics(_req('{"tokensIn":1e999,"tokensOut":10,"cost":-1e999}'))
    assert (m.tokens_in, m.tokens_out, m.cost) == (0, 10, 0.0)


@pytest.mark.parametrize("value", [math.nan, math.inf, -math.inf])
def test_num_reads_a_non_finite_float_as_zero(value):
    assert num(value) == 0


def test_task_detail_attribution_does_not_raise_on_non_finite_figures():
    from src.services import model_attribution

    assert model_attribution._request_tokens(_req('{"tokensIn":1e999,"tokensOut":1}')) == (0, 1)
    # Event properties are decoded with json.loads too, which accepts NaN.
    props = json.loads('{"modelId":"m","inputTokens":NaN,"outputTokens":Infinity,"cost":NaN}')
    completion = model_attribution.completion_from_properties(props)
    assert completion is not None
    assert (completion.input_tokens, completion.output_tokens, completion.cost) == (0, 0, 0.0)


async def test_backfill_imports_a_conversation_with_a_nan_request(client, db_session, session_factory):
    """The NaN request contributes nothing; every message, it included, is stored."""
    from src.dependencies import get_current_user
    from src.main import app
    from tests.test_web_and_share import _backfill_files, _override_current_user, _seed_user

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
            await s.execute(select(func.count(TaskMessage.id)).where(TaskMessage.task_id == "task-nan"))
        ).scalar_one()
        assert count == 4
        task = (await s.execute(select(Task).where(Task.id == "task-nan"))).scalar_one()
        assert (task.tokens_in, task.tokens_out) == (100, 10)
        assert task.cost == pytest.approx(0.001)
