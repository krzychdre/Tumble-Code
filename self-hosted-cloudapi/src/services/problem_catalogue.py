"""What a problem is, whose fault it is, and what to do about it.

The problem report page (/app/diagnostics) groups every problem occurrence by a
*signature* and then looks the group up here. A rule names the problem, puts
it in one of four classes, and says what to try:

  Software defect      our code is wrong; the fix is a change to the extension
  Model mismatch       the request was fine, the model did not do what the
                       protocol asks (a tool call without its parameters, an
                       edit that does not match the file, a guessed path)
  Provider or network  the request did not get a usable answer from the
                       provider or from the site a tool fetched
  Configuration        a setting on the user's side decides it (a context
                       window larger than the provider accepts, an MCP
                       timeout, an embedder that does not match the index)

The catalogue is data: an ordered list, first match wins, every rule tested in
tests/test_problem_catalogue.py. A group that no rule matches is not dropped:
it is shown as Unclassified with its raw evidence, and the fix is a new rule
here.

The signature is computed here too, so the extension's reports (stored at
ingest) and the occurrences derived from older data (computed when the page
is read) are grouped by one function.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

SOFTWARE = "Software defect"
MODEL = "Model mismatch"
PROVIDER = "Provider or network"
CONFIGURATION = "Configuration"
UNCLASSIFIED = "Unclassified"

# The CSS modifier each class is drawn with.
CLASS_KEYS: dict[str, str] = {
    SOFTWARE: "software",
    MODEL: "model",
    PROVIDER: "provider",
    CONFIGURATION: "config",
    UNCLASSIFIED: "unclassified",
}

SIGNATURE_MAX = 300


@dataclass(frozen=True)
class Rule:
    """One kind of problem.

    ``categories`` and ``tools`` restrict the rule to occurrences of those
    categories / tools (None: any). ``pattern`` is searched, case-insensitively,
    in the occurrence's text (its summary and error message); None matches any
    text. ``mitigation`` may name ``{model}``, ``{provider}`` and ``{tool}``,
    filled with the group's most frequent values.
    """

    id: str
    title: str
    classification: str
    mitigation: str
    categories: Optional[frozenset[str]] = None
    tools: Optional[frozenset[str]] = None
    pattern: Optional[str] = None

    def matches(self, category: str, tool: str, text: str) -> bool:
        if self.categories is not None and category not in self.categories:
            return False
        if self.tools is not None and tool not in self.tools:
            return False
        return self.pattern is None or re.search(self.pattern, text, re.IGNORECASE) is not None


def _rule(id, title, classification, mitigation, categories=None, tools=None, pattern=None) -> Rule:
    return Rule(
        id=id,
        title=title,
        classification=classification,
        mitigation=mitigation,
        categories=frozenset(categories) if categories is not None else None,
        tools=frozenset(tools) if tools is not None else None,
        pattern=pattern,
    )


# Ordered: specific rules before the per-category defaults at the end.
CATALOGUE: tuple[Rule, ...] = (
    _rule(
        "context_overflow",
        "Request larger than the model's context",
        CONFIGURATION,
        "The provider refused a request for {model} because it was longer than the model's context. "
        "The context window configured for {model} is larger than what {provider} accepts, so "
        "condensing starts too late. Lower the profile's context window (or the model's "
        "contextWindow) to the provider's real limit minus the output budget; if it already matches, "
        "lower the condensing threshold for this profile.",
        categories=("context_overflow", "api_error", "condense_error"),
        pattern=r"maximum context length|context[_ ]length[_ ]exceeded|context window|prompt is too long|too many tokens",
    ),
    _rule(
        "empty_response",
        "Model returned no answer",
        MODEL,
        "The request reached {provider} and came back without text or a tool call from {model}, so "
        "the network is not the cause. Usual reasons: the reasoning used up the output budget (raise "
        "max output tokens or lower the reasoning effort for {model}), the server's chat template "
        "does not emit the model's tool calls (check the tool-call parser / --jinja setting on the "
        "server), or the server drops the content of a reasoning model. Compare the response's stop "
        "reason and usage in a report's detail.",
        categories=("empty_response", "api_error"),
        pattern=r"MODEL_NO_ASSISTANT_MESSAGES|did not provide any assistant messages|empty (assistant )?response|no assistant message",
    ),
    _rule(
        "missing_tool_parameter",
        "Tool call without a required parameter",
        MODEL,
        "{model} called {tool} without a parameter the tool requires, and the extension had to ask "
        "again. The model does not follow the native tool-call schema for {tool} reliably. Try: a model "
        "with stronger tool calling for this mode; the provider's tool-call parser for this model "
        "family (a wrong parser drops arguments); a lower temperature. On our side the error the "
        "model gets back could repeat the tool's full parameter schema, which helps weak models "
        "recover on the first retry.",
        categories=("invalid_tool_call", "tool_error"),
        pattern=r"without value for required parameter|missing (a )?required parameter|required parameter",
    ),
    _rule(
        "invalid_tool_call",
        "Malformed tool call",
        MODEL,
        "{model} produced a tool call the extension could not use (unknown tool, arguments that are "
        "not valid JSON, or a wrong shape). Check the raw arguments in a report's detail: truncated "
        "JSON points at the output budget, a made-up tool name at a model that does not know the "
        "native protocol. Prefer a model with reliable tool calling for this mode.",
        categories=("invalid_tool_call",),
    ),
    _rule(
        "artifact_nan_size",
        "read_artifact computed a NaN size",
        SOFTWARE,
        "Our defect: reading an artifact passed NaN as a buffer size, so a numeric argument (offset, "
        "limit or the file size) was used without validation. Fix in the read_artifact tool: "
        "validate and clamp the numeric arguments and answer with a teaching error instead of "
        "throwing.",
        pattern=r"artifact.*Received NaN|Received NaN.*artifact|\"size\" is out of range",
    ),
    _rule(
        "pdf_navigator_crash",
        "PDF text extraction crashes on 'navigator'",
        SOFTWARE,
        "Our defect: the PDF text extractor expects the browser global 'navigator', which the "
        "extension host does not define, so every PDF read fails. Fix: load the Node build of the "
        "PDF library or define the global before it loads, and add a test that extracts a PDF in "
        "the extension host.",
        pattern=r"navigator",
    ),
    _rule(
        "artifact_id_guessed",
        "Artifact id that does not exist",
        MODEL,
        "{model} asked read_artifact for an id that was never issued (a path, or an id with the "
        "wrong extension). The tool already explains the id format. Mitigation on our side: list "
        "the task's existing artifact ids in the error, so the next call can copy one.",
        pattern=r"Artifact not found|Invalid artifact_id",
    ),
    _rule(
        "path_guessed",
        "File or directory that does not exist",
        MODEL,
        "{model} read or listed a path that does not exist (ENOENT): it guessed the path from the "
        "plan or from memory instead of looking. Usually harmless, the model recovers, but each one "
        "is a wasted turn. Mitigations: ask the mode's instructions to search or list before "
        "reading; on our side, the error could name the closest existing files.",
        pattern=r"ENOENT|no such file or directory|does not exist|File does not exist",
    ),
    _rule(
        "diff_no_match",
        "Edit does not match the file",
        MODEL,
        "{model}'s SEARCH block did not match the file's current content (it edited from a stale or "
        "imagined copy). Mitigations: re-read the region before editing (the mode instructions can "
        "require it); prefer smaller SEARCH blocks; a model that copies text exactly. Only if the "
        "similarity shown is close to the threshold is a lower fuzzy-match threshold worth trying.",
        categories=("diff_error", "tool_error"),
        pattern=r"No sufficiently similar match|does not match|search (block|content).*not found",
    ),
    _rule(
        "diff_identical",
        "Edit that changes nothing",
        MODEL,
        "{model} sent an edit whose SEARCH and REPLACE are identical. It lost track of what it meant "
        "to change; this tends to precede the mistake limit. A stronger model for this mode, or "
        "shorter tasks, help.",
        categories=("diff_error", "tool_error"),
        pattern=r"identical",
    ),
    _rule(
        "mcp_timeout",
        "MCP tool timed out",
        CONFIGURATION,
        "An MCP server did not answer within its timeout. If the tool is slow by nature, raise the "
        "server's timeout in the MCP settings; if it hangs, the server needs fixing or restarting. "
        "The task waited the full timeout each time.",
        pattern=r"MCP error -32001|MCP.*timed out|Request timed out",
    ),
    _rule(
        "auth_rejected",
        "Provider refused the credentials",
        CONFIGURATION,
        "{provider} answered 401/403: the API key or the account is not accepted for {model}. Check "
        "the key in the profile, the model's availability on the plan, and the base URL.",
        categories=("api_error",),
        pattern=r"\b40[13]\b|unauthori[sz]ed|forbidden|invalid api key|authentication",
    ),
    _rule(
        "rate_limited",
        "Provider rate limit",
        PROVIDER,
        "{provider} rate-limited the requests for {model} (429). Set a request delay or a lower "
        "concurrency for this profile, or use a plan with a higher limit.",
        categories=("api_error",),
        pattern=r"\b429\b|rate limit|too many requests|quota",
    ),
    _rule(
        "connection",
        "Connection to the provider failed",
        PROVIDER,
        "The connection to {provider} failed or was cut (connection error, reset, terminated, "
        "timeout). For a local server: is it up, and does it restart or swap models under load "
        "(a model swap drops the connection)? For a remote one: a network problem on the way. "
        "Retries cover single drops; many in a row mean the server is down.",
        categories=("api_error",),
        pattern=r"connection|ECONNRESET|ECONNREFUSED|socket|terminated|fetch failed|timed? ?out|network|\b50[234]\b",
    ),
    _rule(
        "web_fetch_refused",
        "Web page refused or unreadable",
        PROVIDER,
        "The site answered web_fetch with an error status or a content type the tool does not read "
        "(PDF). Many sites block automated readers; nothing to fix unless a site you need fails "
        "every time.",
        pattern=r"web_fetch",
    ),
    _rule(
        "rooignore_blocked",
        "Access blocked by .rooignore",
        CONFIGURATION,
        "A command or file access was blocked by a .rooignore pattern. If the model needs that "
        "access, narrow the pattern; otherwise tell the mode not to touch those paths.",
        categories=("rooignore", "tool_error"),
        pattern=r"rooignore|process\\?\.env",
    ),
    _rule(
        "mistake_limit",
        "Consecutive mistake limit reached",
        MODEL,
        "{model} failed several turns in a row (tool errors, no tool call, or the same action "
        "repeated) and the run stopped for guidance. Look at the problems just before it in the same "
        "task: they say what it failed at. Repeatedly on one model for one mode means the model does "
        "not fit that mode.",
        categories=("mistake_limit",),
    ),
    _rule(
        "code_index",
        "Code index error",
        CONFIGURATION,
        "Indexing or searching the codebase failed. Older extensions sent no detail; the usual "
        "causes are an embedder model whose dimension does not match the configured one, an "
        "unreachable embedder or Qdrant endpoint, or a model id the embedder does not serve. Open "
        "the code index settings and test the connection.",
        categories=("code_index",),
    ),
    _rule(
        "shell_integration",
        "Terminal shell integration unavailable",
        CONFIGURATION,
        "VS Code's shell integration did not start, so command output could not be read. Check the "
        "terminal profile (a shell VS Code can integrate with) or raise the shell integration "
        "timeout in the settings.",
        categories=("shell_integration",),
    ),
    _rule(
        "settings_invalid",
        "Settings failed validation",
        CONFIGURATION,
        "A settings file (profiles, modes or MCP) did not match its schema and was ignored in part. "
        "Open the file named in the problem and fix or remove the invalid entry.",
        categories=("settings_invalid",),
    ),
    _rule(
        "model_list_empty",
        "Provider returned an empty model list",
        PROVIDER,
        "{provider} answered the model list request with nothing. Check the base URL and the key; a "
        "local server may have no model loaded.",
        categories=("model_list_empty",),
    ),
    _rule(
        "exception",
        "Unhandled exception in the extension",
        SOFTWARE,
        "Our defect: the extension threw an error nothing handled. The sample's message and stack "
        "say where; file a fix with them.",
        categories=("exception",),
    ),
    _rule(
        "diff_failed",
        "Edit not applied",
        MODEL,
        "{model}'s edit could not be applied. Read a sample: a SEARCH block that does not match is "
        "the model's, a crash inside the diff code is ours.",
        categories=("diff_error",),
    ),
    _rule(
        "provider_error",
        "Provider error",
        PROVIDER,
        "{provider} answered the request for {model} with an error. The sample's error body and "
        "HTTP status say which; repeated identical errors are worth reporting to the provider.",
        categories=("api_error",),
    ),
)

UNCLASSIFIED_RULE = Rule(
    id="unclassified",
    title="Unclassified",
    classification=UNCLASSIFIED,
    mitigation="No rule describes this problem yet. Read the sample below; if it recurs, add a rule "
    "to services/problem_catalogue.py so the next report says whose fault it is.",
)


def classify(category: str, tool: Optional[str], text: str) -> Rule:
    """The first catalogue rule that matches, else ``UNCLASSIFIED_RULE``."""
    tool = tool or ""
    text = text or ""
    for rule in CATALOGUE:
        if rule.matches(category, tool, text):
            return rule
    return UNCLASSIFIED_RULE


class _Blank(dict):
    """format_map helper: a missing value reads as a neutral phrase."""

    def __missing__(self, key):
        return {"model": "the model", "provider": "the provider", "tool": "the tool"}.get(key, key)


def mitigation_for(rule: Rule, model: Optional[str], provider: Optional[str], tool: Optional[str]) -> str:
    values = _Blank()
    for key, value in (("model", model), ("provider", provider), ("tool", tool)):
        if value:
            values[key] = value
    return rule.mitigation.format_map(values)


# --- signatures --------------------------------------------------------------

_URL = re.compile(r"\bhttps?://\S+", re.IGNORECASE)
_UUID = re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", re.IGNORECASE)
_HEX = re.compile(r"\b[0-9a-f]*\d[0-9a-f]*[a-f][0-9a-f]*\b|\b[0-9a-f]*[a-f][0-9a-f]*\d[0-9a-f]*\b", re.IGNORECASE)
_QUOTED = re.compile(r"(['\"`])([^'\"`]*)\1")
_PATH = re.compile(r"(?:[A-Za-z]:)?(?:[\w.~@+\-\[\]]*[/\\])+[\w.~@+\-]*")
_FILE = re.compile(r"\b[\w\-]+\.[A-Za-z][A-Za-z0-9]{0,4}\b")
_DIGITS = re.compile(r"\d+")
_SPACE = re.compile(r"\s+")
_TAG_ONLY = re.compile(r"^</?[\w\-]+>$")


def _blank_quoted(match: re.Match) -> str:
    quote, inner = match.group(1), match.group(2)
    # A quoted word ('path', 'mode') names the problem; a quoted path, id or
    # sentence is the part that varies.
    if len(inner) > 40 or re.search(r"[/\\.\d]", inner):
        return f"{quote}<q>{quote}"
    return match.group(0)


def headline(text: Optional[str]) -> str:
    """The line of ``text`` that says what went wrong.

    The first line with a letter in it, skipping a bare markup tag such as
    ``<error_details>``; when that line ends with a colon ("Error executing MCP
    tool:") the next line is what it introduces, so it is appended.
    """
    lines = [line.strip() for line in (text or "").splitlines()]
    lines = [line for line in lines if re.search(r"[A-Za-z]", line) and not _TAG_ONLY.match(line)]
    if not lines:
        return ""
    head = lines[0]
    if head.endswith(":") and len(lines) > 1:
        head = f"{head} {lines[1]}"
    return head


def normalize_message(text: Optional[str]) -> str:
    """The headline with what varies between occurrences blanked.

    URLs, uuids and hex ids, quoted paths or sentences, file paths and names,
    then every remaining run of digits. "Error reading file a/b.ts: ENOENT"
    and "Error reading file c.md: ENOENT" become the same string.
    """
    line = headline(text)
    line = _URL.sub("<url>", line)
    line = _UUID.sub("<id>", line)
    line = _QUOTED.sub(_blank_quoted, line)
    line = _PATH.sub("<path>", line)
    line = _FILE.sub("<path>", line)
    line = _HEX.sub("<id>", line)
    line = _DIGITS.sub("#", line)
    return _SPACE.sub(" ", line).strip()


def problem_signature(category: str, tool: Optional[str], text: Optional[str]) -> str:
    """The grouping key: category, tool and the normalized headline."""
    signature = f"{category} | {tool or '-'} | {normalize_message(text)}"
    return signature[:SIGNATURE_MAX]
