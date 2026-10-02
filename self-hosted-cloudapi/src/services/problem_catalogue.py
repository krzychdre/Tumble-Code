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

# The CSS modifier each class is drawn with, also its value in ``?class=``.
CLASS_KEYS: dict[str, str] = {
    SOFTWARE: "software",
    MODEL: "model",
    PROVIDER: "provider",
    CONFIGURATION: "config",
    UNCLASSIFIED: "unclassified",
}
CLASS_BY_KEY: dict[str, str] = {key: name for name, key in CLASS_KEYS.items()}

SIGNATURE_MAX = 300


@dataclass(frozen=True)
class Rule:
    """One kind of problem.

    ``categories`` and ``tools`` restrict the rule to occurrences of those
    categories / tools (None: any). ``pattern`` is searched, case-insensitively,
    in the occurrence's text (its summary and error message); None matches any
    text. ``mitigation`` may name ``{model}``, ``{provider}`` and ``{tool}``,
    filled with the group's most frequent values.

    The rest is for the brief a coding agent gets (services/problem_brief):
    ``task`` is the one-sentence job ("Fix ...", "Make the integration with
    {model} robust ..."), ``code_hints`` the repo-relative files to start
    from, each optionally followed by ": <symbol>" (tests check that the file
    exists and contains the symbol), and ``acceptance`` what must be true
    after the fix. ``task`` and ``acceptance`` take the same placeholders.
    """

    id: str
    title: str
    classification: str
    mitigation: str
    categories: Optional[frozenset[str]] = None
    tools: Optional[frozenset[str]] = None
    pattern: Optional[str] = None
    task: str = ""
    code_hints: tuple[str, ...] = ()
    acceptance: str = ""

    def matches(self, category: str, tool: str, text: str) -> bool:
        if self.categories is not None and category not in self.categories:
            return False
        if self.tools is not None and tool not in self.tools:
            return False
        return self.pattern is None or re.search(self.pattern, text, re.IGNORECASE) is not None


