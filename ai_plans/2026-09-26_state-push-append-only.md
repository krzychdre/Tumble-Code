# Send a new chat message alone to a view that accepts it (CORE-R7 step 4, second half)

Branch `perf/state-push-append-only`, stacked on
`perf/state-push-task-history-when-changed`. Plan item: CORE-R7 in
`ai_plans/2026-09-24_refactor/04-extension-core.md` (branch
`docs/refactor-plan-2026-09-24`): "incremental messageAdded pushes instead of
full state", which the plan marked BLOCKED on decision 19 (the CLI reads
`clineMessages` from state pushes). The owner's decision for this branch:
capability-gated, the CLI keeps today's pushes.

## Root cause (measured)

`TaskHistory.addToClineMessages` (`src/core/task/TaskHistory.ts`) calls
`postStateToWebviewWithoutTaskHistory()` for every message added to a
foreground task, so every new message re-sends the whole `clineMessages`
list (plus about 6 KB of other state). The webview receives per task what
`ui_messages.json` used to be written before #463.

Replay on the owner's real data (`qub-it.tumble-code/tasks/*/ui_messages.json`,
1,054 tasks, 138,318 messages; a push per added message = the message list up
to it plus 6,075 bytes of state, as measured on branch 1; the first message of a
task is a full push in both columns):

| per task         |    before |   after |
| ---------------- | --------: | ------: |
| total, all tasks |  73.43 GB | 1.24 GB |
| median           |   5.36 MB | 0.65 MB |
| p90              | 108.11 MB | 2.81 MB |
| max              |  5,383 MB | 18.4 MB |

Most of what remains is the 6 KB state that still travels with each message
(0.84 GB of the 1.24 GB). Request-boundary full pushes (`TaskApiLoop` after the
request row, `TaskStreamProcessor` after the stream) are unchanged and not in
either column.

Scripted cycle (`TaskHistory.turn-counts`, 300 earlier messages of 1.7 KB, one
request: request row, reasoning, text, tool ask): 4 state pushes carrying
2,097,383 bytes of messages become 4 `messageAdded` carrying 616 bytes of
messages (plus the state each).

## Design

- Capability: the webview's `webviewDidLaunch` carries `acceptsMessageAdded: true`
  (`WEBVIEW_DID_LAUNCH_MESSAGE`, used by both launch sites). The provider keeps
  it per webview: `resolveWebviewView` clears it, every launch sets it from the
  message. The CLI's launch (`apps/cli/src/agent/extension-host.ts`) has no flag,
  pinned by its existing test (`{ type: "webviewDidLaunch" }` exactly).
- What the view holds: every state push with messages (`postStateToWebview`,
  `postStateToWebviewWithoutTaskHistory`) records the live array it posted and
  its length at post time (`postMessage` serializes at once).
- `ClineProvider.postClineMessageAdded(task, message)` sends one `messageAdded`
  (message, `messageIndex`, `sourceTaskId`, and the state without
  `clineMessages`, `clineMessagesSeq`, `taskHistory`) only when: the view
  accepted it, the task is the current one, the view was sent this very array,
  and the recorded length is at least the message's index. Otherwise it returns
  false and `addToClineMessages` sends the full push as before. The check runs
  again after the state is built; if the view changed meanwhile the full push
  is sent instead. Ordering follows: an append is only ever sent after the
  full push that established the list, a later full push replaces the list,
  and a message a full push already carried is replaced in place by ts.
- Webview reducer (`messageAdded`): merges the state part, appends the message
  (or replaces a known ts); a message of another task, or an index that is not
  the list's length, sets `clineMessagesResyncRequested`, and the provider
  posts `resyncClineMessages` once; the host answers with a full push.
- State audit: the per-message push carried the whole state. Fields that can
  change together with a new message and have no message of their own:
  `currentTaskTodos` (update_todo_list), `messageQueue`, `currentTaskItem`,
  `subagents`, `memoryActivity`, settings changed by tools. So the state part
  is the full state minus the list, history and sequence number, exactly what
  `postStateToWebviewWithoutClineMessages` sends (about 6 KB).
- In-place edits audit (every assignment to a message field in `src/`): all are
  followed by `updateClineMessage` or an explicit full push, except two that
  relied on the next added message's full push:
    1. `TaskAskSay`: the last follow-up marked `isAnswered` (a follow-up answered
       by auto-approval or remotely kept its suggestion buttons);
    2. `createAbortStreamFn`: the partial row set to `partial: false` and the
       request row's cost and failure text (then an `api_req_failed` ask is
       added).
- Both edits now call `TaskHistory.postEditedClineMessage`, which posts
  `messageUpdated` only to a view that accepts `messageAdded` and holds this
  list, with no Message event and no cloud capture, so the CLI and the bridge
  see nothing new.

## What stays unchanged

- CLI: receives the same messages as before (no flag, so every add is a full
  push; `postEditedClineMessage` posts nothing to it). `MessageProcessor`,
  `JsonEventEmitter` and the transcript reducer are untouched; stream-json and
  print output cannot change. `TaskHistory.turn-counts` keeps the old numbers for
  this path (4 full pushes per cycle).
- Full pushes: task switch, resume, `overwriteClineMessages`, condense,
  delete/edit, mode switch, the request-boundary pushes, cloud-event pushes.
- Background and subagent tails (`messageUpdated` with `sourceTaskId`).
- Message events and TASK_MESSAGE captures (pinned: created 4, updated 60,
  captures 4 per cycle; no event for the edit posts).
- Cloud bridge: reads task events, never webview messages.

## Tests

- `ClineProvider.taskHistory.spec.ts`: messageAdded per message with the
  trimmed state; CLI launch (no flag, flag false) gets nothing; new task,
  replaced list, non-current task, one message behind, new webview, view
  replaced mid-build; `postEditedClineMessage` only to an accepting view that
  holds the list; `resyncClineMessages`.
- `TaskHistory.turn-counts.spec.ts`: accepting view 0 state pushes and 4
  messageAdded, bytes independent of the conversation length, same cloud
  contract; answered follow-up posted without a Message event; the previous
  pins now titled as the CLI path.
- `TaskStreamProcessor.usage-drain.spec.ts`: abortStream posts the finished
  partial and the request row.
- Webview table (`extensionMessageCases.ts`): append, replace, first message,
  gap and other task (both post `resyncClineMessages`); launch message flag.
- Routing snapshots: `webviewDidLaunch` (with and without the flag),
  `resyncClineMessages`. Message-type list spec in `packages/types`.
- React Compiler bailouts: 8, unchanged (baseline).

## Residual risks

- A future in-place edit of an earlier message without a post of its own would
  reach an accepting view only at the next full push (request boundary, task
  switch). The audit above is by grep of field assignments; edits through
  other patterns would not show up.
- The webview rejects the message list of a full push whose sequence number is
  older than one it applied. If such a push was the one that carried a message
  (full-push fallback), the host believes the view has it; the next
  `messageAdded` then finds a gap and the view asks for the whole list, so the
  view heals at once instead of at the next full push.
- Each added message still builds the whole state (one `getState`, as before);
  only the bytes and the webview's work shrink. Dropping the state part would
  need the audit above turned into dedicated messages.
