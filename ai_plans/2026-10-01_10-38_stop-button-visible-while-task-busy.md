# Stop button stays visible while the task is busy

Status: implemented on branch `fix/stop-button-while-busy` (not pushed). Webview only; the host
side (`ClineProvider.cancelTask`) already cancels in every state and rehydrates the task into a
`resume_task` ask.

## Touched files

- `webview-ui/src/components/chat/hooks/taskBusy.ts` (new): pure `isTaskBusy(lastMessage, isStreaming, answeredAskTs)`.
- `webview-ui/src/components/chat/hooks/useAskButtons.ts`: `answeredAskTs` state, `markLastAskAnswered`, derived `isTaskBusy`; `clearApprovalButtons` marks the answered ask.
- `webview-ui/src/components/chat/hooks/useChatComposer.ts`: a typed reply (`handleSendMessage`, not the queue path) marks the answered ask.
- `webview-ui/src/components/chat/ChatView.tsx`: passes `isTaskBusy` (instead of `isStreaming`) to `ChatTextArea`.
- `webview-ui/src/components/chat/ChatTextArea.tsx`, `ComposerActionButtons.tsx`: prop renamed `isStreaming` to `isTaskBusy`; the stop/queue logic and styling are unchanged.
- Tests: `hooks/__tests__/taskBusy.spec.ts` (new), `__tests__/ChatView.ask-state-machine.spec.tsx`, `__tests__/ChatTextArea.toolbar.spec.tsx`.

## Symptom

The composer's send button turns into a Stop button only while the LLM streams. While a terminal
command runs, an MCP tool call runs, a retry or rate-limit countdown ticks, or any other tool
executes, the Stop button disappears, so the user has no way to stop the task from the composer.

## What was happening

- `useAskButtons.ts:337` (`isStreaming`) is true only when the last combined message is partial,
  or the last `api_req_started` has no `cost` yet. The host fills in `cost` as soon as the LLM
  reply ends, which is before the tools of that reply run.
- `ChatView.tsx` passed exactly that flag to `ChatTextArea` (`isStreaming={isStreaming}`), and
  `ComposerActionButtons.tsx` rendered the stop square only when it was true.
- `isStreaming` also drives `sendingDisabled`-adjacent logic, chat row rendering
  (`chatRowPropsEqual`), `handleSecondaryButtonClick` (cancel while streaming) and the queue
  decision in `handleSendMessage`, so widening it would change much more than the button.
- The combined history (`modifiedMessages`) folds `command_output` messages into their `command`
  ask and `mcp_server_response` into their `use_mcp_server` ask (`consolidateCommands` in
  `packages/core/src/message-utils/consolidateCommands.ts`), so "the last message is an ask" read
  from it would wrongly say "waiting on the user" while a command runs. The raw `clineMessages`
  keep the real last message.

## Failure surface

| State of the current task                                                                                                             | Stop before | Stop after |
| ------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------- |
| LLM request streaming / partial message                                                                                               | yes         | yes        |
| Command running (`command_output` ask, or approved, no output yet)                                                                    | no          | yes        |
| MCP call running (`mcp_server_request_started` say)                                                                                   | no          | yes        |
| Retry countdown / rate-limit wait (`api_req_retry_delayed`, `api_req_rate_limit_wait`)                                                | no          | yes        |
| Auto-approved tool running (`isAnswered` ask, tool result say)                                                                        | no          | yes        |
| Task just created, first request not started (task message only)                                                                      | no          | yes        |
| Right after the user answers an ask, before the host's next message                                                                   | no          | yes        |
| Tool / command / MCP approval ask waiting                                                                                             | no          | no         |
| followup, completion_result, resume_task, resume_completed_task, api_req_failed, mistake_limit_reached, auto_approval_max_req_reached | no          | no         |
| No task                                                                                                                               | no          | no         |

## Fix

`isTaskBusy = isStreaming OR (a task exists AND it does not wait on the user)`, where "waits on
the user" is decided from the last raw message: a complete ask that the host has not answered
(`isAnswered`), that the user has not answered from this view (`answeredAskTs`), and that is not
non-blocking (`isNonBlockingAsk`, i.e. `command_output`). `isStreaming` keeps its meaning and its
other consumers; only the composer's stop/queue buttons switch to `isTaskBusy`.

The answer window: after an approval button (`clearApprovalButtons`) or a typed reply
(`handleSendMessage` when it actually posts an `askResponse`), the answered ask is still the last
message until the host sends the next one. `markLastAskAnswered` records its `ts`, so the task
reads as busy in that window (for a command this window lasts until the first output line).

Composer behaviour while busy but not streaming is the same as while streaming today: the round
button is Stop, typed text gets the queue button, and Enter still goes through
`handleSendMessage`, which queues (`sendingDisabled`, or `clineAsk === "command_output"`).

## Tests

- `taskBusy.spec.ts`: no task, streaming, each busy last message (task message, finished request,
  MCP call, retry, rate-limit, condense, tool result, `command_output`, partial ask, auto-approved
  ask) and each waiting ask (tool, command, MCP, followup, completion_result, resume_task,
  resume_completed_task, api_req_failed, mistake_limit_reached, auto_approval_max_req_reached),
  plus the answered-ask window.
- `ChatView.ask-state-machine.spec.tsx`: the `streaming` column became `busy` (what the composer
  receives as `isTaskBusy`); `command_output`, retry delayed, rate-limit wait, auto-approved ask,
  say after an ask now expect busy; new rows for `mcp_server_request_started` after an
  auto-approved MCP ask and for the task message alone; two new tests for the answer window
  (approve a command, then `command_output`, then a followup; and a typed reply to a tool ask).
- `ChatTextArea.toolbar.spec.tsx`: the stop and queue tests use the renamed prop.
- With the fix reverted (`isTaskBusy` returning `isStreaming`), 21 of the new or changed tests
  fail (10 in the ChatView spec, 11 in `taskBusy.spec.ts`); with the fix all 149 tests of the 5
  touched or related specs pass. `tsc --noEmit` (webview-ui), eslint on the touched files and
  `pnpm knip` exit 0.

## Notes / caveats

- A say that arrives after an ask which still waits (the "say text after an ask keeps the ask"
  characterization row) now reads as busy, so the Stop button shows next to the approval buttons.
  In practice the host emits such says only after the ask has been answered (for example from
  remote control), where busy is the right answer; trusting the stale `clineAsk` instead would
  hide Stop exactly there.
- `answeredAskTs` lives in the webview. If the webview is recreated while an approved command has
  produced no output yet, the Stop button stays hidden until the first output arrives.
- Clicking "Start New Task" on `completion_result` or "Terminate" on `resume_task` marks the ask as
  answered, so the Stop button may flash for the moment until the host clears the task.
- `isStreaming` still wins: if it is true the task is busy, exactly as the button behaved before.
- The host-invoked `secondaryButtonClick` still cancels only while streaming; during
  `command_output` it kills the command, which is the more precise action there.
