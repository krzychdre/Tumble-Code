# D11 steps 2 and 3: the JSON output reads a deliveries stage; the client's `message` event goes

Follows `ai_plans/2026-09-28_d11-cli-one-event-stream.md` (step 1, print mode reads the transcript reducer,
merged as PR #586). Branch: `refactor/d11-cli-json-from-deliveries` (off `main` @ `57969138a`).

## 1. What was wrong (verified on main @ 57969138a)

`JsonEventEmitter` read the client's `message` event, which `MessageProcessor.emitNewMessageEvents` emitted
for the LAST message of each state push only, plus every `messageUpdated`. The `--exit-on-error` hook in
`ExtensionHost.waitForTaskCompletion` read the same `message` event. Two consequences, both pinned by the
characterization goldens of step 1:

- A message that is not the last one of the push that brings it, and is never updated afterwards, was never
  emitted ("two new messages in one state push": `First part.` missing in both JSON modes).
- A resumed task emitted whatever message happened to end its history ("resumed task": `thinking` id 4,
  `Old thought.`). The same hole made `--exit-on-error` fail a resumed run whose history ended with an old
  `api_req_retry_delayed`, and miss a new one that was followed by another message in the same push.

## 2. The change

### The deliveries stage (`apps/cli/src/agent/transcript-deliveries.ts`, new)

- `deliveriesOf(message)`: every message of a state push (the whole array, in order, the last one marked
  `isLast`) or the one message of a `messageUpdated` (`isLast: true`, `update: true`). No memory.
- `DeliveryReader.read(message)`: only the news. It remembers what each ts looked like when it was last
  delivered (text, partial flag, reasoning, condensing cost) and drops a pure replay. A push rebuilds that
  memory from the push itself, so a message that left the transcript (a new task) is forgotten.
- `DeliveryReader.beginHistoryReplay()`: what arrives next, up to and including the push that ends with a
  resume ask (`resume_task` / `resume_completed_task`), is flagged `history: true`. A stale resume ask at the
  end of the history push (the F1 case in `run.ts`) closes it too, which is right: everything older is in
  that push.

### Consumers

- `MessageProcessor` owns a `DeliveryReader` and emits a `delivery` event per news item, exactly where the
  old events were: after the state change events for a push (where `message` was), before them for a
  `messageUpdated` (where `messageUpdated` was). So JSON sees the same order as before (the prompt echo reset
  on the NO_TASK transition still precedes the prompt).
- `JsonEventEmitter` subscribes to `delivery` only. It keeps ts as the event id, its own text deltas, its
  structured deltas for partial tool asks and its status-driven command output. History deliveries are not
  emitted; their cost is recorded (the result's cost reads `client.getMessages()` anyway), and they end the
  prompt echo expectation (a resumed task has no prompt echo; before, the history's last message happened to
  consume it).
- `ExtensionHost`: `resumeTask` calls `client.beginHistoryReplay()` next to the printer's; the stdin-stream
  resume bootstrap in `run.ts` calls it too. The `--exit-on-error` hook reads `delivery` and ignores
  history. The debug log reads `delivery` (`update` picks "new" or "complete").
- Step 3 in the same commit: the `message` and `messageUpdated` client events and `emitNewMessageEvents`
  are gone (nothing else subscribed to them: `git grep 'on("message"'` is empty).
- `transcript-reducer.ts` (the rows stage) walks `deliveriesOf` instead of the array itself.

### What stayed in the rows stage, and why

The plan of step 1 listed for stage 1 also the restart detection, the command output pairing, the GLM
completion echo and the prompt echo rule. They stayed in `reduceSay`/`reduceAsk`, because each of them
decides with the transcript being shown, which a view-free stage does not have:

- restart merge: needs the row of the stream to exist and still be partial, and `isLoading`;
- command output pairing: needs the execution's row (`commandRowId` is a row id, it moves when a merge is
  refused while idle) and `isLoading || isResumingTask`;
- completion echo: marker ids are row ids after merge routing, and the finalization re-adds the row;
- prompt echo: depends on `isResumingTask` of the view (the TUI shows a resumed task's history, print mode
  does not), and the resume ask changes that flag in the middle of a push;
- replays are not no-ops for the rows: a replayed final message moves the last-streamed marker, a replayed
  `user_feedback` resets it, a replayed abandoned partial is re-applied, so `DeliveryReader`'s dedupe cannot
  be put in front of the rows stage without changing the TUI.

And the JSON protocol applies none of them on purpose: its events are keyed by the message's ts, so a
restarted stream stays two id streams, the command output stays correlated to the command ask id, and the
completion echo stays a `result` content. The 18 unchanged JSON goldens (restarted stream, completion echo,
command output split over two ts among them) prove that the JSON output did not pick any of them up.

## 3. Golden diffs (the only ones)

| Golden                                           | Before                                    | After                                                |
| ------------------------------------------------ | ----------------------------------------- | ---------------------------------------------------- |
| stream-json / json: two new messages in one push | `user` 1, `assistant` 4                   | `user` 1, `assistant` 3 `First part.`, `assistant` 4 |
| stream-json / json: resumed task                 | `thinking` 4 `Old thought.`, `user` 6, .. | `user` 6, .. (nothing of the history)                |

All 11 print goldens and the other 18 JSON goldens are byte-identical. Protocol note added to
`apps/cli/src/types/json-events.ts`; no field changed, so no schema version bump.

## 4. Tests

- `transcript-deliveries.test.ts` (new, 12), `extension-client.test.ts` (+4 delivery event tests),
  `extension-host.test.ts` (+2 `--exit-on-error` tests), the 33 characterization goldens.
- Unchanged and green: the three `json-event-emitter-*` specs, `transcript-reducer`, `transcript-reader`,
  `transcript-printer`, `ask-dispatcher`, `events`, `App.characterization`, `useTranscriptSink`,
  `useExtensionHost`, `commands/cli/__tests__/*` (incl. `run-resume-bootstrap`).

## 5. Remaining D11 steps

- Step 4 (unchanged from the step 1 plan): trim what stays of `MessageProcessor`/`StateStore` (agent loop
  state, `getMessages()` for the JSON cost) after a usage check.
- Optional step 2b, only with a TUI need: the view-free halves of the rules in section 2 (for example the
  prefix test of a restart) could move into the deliveries stage as annotations, with the view checks
  staying in the rows stage. Not done here because no consumer other than the rows stage would read them.
