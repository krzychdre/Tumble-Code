"""Is an LLM exchange fit to train on? The issues that say why not.

An exchange is judged three ways, each adding issue names:

* ``static_issues``: from the exchange alone (status, answer, the tools the
  request offered). Computed at ingest and stored, so the dataset page can
  count without reading payloads.
* ``outcome_issues``: from what the extension saw when the tools ran (its
  tool-call probe: guards, unparsable arguments, mistake limit, failing tools,
  the user's rejection).
* ``result_issues``: from the tool results the next request of the task sends
  back, for an exchange whose outcome never arrived.

``DROP_DEFAULT`` and ``DROP_STRICT`` say which issues keep an exchange out of
the dataset. The table is in ai_plans/2026-10-02_llm-exchange-dataset.md.
"""

from __future__ import annotations

import json
import re
from typing import Any, Iterable, Optional

API_ERROR = "api_error"
ABORTED = "aborted"
UNKNOWN_STATUS = "unknown_status"
EMPTY_RESPONSE = "empty_response"
TRUNCATED = "truncated"
INTERRUPTED = "interrupted"
MALFORMED_ARGUMENTS = "malformed_arguments"
UNKNOWN_TOOL = "unknown_tool"
MISSING_PARAMETER = "missing_parameter"
TOOL_CALL_IN_TEXT = "tool_call_in_text"
INVALID_TOOL_CALL = "invalid_tool_call"
MISTAKE_LIMIT = "mistake_limit"
TOOL_FAILED = "tool_failed"
REJECTED = "rejected"
INCOMPLETE = "incomplete"

# What each issue means, for the dataset page.
ISSUE_LABELS: dict[str, str] = {
    API_ERROR: "The request failed",
    ABORTED: "Cancelled before the answer ended",
    UNKNOWN_STATUS: "Status unknown to this server",
    EMPTY_RESPONSE: "No text and no tool call",
    TRUNCATED: "Cut off by the output limit",
    INTERRUPTED: "Answer interrupted by the extension",
    MALFORMED_ARGUMENTS: "Tool arguments are not a JSON object",
    UNKNOWN_TOOL: "Called a tool the request did not offer",
    MISSING_PARAMETER: "A required parameter is missing",
    TOOL_CALL_IN_TEXT: "Tool call written as text markup",
    INVALID_TOOL_CALL: "The extension rejected the call",
    MISTAKE_LIMIT: "Repeated the same failing call",
    TOOL_FAILED: "The tool ran and failed",
    REJECTED: "The user rejected the call",
    INCOMPLETE: "Cannot be reconstructed (missing base or blob)",
}

# Issues that keep an exchange out of every dataset: the answer itself is wrong.
DROP_DEFAULT: frozenset[str] = frozenset({
    API_ERROR, ABORTED, UNKNOWN_STATUS, EMPTY_RESPONSE, TRUNCATED, INTERRUPTED, MALFORMED_ARGUMENTS,
    UNKNOWN_TOOL, MISSING_PARAMETER, TOOL_CALL_IN_TEXT, INVALID_TOOL_CALL, MISTAKE_LIMIT, INCOMPLETE,
})
# Strict also drops a well-formed call that did not work out (a guessed path,
# a diff that did not apply) and one the user did not want.
DROP_STRICT: frozenset[str] = DROP_DEFAULT | {TOOL_FAILED, REJECTED}

STOP_TRUNCATED = {"length", "max_tokens", "max_output_tokens"}

# The extension appends these to a streamed text it cut short.
_INTERRUPTED_MARK = "[Response interrupted by"

# Tool call markup written as plain text: the XML tool protocol, Hermes/Qwen
# <tool_call>, Anthropic's <function_calls>/<invoke>.
_MARKUP = re.compile(r"<(?:tool_call|function_calls|invoke)\b")


def offered_tools(tools: Any) -> dict[str, dict]:
    """Name -> parameters schema of the tools a request offered.

    The extension sends the OpenAI function format; an Anthropic-style entry
    (``name`` + ``input_schema``) is read too.
    """
    offered: dict[str, dict] = {}
    if not isinstance(tools, list):
        return offered
    for tool in tools:
        if not isinstance(tool, dict):
            continue
        function = tool.get("function") if isinstance(tool.get("function"), dict) else None
        name = (function or tool).get("name")
        schema = (function or {}).get("parameters") if function else tool.get("input_schema")
        if isinstance(name, str) and name:
            offered[name] = schema if isinstance(schema, dict) else {}
    return offered


