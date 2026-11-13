# D11: one event stream in the CLI (slice 1: print mode reads the transcript reducer)

Roadmap item D11 (`ai_plans/2026-09-27_simplification-roadmap.md`, section 3): "Four readers of the same
messages in the CLI (`MessageProcessor`/`StateStore`, `TranscriptReducer`, `OutputManager`,
`JsonEventEmitter`, ~2,700 lines). Fix: let `TranscriptReducer` produce the one event stream; derive print
and JSON output from it." Effort L, so this branch delivers the first complete, mergeable slice and leaves a
plan for the rest.

Branch: `refactor/d11-cli-one-event-stream` (off `main` @ `39144534d`).

## 1. How the CLI reads the extension's messages today (main @ 39144534d)

### What the core sends

The CLI view never takes the single-message post (`TaskMessageLog.addToClineMessages`,
`postClineMessageAdded` returns false for it), so:

- every NEW message arrives as a `state` push carrying the WHOLE `clineMessages` array;
- every change of an existing message (a partial growing, a partial finalized in place, a price written
  into `api_req_started`) arrives as `messageUpdated` with that one message.

The delivery quirks every reader has to survive, each learned the hard way (plan docs in `ai_plans/`):

| Quirk                                                                                                                                                                                                               | Where it was proven                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| A state push replays the whole array, so every old message is delivered again and again, including an abandoned partial.                                                                                            | `2026-09-21_cli-answer-lost-in-dynamic-tail.md`, `2026-09-21_cli-answer-rendered-twice-interleaved-reasoning.md` |
| A restarted stream arrives as a NEW partial under a new ts that repeats the whole accumulated text (the core continues a partial in place only while it is the last message; interleaved reasoning breaks that).    | `2026-09-21_cli-answer-rendered-twice-interleaved-reasoning.md`                                                  |
| One command's output is split: first chunk as a partial, the non-blocking `ask: command_output` lands after it, the completed output is appended under a new ts; compression means it may not start with the chunk. | `2026-09-22_cli-bash-row-loses-its-command.md`                                                                   |
| Models (GLM) repeat the whole answer inside `completion_result`.                                                                                                                                                    | `2026-08-07_cli-completion-result-dedupe.md`                                                                     |
| The first `say: text` of a new task is the prompt echo.                                                                                                                                                             | `2026-08-05_cli-duplicate-greeting-fix.md`                                                                       |
| A resumed task's history arrives in one push; an old ask in it was answered long ago.                                                                                                                               | CLI-9 step 3b (#438)                                                                                             |

### The four readers

| Reader                                                 | Lines             | Fed by                                                                                                                            | What it derives                                                                                                                                                                                                    | Used by                                                                     |
| ------------------------------------------------------ | ----------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `MessageProcessor` + `StateStore` (+ `agent-state.ts`) | 482 + 415 (+ 463) | the client's listener, after activate: `state` (stores the array) and `messageUpdated` (replaces by ts)                           | agent loop state from the LAST message (`detectAgentState`), events `stateChange`, `waitingForInput`, `taskCompleted`, `streamingStarted/Ended`, `modeChanged`, and `message` = the LAST message of each push only | ask dispatcher, run loop, TUI, JSON emitter, print mode (until this branch) |
| `TranscriptReducer` (+ `TranscriptReader`)             | 858 + 72          | every extension message, from host construction on (the reader is fed before the client)                                          | transcript rows (`TUIMessage`) and store effects; walks the whole array of each push                                                                                                                               | TUI store (one sink per reader)                                             |
| `OutputManager` (print mode)                           | 463               | the client's `message` and `messageUpdated` events, plus `taskCompleted`                                                          | stdout text: `[assistant]`, `[reasoning]`, `[command output]` streams with append-only deltas by ts, `[error]` on stderr, `[task complete]`                                                                        | extension host (print mode only)                                            |
| `JsonEventEmitter`                                     | 945               | the client's `message`, `messageUpdated`, `stateChange`, `taskCompleted`, `error`; plus `commandExecutionStatus` via stdin-stream | NDJSON / final JSON: `user`, `assistant`, `thinking`, `tool_use`, `tool_result`, `error`, `result` events keyed by ts, text deltas and structured deltas for partial tool asks, cost                               | `run.ts` JSON modes, stdin stream protocol                                  |

### Where their logic duplicates

