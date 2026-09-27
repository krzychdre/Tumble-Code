# F1 — CI flake in cli-integration: `create-with-session-id-resume-loads-correct-session` (2026-09-27)

Roadmap item F1 from [`ai_plans/2026-09-27_simplification-roadmap.md`](2026-09-27_simplification-roadmap.md):
the integration case fails in most CI runs (and on `main`), the resumed session answering
the follow-up "before its turn starts". Scope: fix the harness/runtime race; production changes
only where the race is a real user-facing bug.

## Problem

The case creates two sessions with custom ids, then resumes each one over the stdin stream
protocol and sends a marker follow-up. The resumed CLI answers `message sent to current ask`
(control `done`, code `responded`), but the user turn with the marker never appears and the case
times out after 180 s:

```
[FAIL] timed out resuming session <uuid> (pingSent=true, messageSent=true,
       sawMessageControlDone=true, sawUserTurnWithMarker=false)
```

Reproduction (3/3 runs failed on `main` @ `fb775aa13`, before the fix):

```
pnpm turbo run bundle --filter=tumble-code
pnpm --filter @tumble-code/cli test:integration --match create-with-session-id
```

## Root cause (proved)

The extension's `createTaskWithHistoryItem` (`src/core/webview/ClineProvider.ts`, "Eager state
push so the webview shows the new task immediately; resumeTaskFromHistory pushes further
updates asynchronously") posts the **persisted** message history before the resumed task has
re-run `TaskResumption.resumeTaskFromHistory()`. The tail of that persisted history is the OLD
ask of the previous run — for this case `completion_result`. The CLI's `MessageProcessor`
computes agent state from `clineMessages`, so the client reports
`isWaitingForInput=true, currentAsk="completion_result"` from the stale push.

The CLI's stdin-stream resume bootstrap (`bootstrapResumeForStdinStream`,
`apps/cli/src/commands/cli/run.ts`) waited only for
`host.client.hasActiveTask() || host.isWaitingForInput()` — satisfied instantly by the stale
push. The case's `message` command then ran `handleMessageCommand`
(`stdin-stream/handlers/message.ts`), which saw `completion_result` (a `isTextResponseAsk`)
and routed the prompt as `askResponse: "messageResponse"`.

But nothing is waiting on that ask. When the resumed task registers its real ask —
`resume_completed_task` — `TaskAskSay.ask()` **clears** `askResponse` before appending the
ask message and blocking in `pWaitFor` (`src/core/task/TaskAskSay.ts`, "This is a new
non-partial message... `this.access.askResponse = undefined`"). The early answer is silently
discarded, the resume ask is never answered, and the resumed task blocks forever: the marker
turn never happens.

Evidence trail:

1. Repro log: the CLI even emits a `result done success=true` event before the first ping —
   the client's `MessageProcessor` sees the stale history tail (`completion_result`) and fires
   `taskCompleted` for a task that has not started its turn yet. Harmless for the case (the
   case ignores `result` events during resume) but it pins the timeline: stale state is fully
   parsed before the live ask exists.
2. The case log shows `code:"responded"` ("message sent to current ask") — proof the handler
   took the ask-response branch, i.e. it believed a text ask was pending.
3. No marker user turn and no queue event ever arrive: the message went to
   `askResponse` (never queued), and the response was dropped by the ask registration.
4. Code: `TaskResumption.resumeTaskFromHistory` calls `askSay.ask(askType)` only after history
   reads/writes (steps 1-3), so the live ask lags the eager state push by multiple I/O ops.

Is the production behavior a bug? Yes, a real (if narrow) one: with `--session-id` +
`--stdin-prompt-stream`, a `message` command that arrives before the resume ask is registered
is silently lost. The webview does not have this problem because a human cannot type into the
reopened task in that sub-second window, and the webview's own resume flow renders the resume
prompt first. The CLI's machine-driven stream protocol can and does hit it — deterministically
in CI, where the ping round-trip is faster than the resume's history I/O.

## Fix

One change, in the CLI's resume bootstrap (`apps/cli/src/commands/cli/run.ts`):

- New `isLiveResumeAskWaiting(host, since)`: true only when the client waits on a
  `resume_task`/`resume_completed_task` ask whose message timestamp is newer than `since`.
  The timestamp is the discriminator between the live ask and a stale history tail: the
  persisted tail keeps its original (old) `ts`, the live ask is appended with a fresh one.
  This also rejects a _stale resume ask_ persisted by an abandoned open of the same task.
- `bootstrapResumeForStdinStream` now waits for that live ask (25 ms poll, 10 s best-effort
  timeout — registration involves history reads/writes; on timeout the old behavior stands).
  Stdin commands are processed serially by `runStdinStreamMode`, so no `message` command can
  be routed before the wait ends.

No change in the extension, the message handler, the case, or the harness protocol. The
"stale tail" state pushes themselves are unchanged — they are correct behavior for a webview
(reopened task must show its history) and the CLI transcript renderer wants them too.

## Tests

- New unit spec, lowest layer: `apps/cli/src/commands/cli/__tests__/run-resume-bootstrap.test.ts`
  — `isLiveResumeAskWaiting` accepts the live resume asks (both variants), rejects the stale
  `completion_result` tail, a stale resume ask older than the bootstrap, non-waiting states,
  and live non-resume asks. 6 tests, pass.
- Integration case, before → after: 0/3 → 5/5 passes locally (the failing stage is the second
  resume; the first resume failed identically pre-fix).
- Full CLI unit suite: 1305 passed, 1 skipped.
- Full integration suite: 15/15 passed.
- `tsc --noEmit` clean, `eslint --max-warnings=0` clean on the touched files.
- `pnpm knip`: byte-identical output vs `main` (pre-existing exit 1 baseline, zero new items).

## Residuals

- The stale-tail `taskCompleted`/`result` event during resume bootstrap (evidence item 1) is
  still emitted: the client's `detectAgentState` cannot distinguish "history tail shows a
  completed task" from "task completed now". The case ignores it; a stricter fix would need a
  live/completed signal from the extension (out of F1 scope).
- The 10 s bootstrap wait is best-effort: if the extension is pathologically slow to register
  the resume ask, the first `message` command can still be lost. A replay of the registration
  (re-sending the ask response) would need extension-side support and is not warranted now.
- `handleMessageCommand` still routes on `currentAsk` alone; a stale `resume_task` tail from an
  abandoned open of the same session would be answered by the first message. This is the same
  window as before, just narrower; the timestamp guard in the bootstrap is the single choke
  point all stdin commands pass through.