def _allows_null(schema: Any) -> bool:
    if not isinstance(schema, dict):
        return False
    kind = schema.get("type")
    if kind == "null" or (isinstance(kind, list) and "null" in kind):
        return True
    for key in ("anyOf", "oneOf"):
        options = schema.get(key)
        if isinstance(options, list) and any(_allows_null(o) for o in options):
            return True
    return False


def missing_parameters(schema: dict, args: dict) -> list[str]:
    """Required parameters absent from ``args``.

    A strict-mode schema lists every parameter as required and marks the
    optional ones nullable; leaving out a nullable one is how weak models and
    the extension both treat "not given", so only a non-nullable one counts.
    """
    required = schema.get("required") if isinstance(schema, dict) else None
    properties = schema.get("properties") if isinstance(schema, dict) else None
    if not isinstance(required, list):
        return []
    missing = []
    for name in required:
        if not isinstance(name, str):
            continue
        prop = properties.get(name) if isinstance(properties, dict) else None
        if args.get(name) is None and not _allows_null(prop):
            missing.append(name)
    return missing


def parse_arguments(raw: Any) -> Optional[dict]:
    """The arguments as an object, or None when they are not a JSON object."""
    if not isinstance(raw, str):
        return None
    try:
        value = json.loads(raw) if raw.strip() else {}
    except (ValueError, RecursionError):
        return None
    return value if isinstance(value, dict) else None


def static_issues(status: str, response: dict, tools: Any) -> list[str]:
    """What is wrong with the exchange as recorded (see the module docstring)."""
    issues: set[str] = set()
    if status == "error":
        issues.add(API_ERROR)
    elif status == "aborted":
        issues.add(ABORTED)
    elif status != "completed":
        issues.add(UNKNOWN_STATUS)

    text = response.get("text") if isinstance(response.get("text"), str) else ""
    calls = [c for c in (response.get("toolCalls") or []) if isinstance(c, dict)]
    if status == "completed" and not text.strip() and not calls:
        issues.add(EMPTY_RESPONSE)
    if response.get("finishReason") in STOP_TRUNCATED:
        issues.add(TRUNCATED)
    if _INTERRUPTED_MARK in text:
        issues.add(INTERRUPTED)

    offered = offered_tools(tools)
    for call in calls:
        args = parse_arguments(call.get("arguments"))
        if args is None:
            issues.add(MALFORMED_ARGUMENTS)
        name = call.get("name")
        if offered and name not in offered:
            issues.add(UNKNOWN_TOOL)
        elif args is not None and name in offered and missing_parameters(offered[name], args):
            issues.add(MISSING_PARAMETER)

    if text and (_MARKUP.search(text) or any(f"<{name}>" in text for name in offered)):
        issues.add(TOOL_CALL_IN_TEXT)
    return sorted(issues)


_OUTCOME_ISSUES = {
    "invalid_tool_call": INVALID_TOOL_CALL,
    "mistake_limit": MISTAKE_LIMIT,
    "tool_error": TOOL_FAILED,
    "diff_error": TOOL_FAILED,
    "rejected": REJECTED,
}


def outcome_issues(tool_results: Iterable[dict]) -> list[str]:
    """Issues from the extension's tool-call outcomes ("ok" and unknown statuses add none)."""
    found = {_OUTCOME_ISSUES[r.get("status")] for r in tool_results if r.get("status") in _OUTCOME_ISSUES}
    return sorted(found)


_ERROR_RESULT = re.compile(r'^\s*(?:Error\b|\{"status":\s*"error")')


def tool_result_failed(block: dict) -> bool:
    """A tool_result block that reports a failure (the extension's own rule)."""
    if block.get("is_error") is True:
        return True
    content = block.get("content")
    if isinstance(content, list):
        content = "\n".join(
            part.get("text", "") for part in content if isinstance(part, dict) and part.get("type") == "text"
        )
    return isinstance(content, str) and bool(_ERROR_RESULT.match(content))


def result_issues(call_ids: Iterable[str], results: dict[str, dict]) -> list[str]:
    """TOOL_FAILED when a later request answers one of ``call_ids`` with a failure."""
    for call_id in call_ids:
        block = results.get(call_id)
        if block is not None and tool_result_failed(block):
            return [TOOL_FAILED]
    return []


def join_issues(*groups: Iterable[str]) -> str:
    """The stored form: sorted, unique, comma-separated."""
    return ",".join(sorted({issue for group in groups for issue in group if issue}))


def split_issues(stored: Optional[str]) -> list[str]:
    return [issue for issue in (stored or "").split(",") if issue]


def is_clean(issues: Iterable[str], strict: bool = False) -> bool:
    drop = DROP_STRICT if strict else DROP_DEFAULT
    return not any(issue in drop for issue in issues)