| Concern                       | TranscriptReducer                                                          | OutputManager (before this branch)                       | JsonEventEmitter                                                                  |
| ----------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Dedupe of repeated deliveries | `seenMessageIds`, stale-partial drop, replay keeps markers                 | `displayedMessages` by ts                                | `seenMessageIds` by ts (final only)                                               |
| Partial then final            | row replaced on finalization, debounced partials in the store              | `streamedContent` delta by ts, newline on final          | `previousContent` delta by ts, `done: true` on final                              |
| Restarted stream (new ts)     | merged into the row that carries it (`mergedStreamIds`)                    | printed again under a new header                         | a second event stream under the new id                                            |
| Command output                | one row per execution (`pendingCommand`, `commandRowId`)                   | printed per ts (split output printed twice)              | correlated to the command ask ts (`activeCommandToolUseId`), status-driven chunks |
| Reasoning                     | `thinking` rows, own stream class                                          | `[reasoning]` stream                                     | `thinking` events, delta key offset by 1e9                                        |
| Prompt echo                   | first `say: text` per cursor, not while resuming                           | first `say: text` while nothing was displayed            | first `say: text` after a NO_TASK to task transition, emitted as `user`           |
| Completion                    | `completion_result` say deduped against the answer; ask becomes a tool row | `completionResultStreamed` flag, `[task complete]`       | `completionResultContent`, `lastAssistantText` fallback, `result` event           |
| Which messages it sees        | every message of every push                                                | only the last message of a push (client `message` event) | only the last message of a push (client `message` event)                          |

The last row is the root of two print/JSON bugs pinned by the characterization (below): a message that is
not the last one of the push that brings it, and is never updated afterwards, is never shown; and a
resumed task prints (or emits) whatever message happens to end its history.

## 2. The slice: print mode reads the transcript reducer

### Why this slice

- Duplication removed vs risk: `OutputManager` re-implemented, less well, what the reducer already does
  (dedupe, prompt echo, completion dedupe, restarts, command output). Its whole message-reading half goes
  away. Print mode is human-facing text, not a protocol, and had no spec at all.
- JSON first was rejected: its events are keyed by ts and consumers correlate on them, it streams
  structured deltas of PARTIAL asks (the reducer drops partial asks entirely), and it keeps ids that the
  reducer merges. Deriving it from reducer rows cannot be byte-identical; it needs the lower stage
  described in section 3.

### Design

- `agent/transcript-printer.ts` (new): `TranscriptPrinter implements TranscriptSink`. It keeps its own
  view (rows via `applyAddMessage`, todos), reports `isLoading: true` and `isResumingTask: false`, and
  writes each `addMessage` row:
    - `text` and `completion_result` say rows as `[assistant]`, `reasoning` as `[reasoning]`,
      `command_output` as `[command output]`: header and text when the row appears, then only what was
      appended, and a line break when the row is final (the old byte format exactly);
    - a row that changes while another row ends the output is written again below, whole (never appended
      in the wrong place); an older, shorter text of a row further up (a replayed abandoned partial) is
      ignored;
    - `error` rows once, on stderr; the completion ask row writes `[task complete]` (with the ask's own
      text only when no completion text was printed);
    - tool rows, MCP responses and auto-approved asks print nothing: the ask dispatcher prints asks as
      it answers them, as before.
- `isLoading: true` always: in print mode nothing written can be taken back, so there is no "already in
  scrollback" window to protect; merging a restarted stream into its row is always right, and the
  printer's "write it again below" rule covers the row no longer being at the end.
- Resume: `ExtensionHost.resumeTask` calls `printer.beginHistoryReplay()`. The reducer still reads the
  history (so the old prompt consumes the prompt-echo rule and old rows count as seen), the printer writes
  nothing until the reducer's `setHasStartedTask` (emitted only for the resume asks). The view keeps
  `isResumingTask: false` on purpose, so the replayed old prompt is the one taken as the echo.
