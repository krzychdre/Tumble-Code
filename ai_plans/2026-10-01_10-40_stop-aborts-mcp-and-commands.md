# Stop cancels an in-flight MCP call; command and loop paths verified

Status: done on branch `fix/stop-aborts-mcp-and-commands` (not pushed). Extension host side only; the webview
side (showing the Stop button during every operation) is a separate, parallel change.

## Touched files

- `src/core/tools/taskAbortSignal.ts` (new): `runWithTaskAbortSignal(task, run)`, an AbortSignal that fires on
  the task's abort.
- `src/services/mcp/McpToolCatalog.ts`: `McpRequestOptions { signal }`; `callTool` and `readResource` pass the
  signal to `client.request`.
- `src/services/mcp/McpHub.ts`: the two forwarders take and pass the same options.
- `src/core/tools/UseMcpToolTool.ts`: the call runs under the task's abort signal; on abort the execution row is
  ended with an `error` status ("Cancelled").
- `src/core/tools/accessMcpResourceTool.ts`: the resource read runs under the same signal.
- Tests: `src/core/tools/__tests__/useMcpToolTool.spec.ts`, `src/services/mcp/__tests__/McpToolCatalog.spec.ts`,
  `src/integrations/terminal/__tests__/ExecaTerminal.spec.ts`.

## Symptom

The user presses Stop while the task is busy and expects the work to stop at once and the task to wait for input.
For an MCP tool call it did not: the server kept working on the request.

## What was happening

1. `ClineProvider.cancelTask` (`src/core/webview/ClineProvider.ts:1946`) sets `abortReason = "user_cancelled"`,
   cancels the HTTP request, starts `task.abortTask()` without awaiting it, waits at most 3 s for
   `isStreaming === false || didFinishAbortingStream || isWaitingForFirstChunk`, then rehydrates the task (the UI
   gets the `resume_task` ask).
2. `abortTask` (`src/core/task/TaskLifecycle.ts:581`) runs `prepareAbort` synchronously (sets `abort = true`,
   emits `TaskAborted`, line 612 and 621) and then `cleanupAbort`, whose first step is `dispose()`
   (line 848), which calls `TerminalRegistry.releaseTerminalsForTask` (line 913).
3. While a tool runs, the loop sits in `TaskApiLoop.finalizeStreamAndProcessResults` at
   `pWaitFor(() => userMessageContentReady || abort)` (`src/core/task/TaskApiLoop.ts:882`) with
   `isStreaming === true`. On abort this poll returns, `processStream` returns, and the `finally` at line 629 sets
   `isStreaming = false`. So `cancelTask` was never held by a slow tool; the loop does not await the tool itself
   (`presentAssistantMessage` runs it without the loop awaiting it).
4. The MCP call is the gap. `UseMcpToolTool.executeToolAndProcessResult` awaited
   `McpHub.callTool` -> `McpToolCatalog.callTool` (`src/services/mcp/McpToolCatalog.ts:158` before the change),
   which called `client.request(..., CallToolResultSchema, { timeout })` with no signal. Nothing told the server
   to stop, so the work (and its side effects, for example a browser automation) ran on until it finished or the
   server timeout (60 s by default) hit. When the result finally arrived, the dead tool instance posted
   `mcpExecutionStatus` "output" and "completed" for its `executionId` (the ask's message timestamp, the same row
   the rehydrated chat shows), so the user saw a result the model never received. `say()` then threw on the
   aborted task and `handleError` swallowed it (`src/core/assistant-message/toolCallbacks.ts:263`).
5. The installed SDK (`@modelcontextprotocol/sdk` 1.30.1, `dist/esm/shared/protocol.js`, `request()`) supports
   `options.signal`: when it aborts, the SDK sends `notifications/cancelled` with the request id to the server,
   drops the response handler and rejects the pending promise at once. A signal that is already aborted throws
   before anything is sent.

## Failure surface

| Operation on Stop                 | Before                                                               | After                                                                              |
| --------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| LLM request                       | aborted (`cancelCurrentRequest`)                                     | unchanged                                                                          |
| MCP `tools/call` in flight        | server keeps working up to its timeout; late result shown in the row | server gets `notifications/cancelled`; await rejects at once; row ends "Cancelled" |
| MCP `resources/read` in flight    | same as above                                                        | same as above                                                                      |
| MCP call starting after the abort | sent to the server                                                   | not sent (signal already aborted)                                                  |
| Command, execa backend (CLI too)  | process group SIGKILLed on release; await settles in about 60 ms     | unchanged, now pinned by a test                                                    |
| Command, VS Code terminal         | Ctrl+C at once, re-sent twice 500 ms apart                           | unchanged (see caveats)                                                            |
| Task loop and `cancelTask` wait   | released by the `abort` term of the poll                             | unchanged                                                                          |

