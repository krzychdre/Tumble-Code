"""Unwrapping the first user turn for a task's title and excerpt.

The live bridge derives the title from every final message on the event loop,
so a message the client controls must unwrap in linear time.
"""

import time

import pytest

from src.services.task_summary import derive_title, strip_task_wrappers


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
