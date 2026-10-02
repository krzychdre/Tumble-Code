# Error reports: the extension side

Date: 2026-10-02
Branch: `feat/error-reports-extension` (off `main` at ad8def950)
Server side: implemented in parallel by another agent against the same wire contract (`POST /api/error-reports`).

## Why

Owner, 2026-10-02 (translated): "The Diagnostics tab carries nothing valuable. Record error details, provided the
user is logged in to the cloud (and only then). For good diagnosis we need details: model, context size, request
and response. The goal is a report of problems the user struggles with because of our software or a model
mismatch, and later an attempt to mitigate them. Quantitative analysis alone is not enough. For users not logged
in to the cloud: we store NOTHING."

The `Exception` event from #754 (`ai_plans/2026-10-02_cloud-diagnostics-page.md`) gives counts and a message. It
cannot explain why a model dropped a parameter or why a request overflowed: that needs the model, its configured
context window, the request and the raw answer.

## Evidence (the owner's synced conversations)

What the reports must be able to explain:

| Count | Message in the transcript                                                              | Category here       |
| ----- | -------------------------------------------------------------------------------------- | ------------------- |
| 58    | `Roo tried to use apply_diff without value for required parameter 'path'. Retrying...` | `invalid_tool_call` |
| 51    | `MODEL_NO_ASSISTANT_MESSAGES` / "The language model did not provide any assistant ..." | `empty_response`    |
| 9     | MCP request timed out                                                                  | `tool_error`        |
| 8     | `OpenAI completion error: Connection error.`                                           | `api_error`         |
| 4     | `This model's maximum context length is N tokens. However, you requested N output`     | `context_overflow`  |
| -     | read_artifact `size out of range ... Received NaN`                                     | `tool_error`        |
| -     | PDF extraction `Cannot destructure property 'platform' of 'navigator'`                 | `tool_error`        |
| many  | read_file ENOENT on hallucinated paths                                                 | `tool_error`        |
| 7     | Consecutive Mistake Error                                                              | `mistake_limit`     |
| 100   | Diff Application Error                                                                 | `diff_error`        |

## Design

Three layers, following the dependency directions in `docs/architecture.md` (src -> cloud -> types):

- `packages/types/src/error-report.ts`: Zod schema `errorReportSchema`, type `ErrorReport`, the categories and
  the limits (summary 500, errorMessage/toolResult 8000, message 16000, 6 messages, body 256 KB). The field names
  are the fixed wire contract shared with the server.
- `packages/cloud`: `CloudTelemetryClient.sendErrorReport(report)` validates against the schema and posts through
  the same private `fetch` as the telemetry events (Bearer session token, 30 s timeout, 5xx/429/network failure to
  the retry queue as type `telemetry`). It returns at once when telemetry is switched off by
  `TUMBLE_CODE_DISABLE_TELEMETRY` / `ROO_CODE_DISABLE_TELEMETRY` or the user is not authenticated.
  `CloudService.isErrorReportingEnabled()` (never throws) and `CloudService.sendErrorReport()` wrap it.
- `src/core/diagnostics/`:
    - `errorReportFormat.ts`, pure: `isContextOverflowError` (the loop's own `checkContextWindowExceededError`
      plus message patterns for providers that wrap the SDK error and lose the status; rate-limit wording and
      401/403/429 excluded), `apiErrorBody`, `scrubSecrets`, `toReportMessages`, `capErrorReport`,
      `finalizeErrorReport`.
    - `ErrorReporter.ts`: the gate, the per-task capture state, the snapshot and the entry points.

### Gating (privacy)

`isErrorReportingActive()` = `CloudService.hasInstance() && CloudService.instance.isErrorReportingEnabled()`.
Every entry point checks it first. The per-task capture state lives in a module `WeakMap` keyed by the task and is
created only while the gate is open; it is dropped when a later call finds the gate closed (sign-out). Without a
session: no snapshot, no stored request reference, no WeakMap entry, nothing queued. `captureApiRequest` takes a
thunk, so even the request record is not built. The gate is checked again right before sending. The unit test
"builds nothing, stores nothing and sends nothing" pins this (the model getter, token usage and mode are never
read).

### Safety

Every entry point is wrapped in a try/catch; the snapshot is read synchronously at the moment of the failure and
the rest (mode, scrubbing, cap, send) runs in a background promise whose rejection is logged at debug level.
Nothing is awaited by the task loop.

### Snapshot (read live, so a mid-task mode switch is described correctly)

Read at the moment of the failure from the task: `task.api.getModel()` (id, `contextWindow`), max output tokens
via `getModelMaxOutputTokens` with the task's live `apiConfiguration`, provider, `getTokenUsage().contextTokens`
(the figure the UI shows), `apiConversationHistory.length`, app version / editor / platform from the provider's
`appProperties`, and the mode via `getTaskMode()`. Nothing about the model is cached; the reporter test switches
the model between two reports and expects both to be described correctly.

Request (kept by reference by `captureApiRequest` in `TaskApiLoop.attemptApiRequest`, only while active): system
prompt length + sha256 (never the text), tool names sent, params (mode, tool protocol, temperature, max tokens,
reasoning effort, tool choice), and the tail of the conversation exactly as sent (`cleanConversationHistory`):
last 6 messages, each JSON-stringified and cut to 16000 chars.

