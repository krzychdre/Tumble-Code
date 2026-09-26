"""Direct unit tests for the web panel's presenter helpers.

``_list_row``, ``_spend_summary``, ``_row_tooltip`` and ``_quality_overview``
were asserted only through rendered HTML, which pins a few strings of their
output and none of its shape. These tests call them directly and pin the whole
view-model each one hands the templates, so moving them out of
``routers/web.py`` (CAPI-M5) can be checked to change nothing.

The figures are the ADO run the helpers' docstrings describe: a $0.1656 parent
whose subtasks cost $1.2434 more.
"""

from datetime import datetime, timedelta, timezone

from src.models.task import Task
from src.routers import web
from src.services.task_tree import Spend

from tests.web_helpers import _seed_user

UPDATED = datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc)

# What a stored row carries when a figure was never written: the columns are
# NOT NULL with a zero default, so an unsaved Task gets the same zeros here.
_ZEROS = {
    "message_count": 0,
    "tokens_in": 0,
    "tokens_out": 0,
    "cache_reads": 0,
    "cache_writes": 0,
    "cost": 0.0,
}


def _task(task_id: str, parent: str | None = None, **fields) -> Task:
    return Task(
        id=task_id,
        user_id="u",
        title=fields.pop("title", task_id),
        parent_task_id=parent,
        updated_at=UPDATED,
        **{**_ZEROS, **fields},
    )


def _ado_run() -> tuple[Task, dict[str, list[Task]]]:
    """A run with two subtasks, one of which delegated further."""
    root = _task(
        "root",
        tokens_in=297_800,
        tokens_out=5_900,
        cost=0.1656,
        cache_reads=100_000,
        cache_writes=2_000,
        first_ts=1_000,
        last_ts=61_000,
        message_count=12,
        workspace_path="/home/me/Roo-Code/",
        models="glm-5.3, qwen3, llama",
        prompt_excerpt="Fix the bug\n\n- step one",
        q_requests=4,
        q_completed=True,
    )
    a = _task("a", "root", tokens_in=1000, tokens_out=500, cost=1.194, q_completed=True, q_errors=1)
    b = _task("b", "root", tokens_in=10, tokens_out=5, cost=0.0493)
    c = _task("c", "a", tokens_in=1, tokens_out=1, cost=0.0001)
    return root, {"root": [a, b], "a": [c]}


_ROOT_HOVER = (
    "Fix the bug\n\n- step one\n\n"
    "This task\n↑ In: 297,800\n↓ Out: 5,900\n⚡ Cache: 2,000 write / 100,000 read\n"
    "⏱ Session: 1m 0s\n$ Cost: $0.1656\n\n"
    "Σ With its 3 subtasks\n↑ In: 298,811\n↓ Out: 6,406\n"
    "⚡ Cache: 2,000 write / 100,000 read\n$ Cost: $1.4090"
)


def _leaf_row(task_id: str, tokens: str, cost: str, hover: str) -> dict:
    return {
        "id": task_id,
        "title": task_id,
        "message_count": 0,
        "updated_at": UPDATED,
        "duration": None,
        "tokens": tokens,
        "cost": cost,
        "rollup": False,
        "tokens_title": None,
        "cost_title": None,
        "hover_title": hover,
        "workspace": None,
        "workspace_label": None,
        "models": None,
        "child_count": 0,
        "descendant_count": 0,
        "is_subtask": True,
        "children": [],
        "grade": "unfinished",
        "grade_label": "Unfinished",
        "grade_title": "no result was reached",
    }


# --- _list_row ------------------------------------------------------------------------------------------------


def test_list_row_nests_the_whole_tree_and_sums_the_run():
    root, tree = _ado_run()
    row = web._list_row(root, tree, True)

    c_row = _leaf_row("c", "2", "$0.0001", "↑ In: 1\n↓ Out: 1\n$ Cost: $0.0001")
    b_row = _leaf_row("b", "15", "$0.0493", "↑ In: 10\n↓ Out: 5\n$ Cost: $0.0493")
    a_row = {
        **_leaf_row("a", "1.5k", "$1.1941", None),
        "rollup": True,
        "tokens_title": "1,502 tokens for the run: 1,500 this task + 2 in 1 subtask",
        "cost_title": "$1.1941 for the run: $1.1940 this task + $0.0001 in 1 subtask",
        "hover_title": (
            "This task\n↑ In: 1,000\n↓ Out: 500\n$ Cost: $1.1940\n\n"
            "Σ With its 1 subtask\n↑ In: 1,001\n↓ Out: 501\n$ Cost: $1.1941"
        ),
        "child_count": 1,
        "descendant_count": 1,
        "children": [c_row],
        "grade": "friction",
        "grade_label": "Friction",
        "grade_title": "1 error",
    }
    assert row == {
        "id": "root",
        "title": "root",
        "message_count": 12,
        "updated_at": UPDATED,
        "duration": "1m 0s",
        "tokens": "305.2k",
        "cost": "$1.4090",
        "rollup": True,
        "tokens_title": "305,217 tokens for the run: 303,700 this task + 1,517 in 3 subtasks",
        "cost_title": "$1.4090 for the run: $0.1656 this task + $1.2434 in 3 subtasks",
        "hover_title": _ROOT_HOVER,
        "workspace": "/home/me/Roo-Code/",
        "workspace_label": "Roo-Code",
        "models": {"count": 3, "more": "+2", "name": "glm-5.3", "title": "glm-5.3, qwen3, llama"},
        # Direct children for the pill, the whole subtree for the bulk delete.
        "child_count": 2,
        "descendant_count": 3,
        "is_subtask": False,
        "children": [a_row, b_row],
        "grade": "clean",
        "grade_label": "Clean",
        "grade_title": "nothing went wrong",
    }


