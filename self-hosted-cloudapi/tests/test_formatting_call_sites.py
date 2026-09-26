"""What the web panel prints for numbers, pinned at every place that formats one.

Costs, thousands separators, byte sizes and "n things" plurals used to be
formatted inline wherever they were needed (``routers/web.py`` and the
templates). These tests pin the exact strings each call site produced before
the formatting moved into ``src/utils/format.py``, so the move can be checked
to change nothing a user reads.
"""

from src.auth.web_session import get_web_user_optional
from src.models.task import Task
from src.routers import web
from src.services.task_tree import Spend
from src.utils import format as fmt

from tests.test_side_call_metrics import _embedding_event
from tests.web_helpers import (
    _add_message,
    _llm_event,
    _override_web_user,
    _seed_user,
    _summarize,
)


def _task(task_id="t", **figures) -> Task:
    return Task(id=task_id, user_id="u", title=task_id, **figures)


# --- routers/web.py helpers and the ones that moved out of it --------------------------------------------------


def test_plural_counts_one_and_many():
    assert fmt.plural(0, "subtask") == "0 subtasks"
    assert fmt.plural(1, "subtask") == "1 subtask"
    assert fmt.plural(2, "subtask") == "2 subtasks"
    # No thousands separator: a plural is a count in a sentence.
    assert fmt.plural(1500, "subtask") == "1500 subtasks"


def test_byte_sizes_step_through_the_units():
    assert fmt.fmt_bytes(0) == "0 B"
    assert fmt.fmt_bytes(1023) == "1023 B"
    assert fmt.fmt_bytes(1024) == "1.0 KB"
    assert fmt.fmt_bytes(1536) == "1.5 KB"
    assert fmt.fmt_bytes(5 * 1024 * 1024) == "5.0 MB"
    assert fmt.fmt_bytes(3 * 1024**3) == "3.0 GB"
    # GB is the last unit, however large the figure.
    assert fmt.fmt_bytes(2048 * 1024**3) == "2048.0 GB"


def test_a_spend_row_formats_tokens_compactly_and_cost_to_four_places():
    row = web._spend_row(
        "own", "this task", Spend(cost=0.1656, tokens_in=297_800, tokens_out=5_900)
    )
    assert row == {
        "key": "own",
        "label": "this task",
        "tokens": "303.7k",
        "tokens_in": "297.8k",
        "tokens_out": "5.9k",
        "cost": "$0.1656",
    }
    assert web._spend_row("own", "x", Spend())["cost"] == "$0.0000"


def test_the_metrics_tooltip_separates_thousands_and_prints_cost():
    task = _task(tokens_in=1_234_567, tokens_out=3_365, cache_writes=12_000, cache_reads=1_000, cost=1.5)
    assert web._metrics_tooltip(task) == [
        "↑ In: 1,234,567",
        "↓ Out: 3,365",
        "⚡ Cache: 12,000 write / 1,000 read",
        "$ Cost: $1.5000",
    ]


def test_the_run_tooltip_names_its_subtasks():
    total = Spend(cost=0.00005, tokens_in=10_000, tokens_out=999)
    assert web._run_tooltip(total, 1) == [
        "Σ With its 1 subtask",
        "↑ In: 10,000",
        "↓ Out: 999",
        "$ Cost: $0.0001",
    ]


def test_a_run_row_splits_its_sum_into_this_task_and_its_subtasks():
    parent = _task("p", tokens_in=100_000, tokens_out=2_000, cost=0.1656)
    kids = [
        _task("c1", tokens_in=1_000_000, tokens_out=40_000, cost=1.194),
        _task("c2", tokens_in=50_000, tokens_out=1_234, cost=0.0493),
    ]
    fields = web._spend_fields(parent, {"p": kids})
    assert fields["tokens"] == "1.2M"
    assert fields["cost"] == "$1.4089"
    assert fields["tokens_title"] == (
        "1,193,234 tokens for the run: 102,000 this task + 1,091,234 in 2 subtasks"
    )
    assert fields["cost_title"] == (
        "$1.4089 for the run: $0.1656 this task + $1.2433 in 2 subtasks"
    )


def test_a_task_without_figures_shows_no_cost_cell():
    fields = web._spend_fields(_task("p"), {})
    assert fields["tokens"] is None
    assert fields["cost"] is None


