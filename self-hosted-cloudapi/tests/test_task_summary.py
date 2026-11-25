"""Unwrapping the first user turn for a task's title and excerpt.

The live bridge derives the title from every final message on the event loop,
so a message the client controls must unwrap in linear time.
"""

import importlib.util
import json
import time
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import select

from src.models.task import Task, TaskMessage
from src.models.user import User
from src.services.task_summary import derive_prompt, derive_title, strip_task_wrappers


@pytest.mark.parametrize(
    "text, query",
    [
        ("<task>\nFix the parser\n</task>", "Fix the parser"),
        (
            "<user_message>Add tests</user_message>\n<environment_details>mode: code</environment_details>",
            "Add tests",
        ),
        ("<feedback>No, smaller</feedback> trailing", "No, smaller"),
        ("Plain request", "Plain request"),
        # The first opener that is closed wins; its first closer ends it.
        ("<task>keep <task>this</task> only</task> tail", "keep <task>this"),
        ("<task>never closed <feedback>this one is</feedback>", "this one is"),
        ("<task>unclosed", "<task>unclosed"),
        ("ask <environment_details>open to the end", "ask"),
    ],
)
def test_strip_task_wrappers(text, query):
    assert strip_task_wrappers(text) == query


@pytest.mark.parametrize(
    "text",
    ["<task>" * 50_000, "<task>" * 50_000 + "</feedback>", "<feedback><task>" * 30_000],
    ids=["openers", "openers-and-another-closer", "mixed-openers"],
)
def test_openers_without_a_closer_unwrap_in_linear_time(text):
    """The old lazy regex took 2.7 s at 8 000 openers and grew with their square."""
    started = time.perf_counter()
    derive_title([{"type": "say", "say": "text", "text": text}])
    assert time.perf_counter() - started < 1.0


def _say(kind, text, ts=None):
    msg = {"type": "say", "say": kind, "text": text}
    return msg if ts is None else {**msg, "ts": ts}


@pytest.mark.parametrize(
    "prompt, title",
    [
        (
            "Make **one** service and keep `InvoiceBuilder`",
            "Make one service and keep InvoiceBuilder",
        ),
        ("# Refactor the *billing* module", "Refactor the billing module"),
        ("- [the docs](https://x.example/a) say __so__", "the docs say so"),
        ("![diagram](a.png) explain ~~it~~ this", "diagram explain it this"),
        ("> 1. quoted step   with   gaps", "quoted step with gaps"),
        # Underscores and stars inside words and arithmetic are text, not markup.
        (
            "rename snake_case_name and a * b * c",
            "rename snake_case_name and a * b * c",
        ),
        ("**unclosed bold", "**unclosed bold"),
    ],
)
def test_the_title_is_the_prompt_line_as_plain_text(prompt, title):
    assert derive_title([_say("text", prompt)]) == title


@pytest.mark.parametrize(
    "conversation",
    [
        # The opening prompt was lost; what comes first is not the request.
        [_say("api_req_retry_delayed", "423\nmodel locked: loading Qwen\n")],
        [
            _say("api_req_started", '{"tokensIn": 5}'),
            _say("reasoning", "The user asks"),
        ],
        [
            _say("api_req_started", '{"tokensIn": 5}'),
            _say("text", "Here is the answer"),
        ],
        [_say("api_req_started", '{"tokensIn": 5}'), _say("user_feedback", "red")],
        [
            {"type": "ask", "ask": "resume_completed_task"},
            _say("text", "Earlier answer"),
        ],
        [],
    ],
    ids=["retry-status", "reasoning", "answer", "feedback", "resume", "empty"],
)
def test_without_its_opening_prompt_a_task_has_no_title(conversation):
    assert derive_title(conversation) == "Untitled task"
    assert derive_prompt(conversation) == ""


def test_a_cli_prompt_is_the_title():
    conversation = [
        _say("text", "Ask me which color I prefer."),
        {"type": "ask", "ask": "followup", "text": '{"question": "Which color?"}'},
        _say("user_feedback", "red"),
    ]
    assert derive_title(conversation) == "Ask me which color I prefer."


@pytest.mark.parametrize(
    "line", ["**" * 50_000 + "a", "*a" * 30_000, "_x" * 30_000, "[a](" * 20_000]
)
def test_markup_without_closers_reads_in_linear_time(line):
    started = time.perf_counter()
    derive_title([_say("text", line)])
    assert time.perf_counter() - started < 1.0


async def test_the_title_migration_rederives_stored_titles(
    test_engine, session_factory
):
    """d7e8f9a0b1c3 gives every stored task the title the live rule gives it."""
    path = (
        Path(__file__).parents[1] / "alembic/versions/d7e8f9a0b1c3_plain_task_titles.py"
    )
    spec = importlib.util.spec_from_file_location("plain_task_titles", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    async with session_factory() as s:
        s.add(User(id="u", authentik_id="ak-u", email="u@example.com"))
        await s.flush()
        for task_id, title, first in [
            (
                "markdown",
                "**Fix** the `pager`",
                _say("text", "**Fix** the `pager`\nmore", 1),
            ),
            ("retry", "423", _say("api_req_retry_delayed", "423\nlocked\n", 1)),
            ("clean", "Already plain", _say("text", "Already plain", 1)),
            ("empty", None, None),
        ]:
            s.add(Task(id=task_id, user_id="u", title=title, prompt_excerpt=title))
            if first:
                s.add(
                    TaskMessage(
                        task_id=task_id, message_ts=1, message_data=json.dumps(first)
                    )
                )
                later = _say("text", "a later answer", 2)
                s.add(
                    TaskMessage(
                        task_id=task_id, message_ts=2, message_data=json.dumps(later)
                    )
                )
        await s.commit()

    def upgrade(sync_conn):
        with Operations.context(MigrationContext.configure(sync_conn)):
            migration.upgrade()

    async with test_engine.begin() as conn:
        await conn.run_sync(upgrade)

    async with session_factory() as s:
        rows = {
            t.id: (t.title, t.prompt_excerpt) for t in await s.scalars(select(Task))
        }
    assert rows == {
        "markdown": ("Fix the pager", "**Fix** the `pager`\nmore"),
        "retry": (None, None),
        "clean": ("Already plain", "Already plain"),
        "empty": (None, None),
    }
