"""services/exchange_quality: which exchanges a clean dataset leaves out, and why."""

import json

from src.services.exchange_quality import (
    is_clean,
    missing_parameters,
    offered_tools,
    outcome_issues,
    result_issues,
    static_issues,
)
from src.services.exchange_reconstruction import js_json

TOOLS = [
    {"type": "function", "function": {"name": "read_file", "parameters": {
        "type": "object",
        "properties": {"path": {"type": "string"}, "mode": {"type": ["string", "null"]}},
        "required": ["path", "mode"],
    }}},
    {"type": "function", "function": {"name": "execute_command", "parameters": {
        "type": "object",
        "properties": {"command": {"type": "string"}, "cwd": {"anyOf": [{"type": "string"}, {"type": "null"}]}},
        "required": ["command", "cwd"],
    }}},
]


def _call(name, arguments):
    return {"id": "c1", "name": name, "arguments": arguments}


def test_a_good_answer_has_no_issue():
    response = {"text": "Reading.", "toolCalls": [_call("read_file", '{"path": "a.ts"}')], "finishReason": "tool_calls"}
    assert static_issues("completed", response, TOOLS) == []
    assert static_issues("completed", {"text": "Done, the bug is fixed."}, TOOLS) == []


def test_status_and_shape_issues():
    assert static_issues("error", {}, TOOLS) == ["api_error"]
    assert static_issues("aborted", {"text": "partial"}, TOOLS) == ["aborted"]
    assert static_issues("weird", {"text": "x"}, TOOLS) == ["unknown_status"]
    assert static_issues("completed", {"text": "  "}, TOOLS) == ["empty_response"]
    assert static_issues("completed", {"text": "long", "finishReason": "length"}, TOOLS) == ["truncated"]
    interrupted = {"text": "x\n\n[Response interrupted by a tool use result. Only one tool may be used at a time]"}
    assert static_issues("completed", interrupted, TOOLS) == ["interrupted"]


def test_broken_tool_calls():
    def issues(arguments, name="read_file"):
        return static_issues("completed", {"toolCalls": [_call(name, arguments)]}, TOOLS)

    assert issues('{"path": "a.ts"') == ["malformed_arguments"]
    assert issues('["a.ts"]') == ["malformed_arguments"]
    assert issues('{"path": "a.ts"}', name="read_files") == ["unknown_tool"]
    assert issues('{"mode": "slice"}') == ["missing_parameter"]
    assert issues('{"path": null}') == ["missing_parameter"]
    # Required but nullable: leaving it out is "not given", as the extension reads it.
    assert issues('{"path": "a.ts"}') == []
    assert issues('{"command": "ls"}', name="execute_command") == []
    # No arguments at all is an empty object (a tool without parameters).
    assert static_issues("completed", {"toolCalls": [_call("attempt_completion", "")]}, []) == []


def test_a_tool_call_written_as_text():
    for text in ("<read_file><path>a.ts</path></read_file>", '<tool_call>{"name": "x"}</tool_call>', "<invoke name=\"x\">"):
        assert static_issues("completed", {"text": text}, TOOLS) == ["tool_call_in_text"], text
    assert static_issues("completed", {"text": "Use a <div> here"}, TOOLS) == []


def test_offered_tools_reads_both_formats():
    anthropic = [{"name": "grep", "input_schema": {"required": ["q"]}}]
    assert set(offered_tools(TOOLS)) == {"read_file", "execute_command"}
    assert offered_tools(anthropic) == {"grep": {"required": ["q"]}}
    assert missing_parameters({"required": ["q"]}, {}) == ["q"]


def test_outcomes_and_later_tool_results():
    assert outcome_issues([{"status": "ok"}, {"status": "something-new"}]) == []
    assert outcome_issues([{"status": "invalid_tool_call"}, {"status": "diff_error"}]) == ["invalid_tool_call", "tool_failed"]
    assert outcome_issues([{"status": "rejected"}, {"status": "mistake_limit"}]) == ["mistake_limit", "rejected"]

    results = {
        "c1": {"type": "tool_result", "tool_use_id": "c1", "content": "Error: ENOENT"},
        "c2": {"type": "tool_result", "tool_use_id": "c2", "content": [{"type": "text", "text": '{"status": "error"}'}]},
        "c3": {"type": "tool_result", "tool_use_id": "c3", "content": "ok", "is_error": True},
        "c4": {"type": "tool_result", "tool_use_id": "c4", "content": "file text"},
    }
    for call_id in ("c1", "c2", "c3"):
        assert result_issues([call_id], results) == ["tool_failed"], call_id
    assert result_issues(["c4", "missing"], results) == []


def test_default_and_strict():
    assert is_clean([])
    assert is_clean(["tool_failed", "rejected"])
    assert not is_clean(["tool_failed"], strict=True)
    assert not is_clean(["missing_parameter"])
    assert not is_clean(["incomplete"])


def test_js_json_writes_like_json_stringify():
    # Expected strings produced by Node's JSON.stringify.
    value = [1e-7, 1e21, 0.1, 1e-6, 123456789012345680000.0, 5e-324, 2.5e25, -0.0, 1e16, 0.000123,
             "a\u0001b \"\\\n\t", {"ż": "ł"}, True, None, 3]
    assert js_json(value) == (
        '[1e-7,1e+21,0.1,0.000001,123456789012345680000,5e-324,2.5e+25,0,10000000000000000,0.000123,'
        '"a\\u0001b \\"\\\\\\n\\t",{"ż":"ł"},true,null,3]'
    )
    body = {"model": "m", "messages": [{"role": "user", "content": "zażółć"}], "temperature": 0.2}
    assert js_json(body) == json.dumps(body, ensure_ascii=False, separators=(",", ":"))


def test_later_tool_results_match_sanitized_call_ids():
    """The extension stores tool ids through sanitizeToolUseId (Kimi ids carry '.' and ':')."""
    from src.services.exchange_reconstruction import Exchange

    exchange = Exchange(
        id="e", task_id="t", base_id=None, sequence=0, occurred_at=None, model_id=None, provider=None, mode=None,
        workspace_path=None, status="completed", retry_attempt=0, system="s", tools=[], messages=[], params={},
        response={"toolCalls": [{"id": "functions.read_file:0", "name": "read_file", "arguments": "{}"}]},
        error=None, outcome=None, stored_issues=[], complete=True,
    )
    results = {"functions_read_file_0": {"type": "tool_result", "content": "Error: ENOENT"}}
    assert exchange.tool_call_ids == ["functions_read_file_0"]
    assert result_issues(exchange.tool_call_ids, results) == ["tool_failed"]