def test_the_quality_panel_formats_its_efficiency_figures():
    task = _task(tokens_in=1_234_567, cache_reads=617_283, cost=0.5, q_requests=4)
    efficiency = {e["label"]: e["value"] for e in web._quality_panel(task)["efficiency"]}
    assert efficiency == {
        "Tokens / turn": "308,642",
        "From cache": "50%",
        "Cost / turn": "$0.1250",
    }
    empty = {e["label"]: e["value"] for e in web._quality_panel(_task())["efficiency"]}
    assert empty == {"Tokens / turn": "\u2014", "From cache": "\u2014", "Cost / turn": "\u2014"}


def test_the_retention_preview_states_its_size():
    class Plan:
        task_count = 1
        message_count = 2
        event_count = 3
        exempt_shared = 0
        total_bytes = 3 * 1024 * 1024 + 512 * 1024
        is_empty = False
        reasons = {}

    assert web._plan_view(Plan())["size"] == "3.5 MB"


# --- rendered pages ----------------------------------------------------------


async def test_the_metrics_page_prints_its_figures(client, db_session, session_factory):
    await _seed_user(db_session)
    async with session_factory() as s:
        s.add(
            _llm_event(
                model="big", task_id="t1", tin=1_234_567, tout=3_365, cread=1_500, cwrite=20_000, cost=0.1234
            )
        )
        s.add(_llm_event(model="small", task_id="t1", tin=500, tout=10, cost=0.03125, kind="condense"))
        s.add(_embedding_event(prompt_tokens=2_000))
        s.add(_embedding_event(prompt_tokens=3_000))
        await s.commit()

    _override_web_user(client.app)
    try:
        body = client.get("/app/metrics?period=all").text
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    assert "↑ 1,235,067 in · ↓ 3,375 out" in body
    assert '<div class="stat-value">21,500</div>' in body
    assert "20,000 write · 1,500 read" in body
    # 0.1234 + 0.03125 is 0.15465000000000001 as a float, so it rounds up.
    assert '<div class="stat-value">$0.1547</div>' in body
    assert "2 API completions" in body
    assert "1 task<" in body
    assert "2 embedding calls" in body
    # The "where the tokens went" panel and the breakdown tables.
    assert '<span class="kind-num cell-cost">$0.1234</span>' in body
    # $0.03125 is a true tie: it rounds up now, as the browser's toFixed does
    # (it printed "$0.0312" while Python's "%.4f" formatted it).
    assert '<span class="kind-num cell-cost">$0.0313</span>' in body
    assert '<td class="bd-num">$0.1234</td>' in body
    assert '<td class="bd-num">$0.0313</td>' in body
    # The charts format through static/format.js, so it loads first.
    assert body.index("/static/format.js") < body.index("/static/metrics.js")


async def test_the_metrics_page_says_one_in_the_singular(client, db_session, session_factory):
    await _seed_user(db_session)
    async with session_factory() as s:
        s.add(_llm_event(task_id="t1", tin=10, tout=1, cost=0.0))
        s.add(_embedding_event(prompt_tokens=5))
        await s.commit()

    _override_web_user(client.app)
    try:
        body = client.get("/app/metrics?period=all").text
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    assert "1 API completion<" in body
    assert "1 embedding call" in body and "1 embedding calls" not in body
    assert '<div class="stat-value">$0.0000</div>' in body


async def test_the_task_page_prints_the_side_call_cost(client, db_session, session_factory):
    async with session_factory() as s:
        await _seed_user(s)
        s.add(Task(id="task-f", user_id="user_test", title="Run"))
        await s.flush()
        await _add_message(
            s,
            "task-f",
            {
                "ts": 1,
                "type": "say",
                "say": "api_req_started",
                "text": '{"tokensIn": 297800, "tokensOut": 5900, "cost": 0.1656}',
            },
        )
        s.add(_llm_event(task_id="task-f", model="m", tin=297_800, tout=5_900))
        s.add(_llm_event(task_id="task-f", model="bg", tin=40_000, tout=800, cost=0.4321, kind="condense"))
        await _summarize(s, "task-f")
        await s.commit()

    _override_web_user(client.app)
    try:
        body = client.get("/app/tasks/task-f").text
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    assert "Condensing <b>1</b> · 40.8k tok · $0.4321" in body
    # The spend table the live header later keeps current.
    assert '<td id="hdr-own-tokens">303.7k</td>' in body
    assert '<td id="hdr-own-cost" class="spend-cost">$0.1656</td>' in body
    # render.js and live.js format through static/format.js, so it loads first.
    assert body.index("/static/format.js") < body.index("/static/render.js")