## Fix

- `runWithTaskAbortSignal` creates an AbortController, aborts it on `TaskAborted` (or at once when `task.abort` is
  already set) and removes the listener when the work settles. This is the same mechanism
  `RunParallelTasksTool` already uses, but it fires on every abort, not only on a user cancel: once the task is
  aborted nobody can receive the MCP result, so finishing the call is wasted work in every case.
- `McpToolCatalog.callTool` and `readResource` take an optional `{ signal }` and pass it to `client.request`;
  `McpHub` forwards it.
- `UseMcpToolTool` and `AccessMcpResourceTool` run their request under that signal. On abort the rejection goes
  to `handleError`, which is silent for an aborting task, exactly like any other tool that fails during abort.
  `UseMcpToolTool` additionally posts an `error` execution status ("Cancelled") so its row stops showing
  "running". No conversation content changes, so prompts, weak models and mode switches are unaffected.
- The CLI sends the same `cancelTask` message into the same `ClineProvider.cancelTask`, so it gets the fix once its
  bundled extension is rebuilt. No CLI UI change.

## Tests

- `useMcpToolTool.spec.ts`, new `cancellation (Stop)` block: the call receives an AbortSignal; aborting the task
  aborts it, the tool returns with no tool result and no `mcp_server_response`, the last status is
  `error: "Cancelled"` and the listener is removed; a call that starts after the abort gets an already aborted
  signal; a normal call leaves the signal untouched and removes the listener. The mock task is now an
  EventEmitter, like the real `Task`; two `callTool` argument assertions gained the options argument.
- `McpToolCatalog.spec.ts`: the signal reaches `client.request` for both requests; and an end-to-end test with a
  real SDK `Client` and `Server` over `InMemoryTransport`: aborting rejects in under a second and the server's
  handler sees its own `extra.signal` abort (it really received `notifications/cancelled`).
- `ExecaTerminal.spec.ts`: a real `sleep 30` in an execa terminal owned by a task; `releaseTerminalsForTask` (what
  `dispose` calls) makes the awaited promise settle in about 60 ms with a non-zero exit and leaves the terminal
  idle.
- Revert proof: with the four source files restored from `main` (specs kept), 7 tests fail (the 5 new MCP tests,
  plus the 2 updated argument assertions); the real-SDK test hangs until the test timeout. With the
  `terminal.process?.abort()` line in `TerminalRegistry.releaseTerminalsForTask` disabled, the new execa test
  times out. Restored, all pass.
- Runs: the five touched or related specs (`useMcpToolTool`, `McpToolCatalog`, `McpHub`, `ExecaTerminal`,
  `TerminalRegistry`) 163 passed; an earlier run of `McpHub`, the three `presentAssistantMessage-*` specs and `checkpointed-tools` 244 passed;
  `tsc --noEmit` and eslint on the touched files clean.

## Notes and caveats

Operations that still do not stop at once on Stop (none of them holds the task loop or the UI, see point 3; they
only keep working in the background and their late result is dropped):

- VS Code terminal command that ignores Ctrl+C: after three Ctrl+C sends (about 1 s) the code gives up and the
  command keeps running in the terminal. Killing it would need the command's process tree, which the VS Code
  terminal does not expose; the execa backend kills the whole process group instead.
- Execa command whose grandchild left the process group (`setsid`, a daemon) and still holds stdout: the output
  loop only ends when that pipe closes.
- `web_fetch` and `web_search`: own 10 s timeout per request (`WEB_TOOLS_DEFAULTS.REQUEST_TIMEOUT_MS`), no task
  signal. Cheap to thread later (combine with `AbortSignal.any`), small gain.
- `codebase_search`: embedding request and Qdrant query have no signal.
- `generate_image`: the OpenRouter image request has no signal, so a cancelled generation is still paid for.
- `search_files`: the ripgrep runner already accepts a `signal`, but `SearchFilesTool` does not pass one;
  `list_files` has none. Both are usually short.
- An MCP server that ignores `notifications/cancelled` keeps working; the client side still returns at once.
- The rehydrated chat row for a cancelled MCP call shows "Cancelled" only while its component is mounted; the
  status is not persisted (unchanged behaviour for every status).