def test_list_row_flat_view_does_not_nest_but_still_sums_the_run():
    root, tree = _ado_run()
    flat = web._list_row(root, tree, False)
    nested = web._list_row(root, tree, True)

    assert flat["children"] == []
    assert {k: v for k, v in flat.items() if k != "children"} == {
        k: v for k, v in nested.items() if k != "children"
    }


def test_list_row_for_a_task_with_nothing_recorded():
    row = web._list_row(_task("bare"), {}, True)

    assert row == {
        "id": "bare",
        "title": "bare",
        "message_count": 0,
        "updated_at": UPDATED,
        "duration": None,
        "tokens": None,
        "cost": None,
        "rollup": False,
        "tokens_title": None,
        "cost_title": None,
        "hover_title": None,
        "workspace": None,
        "workspace_label": None,
        "models": None,
        "child_count": 0,
        "descendant_count": 0,
        "is_subtask": False,
        "children": [],
        "grade": "unfinished",
        "grade_label": "Unfinished",
        "grade_title": "no result was reached",
    }


def test_list_row_falls_back_to_the_default_title():
    row = web._list_row(_task("untitled", title=None), {}, True)
    assert row["title"] == "Untitled task"


# --- _spend_summary -------------------------------------------------------------------------------------------


def test_spend_summary_of_a_run_states_the_run_then_its_parts():
    root, tree = _ado_run()
    summary = web._spend_summary(root, tree)

    assert summary["rows"] == [
        {
            "key": "run",
            "label": "whole run",
            "tokens": "305.2k",
            "tokens_in": "298.8k",
            "tokens_out": "6.4k",
            "cost": "$1.4090",
        },
        {
            "key": "own",
            "label": "this task",
            "tokens": "303.7k",
            "tokens_in": "297.8k",
            "tokens_out": "5.9k",
            "cost": "$0.1656",
        },
        {
            "key": "subtasks",
            "label": "3 subtasks",
            "tokens": "1.5k",
            "tokens_in": "1k",
            "tokens_out": "506",
            "cost": "$1.2434",
        },
    ]
    # What the live header adds to this task's live figures.
    rest = summary["subtasks"]
    assert isinstance(rest, Spend)
    assert (rest.tokens_in, rest.tokens_out) == (1011, 506)
    assert round(rest.cost, 4) == 1.2434


def test_spend_summary_of_a_task_without_subtasks_is_one_row():
    root, _tree = _ado_run()

    assert web._spend_summary(root, {}) == {
        "rows": [
            {
                "key": "own",
                "label": "this task",
                "tokens": "303.7k",
                "tokens_in": "297.8k",
                "tokens_out": "5.9k",
                "cost": "$0.1656",
            }
        ],
        "subtasks": None,
    }


# --- _row_tooltip ---------------------------------------------------------------------------------------------


def test_row_tooltip_is_none_when_there_is_nothing_to_say():
    assert web._row_tooltip(_task("empty")) is None


def test_row_tooltip_with_only_a_prompt():
    assert web._row_tooltip(_task("p", prompt_excerpt="Only a prompt")) == "Only a prompt"


def test_row_tooltip_with_only_figures_has_no_heading():
    task = _task("f", tokens_in=1500, tokens_out=20, cost=0.5)
    assert web._row_tooltip(task) == "↑ In: 1,500\n↓ Out: 20\n$ Cost: $0.5000"


def test_row_tooltip_with_a_run_heads_the_own_figures_and_adds_the_run():
    root, _tree = _ado_run()
    total = Spend(cost=1.4090, tokens_in=299_000, tokens_out=6_400, cache_reads=100_000, cache_writes=2_000)

    assert web._row_tooltip(root, total, 3) == (
        "Fix the bug\n\n- step one\n\n"
        "This task\n↑ In: 297,800\n↓ Out: 5,900\n⚡ Cache: 2,000 write / 100,000 read\n"
        "⏱ Session: 1m 0s\n$ Cost: $0.1656\n\n"
        "Σ With its 3 subtasks\n↑ In: 299,000\n↓ Out: 6,400\n"
        "⚡ Cache: 2,000 write / 100,000 read\n$ Cost: $1.4090"
    )