Response: the streamed assistant text and reasoning (`TaskStreamProcessor` getters), the tool calls with their RAW
argument strings (read from `NativeToolCallParser.getStreamingToolCallRaw` just before finalize drops them, and
from the legacy `tool_call` chunk), the stop reason (`finish_reason` chunk), usage, and for API errors the error
body (SDK `error`, `body`, `responseBody` or `response.data`; never headers).

### Size cap and scrubbing

`finalizeErrorReport`: scrub every string (bearer tokens, `api_key: ...` style pairs, key/token URL parameters,
`sk-...`, `AIza...`, GitHub, Slack and AWS key shapes), then the field limits, then the 256 KB cap: oldest
messages go first, then the long fields are halved until it fits, and as the last resort the request part is
reduced to the system prompt length. At most `MAX_REPORTS_PER_CATEGORY_PER_TASK` (25) reports per category and
task: the 58 identical missing-path calls do not need 58 copies of 256 KB.

## Capture points (one owner per failure)

| Site                                                                                             | Category                                                          |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `src/core/task/TaskApiLoop.ts` `attemptApiRequest` first-chunk catch (~1527)                     | `api_error` / `context_overflow` (each failed attempt)            |
| `src/core/task/TaskApiLoop.ts` `handleStreamError` (~1218)                                       | `api_error` / `context_overflow` (mid-stream; same error skipped) |
| `src/core/task/TaskApiLoop.ts` `handleEmptyAssistantResponse` (~1124)                            | `empty_response` (every occurrence, not only the 2nd)             |
| `src/core/task/TaskApiLoop.ts` no-tool-call branch, `consecutiveNoToolUseCount >= 2` (~954)      | `empty_response` (`MODEL_NO_TOOLS_USED`)                          |
| `src/core/task/TaskApiLoop.ts` `handleConsecutiveMistakeLimit` (~489)                            | `mistake_limit`                                                   |
| `src/core/assistant-message/presentAssistantMessage.ts` probe around a complete block (~154/170) | `tool_error`, `diff_error`, `invalid_tool_call`, `mistake_limit`  |
| `src/core/task/TaskMessageLog.ts` tool_result id repair callback (~252, ~356)                    | `invalid_tool_call`                                               |

The tool-call probe: `beginToolCallProbe` before a complete `tool_use` / `mcp_tool_use` block runs,
`finishToolCallProbe` after it (in a `finally`). While it runs, these feed it:

- `Task.recordToolError` (~1603): the error text every mistake-counting site records;
- `TaskAskSay.say` for `error` and `diff_error` rows (~628): covers read_file ENOENT, PDF extraction, MCP
  timeouts through `handleError`, read_artifact errors;
- the kind: `sayAndCreateMissingParamError` (~732), the guards in `presentToolUse` (missing id, malformed args,
  invalid tool use, unknown tool), BaseTool's argument parse failure (~198) -> `invalid_tool_call`;
  `stopRepeatedToolCall` (`toolUseGuards.ts` ~271) -> `mistake_limit`.

At the end the call counts as failed when anything was noted or its tool_result is an error (`is_error`, starts
with `Error`, or is a `{"status":"error"}` envelope, which covers MCP `isError` results). Category: the noted kind,
else `diff_error` for an edit tool (apply_diff, edit, search_and_replace, search_replace, edit_file, apply_patch)
or a `diff_error` row, else `tool_error`. A rejected tool (`didRejectTool`) or an aborted task sends nothing.

`exception`: the existing `Exception` telemetry event stays the owner of exceptions. No site sends an `exception`
report in this change, because every failure that also raises `captureException` (provider errors, the mistake
limit, the tool_result id repair) already has its own category above, and sending both would double-report. The
category exists in the schema for later sites with a task context and no other owner.

## Privacy

`PRIVACY.md` gains an "Error Reports" item: signed in, a report includes the failing request's conversation tail,
the model's response, tool arguments and results, and so file paths and file contents; no API keys or headers,
secrets scrubbed; nothing when not signed in.

## Tests

- `packages/cloud/src/__tests__/TelemetryClient.errorReport.spec.ts`: path, method, headers, body; no fetch when
  unauthenticated or with either env switch; schema rejection; 500/503/429 and network failure go to the retry
  queue, 413 does not.
- `src/core/diagnostics/__tests__/errorReportFormat.spec.ts`: context overflow patterns (owner's vLLM message,
  Anthropic, Gemini, Bedrock, Mistral) and negatives (429 "tokens per minute", quota, 401, connection error),
  error body extraction, scrubbing, truncation, the message tail, the 256 KB cap, schema validity after finalize.
- `src/core/diagnostics/__tests__/ErrorReporter.spec.ts`: the gate (signed out: nothing read, built or sent),
  context_overflow snapshot, one report per error object, live model after a switch, empty response and mistake
  limit, missing param -> invalid_tool_call with raw streamed args, tool_error / diff_error, no report for a
  working or rejected call, the per-category cap, never throws.
- Existing specs of every touched module (assistant-message, TaskApiLoop, TaskStreamProcessor,
  validateToolResultIds, TaskMessageLog, BaseTool, applyDiffTool, Task, layering): green.

## Owed

- VSIX rebuild (nothing is live until then) and the server side merged and deployed.
- Not covered: tool calls still streaming when the stream fails mid-way (their raw arguments are captured only at
  `tool_call_end`); failures in the text-only completion fallback (outside `presentAssistantMessage`).
