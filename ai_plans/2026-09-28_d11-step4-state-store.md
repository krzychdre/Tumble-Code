# D11 step 4: what stays of MessageProcessor and StateStore

Follows `ai_plans/2026-09-28_d11-cli-one-event-stream.md` (step 1, PR #586) and
`ai_plans/2026-09-28_d11-step2-json-deliveries.md` (steps 2 and 3, PR #589). Branch:
`refactor/d11-cli-state-store-trim` (off `main` @ `996fd30db`).

## 1. Usage check (grep evidence on main @ 996fd30db)

Product code (everything under `apps/cli/src` except `__tests__`) calls these members of `ExtensionClient`
(`git grep -nE 'client\??\.[a-zA-Z]+' -- src ':!src/**/__tests__/**'`):

| Member                                      | Callers                                                                                   |
| ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `handleMessage`                             | `ExtensionHost.activate` (the message listener), always with an object, never a string    |
| `getAgentState`                             | `run.ts` (resume bootstrap), `stdin-stream/handlers/message.ts`, `ExtensionHost`          |
| `getCurrentAsk`                             | `stdin-stream/eof.ts`, `stdin-stream/handlers/message.ts`                                 |
| `hasActiveTask`                             | `stdin-stream.ts`, `stdin-stream/eof.ts`, `stdin-stream/handlers/cancel.ts`               |
| `getMessages`                               | `JsonEventEmitter.getTaskCost` (the result's cost)                                        |
| `isInitialized`                             | `list.ts` (waits for the first state)                                                     |
| `on` / `once` / `off`                       | `ExtensionHost`, `JsonEventEmitter`, `list.ts`, `stdin-stream/session-events.ts`, the TUI |
| `approve` / `reject` / `respond`            | `AskDispatcher`                                                                           |
| `cancelTask`                                | `stdin-stream.ts`, `stdin-stream/handlers/cancel.ts`                                      |
| `beginHistoryReplay`, `reset`, `transcript` | `ExtensionHost`, `run.ts`                                                                 |

Events subscribed anywhere in product code: `delivery`, `stateChange` (JSON: the prompt echo reset on the
`NO_TASK` transition, reads only `previousState`/`currentState`), `waitingForInput`, `taskCompleted`,
`error`. Never subscribed: `modeChanged`, `resumedRunning`, `streamingStarted`, `streamingEnded`,
`taskCleared`; `isSignificantChange` of `stateChange` is read by nobody.

Never called outside their own module or tests: `getCurrentState`, `isWaitingForInput`, `isRunning`,
`isStreaming`, `getLastMessage`, `getCurrentMode`, `handleMessages`, `removeAllListeners`, `onStateChange`,
`onWaitingForInput`, `onModeChanged`, `sendResponse` (only internally), `newTask` (the host posts `newTask`
itself), `clearTask` (the TUI posts `clearTask` itself, so `notifyTaskCleared`/`taskCleared` never ran),
`resumeTask`, `retryApiRequest`, `continueTerminal`, `abortTerminal`, `getStateHistory`, `setDebug`,
`getStore`, `createClient`; the config options `emitAllStateChanges` and `maxHistorySize` (the host passes
only `sendMessage` and `debug`). In `StateStore`: the history, both observables (`subscribe`,
`subscribeToAgentState`), `setExtensionState`, `addMessage`, the singleton (`getDefaultStore`,
`resetDefaultStore`), the mode (only for `modeChanged`). In `MessageProcessor`: `processMessages`, the
`action`/`invoke` handlers (debug log lines only), `isValidClineMessage`, `isValidExtensionMessage`,
`parseExtensionMessage` (only for the string input nobody sends), `parseApiReqStartedText`. In `events.ts`:
`Observable` (only the store), `listenerCount`, the helpers of the dropped events. In `agent-state.ts`:
`isAgentWaitingForInput`, `isAgentRunning`, `isContentStreaming`.

## 2. What was derived instead of stored

`StateStore` held a copy of the transcript (the last push's array, a `messageUpdated` replacing its
message by ts or appending an unknown ts) and the agent state computed from it. `DeliveryReader` (the
deliveries stage of step 2) already follows exactly those two operations to know what is news: a push
rebuilds its memory from the push, an update sets one ts. It now also keeps the transcript itself
(`transcript`, `hasTranscript`), and `MessageProcessor` derives the agent state from it after every change
(`detectAgentState`, as before). There is no second store any more: the transcript is remembered once.

The processor now reads the deliveries before it emits anything (before, a push emitted its state change
events first and only then read the push into the deliveries stage). The emitted order is unchanged (a
push: state change events, then its deliveries; an update: deliveries, then state change events), and the
transcript and agent state are current inside every listener, as before. The only difference is for a
listener that feeds a new message into the client synchronously from a state change event: the outer push
is now read before the inner one (before, the inner one was read first and the outer one then overwrote the
deliveries' memory with an older transcript). Nothing in the CLI does that (the extension answers
asynchronously), so no output changes.

### `getMessages()` stays, and why (the JSON cost)

`JsonEventEmitter` records every cost message it is delivered, but the result is written on
`taskCompleted`, a state change event, which a push emits BEFORE its deliveries. So a push that both
brings a priced request and ends the task (a resumed finished task: its whole history arrives in one push
that ends with `resume_completed_task`) has that price only in the transcript. The new test "counts the
price of a request that arrives in the same push as the task's end" pins it. Moving the emitter onto the
deliveries alone would need the push order changed, which breaks the prompt echo reset (step 2's trap), so
`getMessages()` reads the one transcript the deliveries stage keeps.

## 3. What stays

- `agent-state.ts`: `detectAgentState` and its types (the agent loop state is not a transcript reading).
- `MessageProcessor`: the state/messageUpdated routing, the agent state, the `stateChange`,
  `waitingForInput`, `taskCompleted`, `delivery` and `error` events, the debug log lines.
- `ExtensionClient`: the members in the table of section 1, plus `getEmitter` (the host specs emit through
  it) and `createMockClient` (specs).

## 4. Step 2b (view-independent rules into the deliveries stage)

Not done: it did not fall out of this step. The reasons of step 2's plan still hold: each of the four rules
(restart merge, command output pairing, completion echo, prompt echo) decides with the transcript being
shown (row exists and is partial, `isLoading`, `isResumingTask`, row ids after merge routing), and the only
reader of a view-free half would be the rows stage itself. The JSON output deliberately applies none of
them (its events are keyed by ts). Worth doing only when a second consumer needs one of them.

## 5. Numbers

- Product code (`agent-state.ts`, `events.ts`, `extension-client.ts`, `message-processor.ts`,
  `state-store.ts`, `transcript-deliveries.ts`): 2,506 lines to 1,223 (143 added, 1,426 deleted);
  `state-store.ts` is gone.
- Specs: characterization first (commit 1, green on main): 6 client tests in `extension-client.test.ts`
  ("Transcript and agent state") and 1 JSON result test. Commit 2 removes the tests of the deleted API
  (mode tracking, JSON string input, `newTask`/`clearTask`/terminal senders), rewrites the rest onto
  `getAgentState()` and `on(...)`, and adds 1 `transcript-deliveries` test for the kept transcript.

## 6. Verification

- The 33 print/JSON characterization goldens and the 9 `App.characterization` snapshots are byte-identical
  (no `.snap` file changed; `vitest run` passes on them).
- `vitest run src/agent/__tests__ src/ui/__tests__/App.characterization.test.tsx
src/ui/hooks/__tests__/useTranscriptSink.test.tsx src/ui/hooks/__tests__/useExtensionHost.test.tsx
src/commands/cli/__tests__ --maxWorkers=2`: all green.
- `tsc --noEmit` (apps/cli), eslint on the touched files, `pnpm knip` from the worktree root.

## 7. What is left of D11

The four readers of the roadmap are now: one deliveries stage (transcript, news, history marking) feeding
the rows stage (TUI and print mode) and the JSON output, plus the agent loop state derived from the same
transcript. `OutputManager` is a 50-line writer. Left, optional: step 2b above, and `AskDispatcher`'s own
reading of asks from `waitingForInput` (print mode's prompts), which is an input path, not a transcript
reader.