def test_row_tooltip_skips_an_empty_run_block_but_keeps_the_heading():
    # A Spend is always truthy, so the heading follows ``total`` being given,
    # while the run block needs a figure to report.
    assert web._row_tooltip(_task("g", cost=0.25), Spend(), 1) == (
        "This task\n↑ In: 0\n↓ Out: 0\n$ Cost: $0.2500"
    )


def test_row_tooltip_wraps_and_caps_a_long_prompt():
    text = web._row_tooltip(_task("long", prompt_excerpt="word " * 400))
    lines = text.split("\n")

    assert len(lines) == web._PROMPT_WRAP_LINES
    assert all(len(line) <= web._PROMPT_WRAP_COLS for line in lines)
    assert lines[0] == " ".join(["word"] * 15)
    assert lines[-1] == " ".join(["word"] * 15) + "…"


# --- _quality_overview ----------------------------------------------------------------------------------------


def _graded(task_id: str, *, user_id="user_test", parent=None, age_days=1, **quality) -> Task:
    return Task(
        id=task_id,
        user_id=user_id,
        title=quality.pop("title", task_id.upper()),
        parent_task_id=parent,
        updated_at=datetime.now(timezone.utc) - timedelta(days=age_days),
        **quality,
    )


async def test_quality_overview_without_tasks_has_no_data(db_session):
    await _seed_user(db_session)
    assert await web._quality_overview(db_session, "user_test", "all") == {"has_data": False}


async def test_quality_overview_grades_runs_in_the_period(db_session):
    await _seed_user(db_session)
    await _seed_user(db_session, "user_other", "o@example.com")
    db_session.add_all(
        [
            _graded("clean", q_completed=True, q_requests=3, q_completion_replies=1),
            _graded("rough", q_completed=True, q_requests=5, q_errors=2, q_retries=1, q_interventions=1),
            _graded("stuck", title=None, q_requests=2, q_condense=1, q_tool_paths=4, q_distinct_tool_paths=2),
            _graded("unfinished-quiet", q_requests=1, title=None),
            # A subtask of "rough": graded with its run, never on its own.
            _graded("sub", parent="rough", q_errors=9, q_completed=True),
            # Somebody else's run.
            _graded("theirs", user_id="user_other", q_errors=4, q_completed=True),
            # Outside a 7-day period, inside "all".
            _graded("old", age_days=30, q_completed=True, q_interventions=6),
        ]
    )
    await db_session.commit()

    week = await web._quality_overview(db_session, "user_test", "7d")
    assert week == {
        "has_data": True,
        "total": 4,
        "grades": [
            {"key": "clean", "label": "Clean", "count": 1, "share": 25},
            {"key": "friction", "label": "Friction", "count": 1, "share": 25},
            {"key": "unfinished", "label": "Unfinished", "count": 2, "share": 50},
        ],
        "totals": {
            "interventions": 1,
            "completion_replies": 1,
            "errors": 2,
            "retries": 1,
            "condense": 1,
            "repeated_work": 2,
            "requests": 11,
        },
        "roughest": [
            {
                "id": "rough",
                "title": "ROUGH",
                "friction": 4,
                "reasons": "1 correction from you; 2 errors; 1 provider retry",
            },
            {
                "id": "stuck",
                "title": "Untitled task",
                "friction": 3,
                "reasons": "no result was reached; context condensed 1 time; 2 repeated tool calls",
            },
        ],
    }

    everything = await web._quality_overview(db_session, "user_test", "all")
    assert everything["total"] == 5
    assert [r["id"] for r in everything["roughest"]] == ["old", "rough", "stuck"]


async def test_quality_overview_lists_at_most_eight_roughest_runs(db_session):
    await _seed_user(db_session)
    db_session.add_all(
        [_graded(f"r{n:02d}", q_completed=True, q_errors=n) for n in range(1, 11)]
    )
    await db_session.commit()

    overview = await web._quality_overview(db_session, "user_test", "all")

    assert overview["total"] == 10
    assert [r["friction"] for r in overview["roughest"]] == [10, 9, 8, 7, 6, 5, 4, 3]
    assert overview["grades"][1] == {"key": "friction", "label": "Friction", "count": 10, "share": 100}


# --- the old import path ---------------------------------------------------------------------------------------


def test_the_old_import_path_re_exports_the_moved_helpers():
    from src.services import quality_overview
    from src.web import templating
    from src.web.presenters import settings as settings_presenter
    from src.web.presenters import task_detail, task_rows

    assert web._list_row is task_rows._list_row
    assert web._row_tooltip is task_rows._row_tooltip
    assert web._wrap_prompt is task_rows._wrap_prompt
    assert web._spend_summary is task_detail._spend_summary
    assert web._quality_panel is task_detail._quality_panel
    assert web._load_task_messages is task_detail._load_task_messages
    assert web._plan_view is settings_presenter._plan_view
    assert web._quality_overview is quality_overview.quality_overview
    assert web.templates is templating.templates