- `ExtensionHost`: attaches the printer to `client.transcript` in the constructor when output is enabled
  (the TUI and JSON modes pass `disableOutput`, so the TUI keeps the reader's single sink). The client's
  `message`/`messageUpdated` events now only feed the debug log (the first-partial set moved into the
  host); the `taskCompleted` print handler is gone.
- `OutputManager` shrinks to a writer (`output`, `outputError`, `writeRaw`, `disabled`). Its dead API
  (`isAlreadyDisplayed`, `isCurrentlyStreaming`, `getCurrentlyStreamingTs`, `streamingState`, `clear`,
  `markDisplayed` and the first-partial trio) is gone; `AskDispatcher` no longer calls `markDisplayed`
  (its only effect was on the prompt-echo count of the old reader).

### Characterization (commit 1, passes on main)

`apps/cli/src/agent/__tests__/print-and-json-output.characterization.test.ts` replays eleven recorded
sequences through a real `ExtensionHost` wired as `activate()` wires it (reader first, client second),
and snapshots print mode output (stdout, stderr marked) and both JSON modes: partial then final,
reasoning then answer, restarted stream after interleaved reasoning, answer repeated in
`completion_result`, command output split over two ts, command output finalized in place, tool and MCP
asks, an error say, state push replays, two new messages in one push, and a resumed task. 33 goldens.

### Intended differences (commit 2), and nothing else

All 22 JSON goldens and 7 of the 11 print goldens are byte-identical after the move. The four print
goldens that change are the old reader's bugs, now read the TUI's way:

| Scenario                               | Before                                                        | After                    |
| -------------------------------------- | ------------------------------------------------------------- | ------------------------ |
| answer repeated in `completion_result` | `[assistant] The sum is 5.` printed twice                     | once                     |
| command output split over two ts       | `[command output] a.txt` then `[command output] a.txt\nb.txt` | one block `a.txt\nb.txt` |
| two new messages in one state push     | only the second printed                                       | both printed             |
| resumed task                           | `[reasoning] Old thought.` (the last message of the history)  | nothing of the history   |

The interleaved-reasoning restart prints the same bytes as before (`[assistant] Dzi`, `[reasoning] ...`,
`[assistant] Dzień dobry!`) through the "write it again below" rule.

### Residuals kept on purpose

- A row at the end of the output whose text changes without growing (compressed command output) gets no
  delta, only its line break, exactly as before.
- Print mode still never shows `say: tool` rows or MCP responses (the old reader did not either).

### Numbers

- `output-manager.ts` 463 to 50 lines; `extension-host.ts` and `ask-dispatcher.ts` lose the wiring and
  the `markDisplayed` calls; new `transcript-printer.ts` 203 lines (a large part of it comments). Product code
  net: about 220 lines fewer.
- Specs: characterization 33 tests, `transcript-printer.test.ts` 5, one new `extension-host` test.

## 3. Plan for the remaining readers

### Step 2: a delivery stage in the reducer, and JSON derived from it

The reducer today goes straight from messages to rows. Split it into two pure stages in the same module:

1. `readDeliveries(cursor, message)`: for each `ClineMessage` of a `state` push (the whole array) or a
   `messageUpdated`, one delivery event `{ ts, kind, text, partial, first, finalizes, replay, promptEcho,
carriedBy?: ts (restart/command execution), commandTs? }`, dropping pure replays. This is the "one
   event stream". It owns the seen set, the prompt echo rule, the restart detection by prefix, the
   command execution pairing and the completion repeat detection, which today live in `reduceSay`.
2. `rowsFromDeliveries` (today's row logic) for the TUI and print mode.

`JsonEventEmitter` then reads stage 1 instead of the client's `message`/`messageUpdated`, keeping ts as
the event id (its protocol), its own delta and structured-delta computation and its status-driven command
output. Characterization is already in place (the 22 JSON goldens). Expected intended differences, the
same two as print mode: a message that is not the last of its push is emitted, and a resumed task no
longer emits the last message of its history (`thinking` id 4 in the "resumed task" golden). Both need
a line in the stream-json protocol notes; no schema version bump (no field changes).

Traps: stage 1 must keep "partial delivery for a row already final is stale" and "replay still moves the
last-streamed marker" (see the comments in `reduceSay`); JSON must keep emitting partial asks (tool_use
deltas), which stage 2 drops.

### Step 3: the client's `message` event goes

Once JSON reads stage 1, nothing needs `MessageProcessor.emitNewMessageEvents` (the last message of a
push) except `ExtensionHost.waitForTaskCompletion`'s `--exit-on-error` hook for
`api_req_retry_delayed`; move that onto stage 1 as well and delete the `message` event and
`emitNewMessageEvents`. `messageUpdated` stays only if something still needs it (today: the debug log).

### Step 4: what stays of MessageProcessor/StateStore

Agent loop state (`detectAgentState` on the last message, `waitingForInput`, `taskCompleted`,
`modeChanged`) is not a transcript reading and stays. `StateStore` keeps the array for
`client.getMessages()` (JSON cost) and state detection; its unused history/observable features can be
trimmed in the same step after a usage check.

## 4. Verification

- `apps/cli`: `vitest run` on the characterization, `transcript-printer`, `extension-host`,
  `ask-dispatcher`, `transcript-reader`, `transcript-reducer`, `extension-client` and the three
  `json-event-emitter-*` specs (`--maxWorkers=2`): all pass.
- `tsc --noEmit` (apps/cli), eslint on the touched files, `pnpm knip` from the worktree root.