def _rule(
    id, title, classification, mitigation, categories=None, tools=None, pattern=None, task="", code_hints=(),
    acceptance="",
) -> Rule:
    return Rule(
        id=id,
        title=title,
        classification=classification,
        mitigation=mitigation,
        categories=frozenset(categories) if categories is not None else None,
        tools=frozenset(tools) if tools is not None else None,
        pattern=pattern,
        task=task,
        code_hints=tuple(code_hints),
        acceptance=acceptance,
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
        task="Change the default context handling for {model} at {provider} so a request stays inside the "
        "context the provider really accepts (condense earlier; on a refusal shrink and retry instead of "
        "failing the turn), or explain to the user which context window setting to lower.",
        code_hints=(
            "src/core/context/context-management/context-error-handling.ts: checkContextWindowExceededError",
            "src/core/task/RetryHandler.ts",
            "src/core/context-management/index.ts: resolveCondenseThreshold",
            "src/core/task/TaskContextManager.ts: FORCED_CONTEXT_REDUCTION_PERCENT",
            "packages/types/src/model.ts: contextWindow",
            "webview-ui/src/components/settings/ContextManagementSettings.tsx",
        ),
        acceptance="A request that the provider refuses for its length is recognized as a context overflow "
        "(checkContextWindowExceededError returns true for this provider's error text), the context is "
        "reduced and the request retried without the user's help. After the fix no new occurrences of "
        "this signature for {model}, or each one is followed by a successful retry in the same task.",
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
        task="Make the integration with {model} robust against answers that carry no text and no tool call: "
        "find out from the evidence why the answer was empty (output budget used up by reasoning, a "
        "dropped tool call, a parser that lost the content) and handle that cause.",
        code_hints=(
            "src/core/task/TaskApiLoop.ts: handleEmptyAssistantResponse",
            "src/api/transform/chat-completions-stream.ts: streamChatCompletion",
            "src/api/providers/base-openai-compatible-provider.ts",
            "src/api/transform/model-params.ts",
            "src/core/diagnostics/ErrorReporter.ts: reportEmptyResponse",
        ),
        acceptance="For the stop reasons and usage seen in the samples, the extension either recovers the answer "
        "(for example the tool call or text that the parser dropped) or retries with a change that "
        "addresses the cause (more output budget, less reasoning), and the user sees a message naming the"
        " cause. New error reports for this signature show a stop reason and usage, and the count for "
        "{model} goes down.",
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
        task="Make the integration with {model} robust against {tool} calls that omit a required parameter: "
        "check whether the parameter was really missing from the raw arguments or lost by our parsing, "
        "then make the first retry succeed.",
        code_hints=(
            "src/core/task/TaskAskSay.ts: sayAndCreateMissingParamError",
            "src/core/prompts/responses.ts: missingToolParameterError",
            "src/core/assistant-message/NativeToolCallParser.ts: parseToolCall",
            "src/core/tools/toolArgParsers.ts",
            "src/core/prompts/tools/native-tools/apply_diff.ts",
            "src/core/tools/ApplyDiffTool.ts",
        ),
        acceptance="Given the raw arguments from the samples, a test shows whether the parameter was absent in the "
        "model's output or dropped by NativeToolCallParser. If ours, the parser keeps it. If the model's,"
        " the error returned to the model names the missing parameter and repeats the tool's parameter "
        "schema, and in a replay the next call carries it. New reports for {model} and {tool} show fewer "
        "repeats per task.",
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
        task="Make the integration with {model} robust against malformed tool calls: decide from the raw "
        "arguments whether they are truncated, not JSON, or name an unknown tool, and give the model an "
        "error it can act on.",
        code_hints=(
            "src/core/assistant-message/NativeToolCallParser.ts: parseToolCall",
            "src/core/assistant-message/presentAssistantMessage.ts",
            "src/core/tools/validateToolUse.ts",
            "src/core/prompts/tools/native-tools/index.ts",
        ),
        acceptance="Each malformed shape seen in the samples has a test: truncated JSON is reported as truncated "
        "(with the output budget named), an unknown tool gets the list of valid tool names, invalid JSON "
        "gets the parse position. The model's next call in a replay is valid, and new reports for this "
        "signature drop.",
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
        task="Fix the read_artifact tool so a missing or non-numeric offset, limit or size never reaches a "
        "Node buffer call as NaN.",
        code_hints=(
            "src/core/tools/ReadArtifactTool.ts: readArtifact",
            "src/core/tools/toolArgParsers.ts",
            "src/core/prompts/tools/native-tools/read_artifact.ts",
        ),
        acceptance="A unit test calls ReadArtifactTool with the arguments from the samples (and with absent, empty, "
        "negative and non-numeric values) and gets either the artifact's content or a teaching error, "
        "never \"Received NaN\" or \"size is out of range\". No new occurrences of this signature.",
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
        task="Fix PDF text extraction in the extension host: it must not touch the browser global 'navigator'.",
        code_hints=(
            "src/integrations/misc/extract-text.ts: loadPdfParse",
            "src/integrations/misc/extract-text.ts: extractTextFromPDF",
            "src/core/tools/ReadFileTool.ts",
        ),
        acceptance="A test extracts the text of a small PDF in a Node environment where 'navigator' is undefined, "
        "and read_file returns the text. No new \"Cannot destructure property 'platform' of 'navigator'\" "
        "occurrences.",
    ),
    _rule(
        "artifact_id_guessed",
        "Artifact id that does not exist",
        MODEL,
        "{model} asked read_artifact for an id that was never issued (a path, or an id with the "
        "wrong extension). The tool already explains the id format. Mitigation on our side: list "
        "the task's existing artifact ids in the error, so the next call can copy one.",
        pattern=r"Artifact not found|Invalid artifact_id",
        task="Make the integration with {model} robust against read_artifact calls with ids that were never "
        "issued: the error should let the next call succeed.",
        code_hints=(
            "src/core/tools/ReadArtifactTool.ts",
            "src/core/prompts/tools/native-tools/read_artifact.ts",
        ),
        acceptance="When the id is unknown or malformed, the error lists the task's existing artifact ids (or says "
        "there are none), and a test covers both the \"Artifact not found\" and the \"Invalid artifact_id\" "
        "paths. New reports show the model's next call using a listed id.",
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
        task="Make the integration with {model} robust against reads and listings of paths that do not exist: "
        "help the model find the right path on the first retry.",
        code_hints=(
            "src/core/tools/ReadFileTool.ts",
            "src/core/tools/ListFilesTool.ts",
            "src/core/prompts/tools/native-tools/read_file.ts",
            "src/core/prompts/tools/native-tools/list_files.ts",
        ),
        acceptance="The ENOENT error returned to the model names the closest existing paths (same file name "
        "elsewhere, or the nearest existing parent directory), covered by a unit test. The number of "
        "consecutive ENOENT errors per task goes down for {model}.",
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
        task="Make the integration with {model} robust against SEARCH blocks that do not match the file: "
        "decide from the samples whether the model edited a stale copy or our matching is too strict, and"
        " act on that.",
        code_hints=(
            "src/core/diff/strategies/multi-search-replace.ts: MultiSearchReplaceDiffStrategy",
            "src/core/tools/ApplyDiffTool.ts",
            "src/core/prompts/tools/native-tools/apply_diff.ts",
        ),
        acceptance="A test replays a sample's SEARCH block against the file content it targeted: if the similarity "
        "is close to the threshold and the difference is whitespace or line endings, our matching accepts"
        " it; otherwise the error tells the model to re-read the region and shows the closest lines. "
        "Fewer repeats of this signature per task.",
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
        task="Make the integration with {model} robust against edits whose SEARCH and REPLACE are identical: "
        "tell the model plainly that nothing changed and what to do next.",
        code_hints=(
            "src/core/diff/strategies/multi-search-replace.ts: Search and replace content are identical",
            "src/core/tools/ApplyDiffTool.ts",
        ),
        acceptance="The error for an identical edit says the file already contains the replacement and asks the "
        "model to re-read the file or move on; a test covers it. No mistake-limit stop follows this "
        "signature in new reports.",
    ),
    _rule(
        "mcp_timeout",
        "MCP tool timed out",
        CONFIGURATION,
        "An MCP server did not answer within its timeout. If the tool is slow by nature, raise the "
        "server's timeout in the MCP settings; if it hangs, the server needs fixing or restarting. "
        "The task waited the full timeout each time.",
        pattern=r"MCP error -32001|MCP.*timed out|Request timed out",
        task="Change the default MCP timeout handling or explain to the user which server timed out and how to"
        " raise its timeout.",
        code_hints=(
            "src/services/mcp/mcpConfigSchema.ts: timeout",
            "src/services/mcp/McpToolCatalog.ts: callTool",
            "src/services/mcp/McpHub.ts: updateServerTimeout",
            "src/core/tools/UseMcpToolTool.ts",
        ),
        acceptance="The timeout error shown to the user and returned to the model names the server, the tool and the"
        " timeout in seconds, and says where to change it; a test covers the message. If the samples show"
        " the same server timing out at the default every time, the default or the per-server setting is "
        "changed and new reports drop.",
    ),
    _rule(
        "auth_rejected",
        "Provider refused the credentials",
        CONFIGURATION,
        "{provider} answered 401/403: the API key or the account is not accepted for {model}. Check "
        "the key in the profile, the model's availability on the plan, and the base URL.",
        categories=("api_error",),
        pattern=r"\b40[13]\b|unauthori[sz]ed|forbidden|invalid api key|authentication",
        task="Change the default error handling or explain to the user: a 401/403 from {provider} must stop the "
        "retries and say which profile's key or plan is rejected.",
        code_hints=(
            "src/core/task/RetryHandler.ts: mustFailFast",
            "src/api/providers/base-openai-compatible-provider.ts",
            "src/core/task/RetryHandler.ts: buildErrorHeaderText",
        ),
        acceptance="A 401/403 is not retried with backoff; the user sees one error naming the provider and the "
        "profile, with a pointer to the API key setting. A test covers the fail-fast decision for the "
        "status codes in the samples.",
    ),
    _rule(
        "rate_limited",
        "Provider rate limit",
        PROVIDER,
        "{provider} rate-limited the requests for {model} (429). Set a request delay or a lower "
        "concurrency for this profile, or use a plan with a higher limit.",
        categories=("api_error",),
        pattern=r"\b429\b|rate limit|too many requests|quota",
        task="Handle, retry and surface {provider} rate limits: honour Retry-After, back off, and tell the "
        "user which setting reduces the rate.",
        code_hints=(
            "src/core/task/RetryHandler.ts: maybeWaitForProviderRateLimit",
            "src/core/task/RetryHandler.ts: calculateBackoffDelay",
            "packages/types/src/settings-defaults.ts: requestDelaySeconds",
        ),
        acceptance="A 429 with or without Retry-After waits the right time before the retry (unit test with the "
        "samples' headers or bodies), and the retry succeeds without the user's help when the limit "
        "clears. New reports show retries, not failed tasks.",
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
        task="Handle, retry and surface dropped connections to {provider}: retry transient drops, and after "
        "repeated failures tell the user the server looks down.",
        code_hints=(
            "src/core/task/RetryHandler.ts: backoffAndAnnounce",
            "src/core/task/RetryHandler.ts: calculateBackoffDelay",
            "src/api/providers/base-openai-compatible-provider.ts",
        ),
        acceptance="Single connection drops are retried with backoff and the task continues (a test with the "
        "samples' error texts as the thrown errors). A run of failures ends with one clear message naming"
        " the provider and its base URL. Nothing to fix in code if the samples show a server that was "
        "down.",
    ),
    _rule(
        "web_fetch_refused",
        "Web page refused or unreadable",
        PROVIDER,
        "The site answered web_fetch with an error status or a content type the tool does not read "
        "(PDF). Many sites block automated readers; nothing to fix unless a site you need fails "
        "every time.",
        pattern=r"web_fetch",
        task="Handle and surface web_fetch failures: the error must say why the page could not be read and "
        "what the model can do instead.",
        code_hints=(
            "src/core/tools/WebFetchTool.ts",
            "src/services/web/WebFetchService.ts: WebFetchService",
        ),
        acceptance="Each failure kind in the samples (HTTP status, unsupported content type, size over budget, "
        "network failure) has a test and an error text telling the model whether to retry, try another "
        "URL or continue without the page. Nothing to fix when a site blocks automated readers.",
    ),
    _rule(
        "rooignore_blocked",
        "Access blocked by .rooignore",
        CONFIGURATION,
        "A command or file access was blocked by a .rooignore pattern. If the model needs that "
        "access, narrow the pattern; otherwise tell the mode not to touch those paths.",
        categories=("rooignore", "tool_error"),
        pattern=r"rooignore|process\\?\.env",
        task="Change the default or explain to the user: say which .rooignore pattern blocked the access and "
        "how to allow it if it is needed.",
        code_hints=(
            "src/core/ignore/RooIgnoreController.ts: validateAccess",
            "src/core/ignore/RooIgnoreController.ts: validateCommand",
            "src/core/prompts/responses.ts: rooIgnoreError",
        ),
        acceptance="The error names the blocked path or command and the pattern that matched; the model is told not "
        "to retry the same access. A test covers the message. No repeated blocked accesses in one task in"
        " new reports.",
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
        task="Make the integration with {model} robust against runs of failed turns: find from the problems "
        "just before the stop what the model kept failing at, and fix that cause (usually another rule in"
        " this report).",
        code_hints=(
            "src/core/task/TaskApiLoop.ts: handleConsecutiveMistakeLimit",
            "src/core/tools/BaseTool.ts: consecutiveMistakeCount",
            "src/core/diagnostics/ErrorReporter.ts: reportMistakeLimit",
        ),
        acceptance="For the tasks in the samples, the problem that preceded the stop is identified and has its own "
        "fix (see its section). The mistake-limit message names the last failing tool and the repeated "
        "error. New reports for {model} show fewer stops.",
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
        task="Change the default or explain to the user why indexing failed: the error must carry the reason "
        "(embedder dimension, endpoint, model id) instead of a bare \"Code index\" event.",
        code_hints=(
            "src/services/code-index/service-factory.ts: findDimensionMismatch",
            "src/services/code-index/orchestrator.ts",
            "src/services/code-index/config-manager.ts",
            "src/services/code-index/embedders",
        ),
        acceptance="Every CODE_INDEX_ERROR capture sends the error message and the operation, and the settings view "
        "shows the same reason. A test covers the dimension mismatch path. New occurrences of this group "
        "carry a message.",
    ),
    _rule(
        "shell_integration",
        "Terminal shell integration unavailable",
        CONFIGURATION,
        "VS Code's shell integration did not start, so command output could not be read. Check the "
        "terminal profile (a shell VS Code can integrate with) or raise the shell integration "
        "timeout in the settings.",
        categories=("shell_integration",),
        task="Change the default or explain to the user: when VS Code shell integration does not start, say "
        "which terminal profile failed and how to fix it, and fall back cleanly.",
        code_hints=(
            "src/core/tools/ExecuteCommandTool.ts: SHELL_INTEGRATION_ERROR",
            "src/integrations/terminal/Terminal.ts",
            "src/integrations/terminal/BaseTerminal.ts",
        ),
        acceptance="The command still runs (fallback without integration) and the user sees one message naming the "
        "shell and the timeout setting. A test covers the fallback decision. New occurrences carry the "
        "shell name.",
    ),
    _rule(
        "settings_invalid",
        "Settings failed validation",
        CONFIGURATION,
        "A settings file (profiles, modes or MCP) did not match its schema and was ignored in part. "
        "Open the file named in the problem and fix or remove the invalid entry.",
        categories=("settings_invalid",),
        task="Change the default or explain to the user which settings entry failed validation, so it can be "
        "fixed instead of silently ignored.",
        code_hints=(
            "src/core/config/ProviderSettingsManager.ts: SCHEMA_VALIDATION_ERROR",
            "src/core/config/ContextProxy.ts: SCHEMA_VALIDATION_ERROR",
            "src/core/config/importExport.ts",
        ),
        acceptance="The validation failure names the file, the entry and the field; the user is told once. A test "
        "with an invalid entry covers it. New occurrences carry the schema name.",
    ),
    _rule(
        "model_list_empty",
        "Provider returned an empty model list",
        PROVIDER,
        "{provider} answered the model list request with nothing. Check the base URL and the key; a "
        "local server may have no model loaded.",
        categories=("model_list_empty",),
        task="Handle and surface an empty model list from {provider}: tell the user the base URL or key "
        "returns no models, and keep the last known list.",
        code_hints=(
            "src/api/providers/fetchers/modelCache.ts: getModels",
            "src/api/providers/fetchers/modelCache.ts: MODEL_CACHE_EMPTY_RESPONSE",
        ),
        acceptance="An empty answer keeps the cached list and shows the user which provider and URL returned "
        "nothing; a test covers it. Nothing to fix when a local server simply had no model loaded.",
    ),
    _rule(
        "exception",
        "Unhandled exception in the extension",
        SOFTWARE,
        "Our defect: the extension threw an error nothing handled. The sample's message and stack "
        "say where; file a fix with them.",
        categories=("exception",),
        task="Fix the unhandled exception: find the throwing code from the message and stack in the samples "
        "and handle the failure where it happens.",
        code_hints=(
            "src/core/diagnostics/ErrorReporter.ts",
            "src/core/task/TaskApiLoop.ts",
        ),
        acceptance="A test reproduces the exception from the samples' message and stack and passes after the fix; "
        "the failure is handled where it occurs (an error the user or model can act on), not swallowed. "
        "No new occurrences of this signature.",
    ),
    _rule(
        "diff_failed",
        "Edit not applied",
        MODEL,
        "{model}'s edit could not be applied. Read a sample: a SEARCH block that does not match is "
        "the model's, a crash inside the diff code is ours.",
        categories=("diff_error",),
        task="Make the integration with {model} robust against edits that could not be applied: first decide "
        "from the samples whether the model's edit was wrong or our diff code failed, then fix the side "
        "at fault.",
        code_hints=(
            "src/core/tools/ApplyDiffTool.ts: DIFF_APPLICATION_ERROR",
            "src/core/diff/strategies/multi-search-replace.ts",
            "src/core/prompts/tools/native-tools/apply_diff.ts",
        ),
        acceptance="The failure reason reaches the error report and the telemetry event (today the legacy event says"
        " only \"Diff not applied\"), so this group splits into diff_no_match, diff_identical or a crash of"
        " ours. A crash of ours gets a test and a fix.",
    ),
    _rule(
        "provider_error",
        "Provider error",
        PROVIDER,
        "{provider} answered the request for {model} with an error. The sample's error body and "
        "HTTP status say which; repeated identical errors are worth reporting to the provider.",
        categories=("api_error",),
        task="Handle, retry and surface this {provider} error: classify it from the error body and HTTP "
        "status, retry it if it is transient, and show the user the provider's own message if not.",
        code_hints=(
            "src/core/task/RetryHandler.ts: mustFailFast",
            "src/core/task/RetryHandler.ts: buildErrorHeaderText",
            "src/api/providers/base-openai-compatible-provider.ts",
        ),
        acceptance="The status and error body from the samples are covered by a test of the retry decision "
        "(transient: retried; permanent: one clear message). If the error is the provider's own fault and"
        " repeats, it is worth reporting to the provider; nothing to change in code then.",
    ),
)

