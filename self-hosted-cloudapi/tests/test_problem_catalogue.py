"""The problem catalogue: signatures, and one real example per rule.

The examples are the extension's own texts as they appear in the live corpus
(task_messages and error telemetry, 2026-10-02), so a rule that stops matching
them is a rule that stopped matching real problems.
"""

from pathlib import Path

import pytest

from src.services.problem_catalogue import (
    CATALOGUE,
    CLASS_KEYS,
    CONFIGURATION,
    MODEL,
    PROVIDER,
    SOFTWARE,
    UNCLASSIFIED,
    UNCLASSIFIED_RULE,
    acceptance_for,
    classify,
    explain,
    headline,
    mitigation_for,
    normalize_message,
    problem_signature,
    task_for,
)

# (category, tool, text) -> the rule that must claim it.
EXAMPLES = [
    ("api_error", None,
     "OpenAI completion error: 400 This model's maximum context length is 262144 tokens. However, you "
     "requested 0 output tokens and your prompt contains at least 262145 input tokens", "context_overflow"),
    ("context_overflow", None, "Request exceeds the context window", "context_overflow"),
    ("empty_response", None, "MODEL_NO_ASSISTANT_MESSAGES", "empty_response"),
    ("api_error", None,
     "Unexpected API Response: The language model did not provide any assistant messages.", "empty_response"),
    ("invalid_tool_call", "apply_diff",
     "Roo tried to use apply_diff without value for required parameter 'path'. Retrying...", "missing_tool_parameter"),
    ("invalid_tool_call", "frobnicate", "Unknown tool frobnicate", "invalid_tool_call"),
    ("tool_error", "read_artifact",
     'Error reading artifact: The value of "size" is out of range. It must be >= 0 && <= 9007199254740991. '
     "Received NaN", "artifact_nan_size"),
    ("tool_error", "read_file",
     "Error extracting text from a.pdf: Cannot destructure property 'platform' of 'navigator' as it is undefined.",
     "pdf_navigator_crash"),
    ("tool_error", "read_artifact", 'Artifact not found: "cmd-1789727868953.txt". Valid ids look like', "artifact_id_guessed"),
    ("tool_error", "read_file",
     "Error reading file src/reviewer.rs: ENOENT: no such file or directory, stat '/home/k/src/reviewer.rs'",
     "path_guessed"),
    ("tool_error", "list_files", "Error listing files:\nCannot list files: directory does not exist: /tmp/x",
     "path_guessed"),
    ("diff_error", "apply_diff",
     "<error_details>\nNo sufficiently similar match found at line: 12 (87% similar, needs 100%)", "diff_no_match"),
    ("diff_error", "apply_diff", "Search and replace content are identical - no changes would be made", "diff_identical"),
    ("tool_error", "use_mcp_tool", "Error executing MCP tool:\nMCP error -32001: Request timed out", "mcp_timeout"),
    ("api_error", None, "401 Incorrect API key provided", "auth_rejected"),
    ("api_error", None, "429 Too Many Requests", "rate_limited"),
    ("api_error", None, "OpenAI completion error: Connection error.", "connection"),
    ("api_error", None, "terminated", "connection"),
    ("tool_error", "web_fetch", "web_fetch got HTTP 403 for https://example.com/; check the URL", "web_fetch_refused"),
    ("rooignore", None, '"process\\.env\\.[A-Z_0-9]+"', "rooignore_blocked"),
    ("mistake_limit", None, "This may indicate a failure in the model's thought process", "mistake_limit"),
    ("code_index", None, "Code index", "code_index"),
    ("shell_integration", None, "Shell integration unavailable", "shell_integration"),
    ("settings_invalid", None, "providerProfiles", "settings_invalid"),
    ("model_list_empty", None, "Empty model list", "model_list_empty"),
    ("exception", None, "TypeError: Cannot read properties of undefined (reading 'x')", "exception"),
    ("diff_error", None, "Diff not applied", "diff_failed"),
    ("api_error", None, "500 Internal error: upstream exploded", "provider_error"),
]


@pytest.mark.parametrize("category, tool, text, rule_id", EXAMPLES)
def test_each_example_is_claimed_by_its_rule(category, tool, text, rule_id):
    assert classify(category, tool, text).id == rule_id


def test_every_rule_has_an_example():
    assert {rule.id for rule in CATALOGUE} == {example[-1] for example in EXAMPLES}


def test_rule_ids_are_unique_and_every_class_has_a_style():
    ids = [rule.id for rule in CATALOGUE]
    assert len(ids) == len(set(ids))
    for rule in (*CATALOGUE, UNCLASSIFIED_RULE):
        assert rule.classification in CLASS_KEYS


def test_an_unknown_problem_is_unclassified_not_dropped():
    rule = classify("quota_exhausted", None, "something nobody has seen")
    assert rule is UNCLASSIFIED_RULE
    assert rule.classification == UNCLASSIFIED
    assert "problem_catalogue" in rule.mitigation


def test_a_known_category_with_unknown_text_is_still_unclassified():
    assert classify("tool_error", None, "The flux capacitor is empty").classification == UNCLASSIFIED