UNCLASSIFIED_RULE = Rule(
    id="unclassified",
    title="Unclassified",
    classification=UNCLASSIFIED,
    mitigation="No rule describes this problem yet. Read the sample below; if it recurs, add a rule "
    "to services/problem_catalogue.py so the next report says whose fault it is.",
    task="Find out whose fault this problem is from the evidence (our code, the model, the provider or "
    "a setting), fix it on that side, and add a rule for it to the cloud's problem catalogue.",
    code_hints=(
        "self-hosted-cloudapi/src/services/problem_catalogue.py: CATALOGUE",
        "self-hosted-cloudapi/tests/test_problem_catalogue.py: EXAMPLES",
    ),
    acceptance="The cause is proven from the samples, fixed (or, for a provider or the model, handled), "
    "and a catalogue rule with a real example in tests/test_problem_catalogue.py classifies this "
    "signature, so the next report no longer lists it as Unclassified.",
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


def _fill(template: str, model: Optional[str], provider: Optional[str], tool: Optional[str]) -> str:
    values = _Blank()
    for key, value in (("model", model), ("provider", provider), ("tool", tool)):
        if value:
            values[key] = value
    return template.format_map(values)


def mitigation_for(rule: Rule, model: Optional[str], provider: Optional[str], tool: Optional[str]) -> str:
    return _fill(rule.mitigation, model, provider, tool)


def task_for(rule: Rule, model: Optional[str], provider: Optional[str], tool: Optional[str]) -> str:
    """The rule's one-sentence job for a coding agent, with the group's values."""
    return _fill(rule.task, model, provider, tool)


def acceptance_for(rule: Rule, model: Optional[str], provider: Optional[str], tool: Optional[str]) -> str:
    return _fill(rule.acceptance, model, provider, tool)


def explain(rule: Rule, category: str, tool: Optional[str], text: str) -> str:
    """Why ``rule`` claimed this occurrence, in one sentence an agent can check.

    Names the rule, the restrictions that held and the words its pattern found
    in the text, so a wrong classification can be argued with (and the rule
    fixed) instead of trusted.
    """
    if rule is UNCLASSIFIED_RULE:
        return (
            f"No rule in services/problem_catalogue.py matched category {category!r}, tool {tool or '-'!r} "
            "and this text, so it is Unclassified."
        )
    reasons = []
    if rule.categories is not None:
        reasons.append(f"the category is {category!r}")
    if rule.tools is not None:
        reasons.append(f"the tool is {tool!r}")
    if rule.pattern is not None:
        found = re.search(rule.pattern, text or "", re.IGNORECASE)
        reasons.append(
            f"the text contains {found.group(0)!r} (pattern {rule.pattern!r})" if found else f"pattern {rule.pattern!r}"
        )
    if not reasons:
        reasons.append("it matches any occurrence")
    return f"Rule {rule.id!r}, the first match in the ordered catalogue: " + ", ".join(reasons) + "."


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