def test_mitigations_name_the_model_or_say_so_neutrally():
    rule = classify("invalid_tool_call", "apply_diff", "without value for required parameter 'path'")
    text = mitigation_for(rule, "GLM-5.3-Flash", "openai", "apply_diff")
    assert "GLM-5.3-Flash called apply_diff" in text
    blank = mitigation_for(rule, None, None, None)
    assert "the model called the tool" in blank
    assert "{" not in blank


def test_every_mitigation_formats_and_uses_plain_dashes():
    for rule in (*CATALOGUE, UNCLASSIFIED_RULE):
        text = mitigation_for(rule, "m", "p", "t")
        assert "{" not in text and "}" not in text
        for banned in ("\u2014", "\u2013"):
            assert banned not in text and banned not in rule.title


# --- signatures --------------------------------------------------------------


def test_headline_skips_markup_and_bare_numbers_and_follows_a_colon():
    assert headline("<error_details>\nNo match found\nDebug") == "No match found"
    assert headline("3\nOpenAI completion error: Connection error.") == "OpenAI completion error: Connection error."
    assert headline("Error executing MCP tool:\nMCP error -32001: Request timed out") == (
        "Error executing MCP tool: MCP error -32001: Request timed out"
    )
    assert headline("") == ""


@pytest.mark.parametrize(
    "first, second",
    [
        (
            "Error reading file src/a.ts: ENOENT: no such file or directory, stat '/home/k/src/a.ts'",
            "Error reading file notes.md: ENOENT: no such file or directory, stat '/home/k/notes.md'",
        ),
        ("HTTP 500 after 3 tries", "HTTP 502 after 14 tries"),
        ('Artifact not found: "cmd-1789727868953.txt".', 'Artifact not found: "tool-1706119234567.txt".'),
        ("web_fetch got HTTP 403 for https://a.example/x", "web_fetch got HTTP 404 for https://b.example/y?z=1"),
        ("task 01a0e84f-15ed-7388-97ce-5061d5254140 failed", "task 01a0c370-743c-74cd-a390-2360e71868f9 failed"),
    ],
)
def test_what_varies_between_occurrences_is_blanked(first, second):
    assert normalize_message(first) == normalize_message(second)


def test_the_words_that_name_the_problem_survive():
    line = normalize_message("Roo tried to use apply_diff without value for required parameter 'path'. Retrying...")
    assert line == "Roo tried to use apply_diff without value for required parameter 'path'. Retrying..."
    assert normalize_message("required parameter 'path'") != normalize_message("required parameter 'mode'")


def test_the_signature_is_category_tool_and_headline_and_bounded():
    assert problem_signature("tool_error", "read_file", "Boom 42\nstack") == "tool_error | read_file | Boom #"
    assert problem_signature("api_error", None, "x") == "api_error | - | x"
    assert len(problem_signature("api_error", None, "word " * 500)) == 300


# --- the brief's fields: task, code hints, acceptance --------------------------

# The monorepo root when the cloud API runs from its checkout; in the docker
# image (self-hosted-cloudapi copied alone) the extension's sources are absent.
_REPO = Path(__file__).resolve().parents[2]


def test_every_rule_has_a_task_and_acceptance_in_plain_dashes():
    for rule in (*CATALOGUE, UNCLASSIFIED_RULE):
        for template in (rule.task, rule.acceptance):
            text = template.format_map({"model": "m", "provider": "p", "tool": "t"})
            assert len(text) > 40 and "{" not in text, rule.id
            for banned in ("\u2014", "\u2013"):
                assert banned not in text, rule.id
        assert task_for(rule, None, None, None).count("the model") <= 3


def test_tasks_start_the_way_their_class_asks():
    starts = {SOFTWARE: ("Fix",), MODEL: ("Make the integration with",),
              CONFIGURATION: ("Change the default",), PROVIDER: ("Handle",)}
    for rule in CATALOGUE:
        assert rule.task.startswith(starts[rule.classification]), rule.id


def test_every_rule_points_at_code():
    for rule in (*CATALOGUE, UNCLASSIFIED_RULE):
        assert rule.code_hints, rule.id
        for hint in rule.code_hints:
            path = hint.split(":", 1)[0].strip()
            assert not path.startswith("/") and ".." not in path and "\\" not in path, hint


@pytest.mark.skipif(not (_REPO / "src" / "core").is_dir(), reason="the extension sources are not next to the cloud API")
def test_every_code_hint_exists_in_the_repository():
    for rule in (*CATALOGUE, UNCLASSIFIED_RULE):
        for hint in rule.code_hints:
            path, _, symbol = hint.partition(":")
            target = _REPO / path.strip()
            assert target.exists(), f"{rule.id}: {path} does not exist"
            if symbol.strip():
                assert target.is_file() and symbol.strip() in target.read_text(encoding="utf-8"), (
                    f"{rule.id}: {path} does not mention {symbol.strip()}"
                )


def test_explain_names_the_rule_and_what_it_matched():
    rule = classify("invalid_tool_call", "apply_diff", "Roo tried ... without value for required parameter 'path'")
    why = explain(rule, "invalid_tool_call", "apply_diff", "Roo tried ... without value for required parameter 'path'")
    assert "'missing_tool_parameter'" in why and "'invalid_tool_call'" in why
    assert "'without value for required parameter'" in why
    assert "No rule" in explain(UNCLASSIFIED_RULE, "x", None, "y")
    assert acceptance_for(rule, "glm", None, "apply_diff").count("glm") >= 1
