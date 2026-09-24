# CLI spinner: time of the step next to the time of the turn

**Status:** implemented on `feat/cli-spinner-step-timer` (from `main` ab901f663), committed, not pushed
**Related plans:** `2026-08-05_cli-claude-code-style-ui-redesign.md` (the spinner), `2026-09-22_cli-spinner-verbs-rock-tumbler.md` (the word)
**Touched:**
- `apps/cli/src/ui/components/Spinner.tsx` (two clocks, `formatElapsed`)
- `apps/cli/src/ui/store.ts` (`turnStartedAt`, `stepStartedAt`, `markStepStarted`)
- `apps/cli/src/ui/hooks/useMessageHandlers.ts` (`api_req_started` marks the step)
- `apps/cli/src/ui/App.tsx` (passes both starts, drops the ref)
- tests: `ui/components/__tests__/Spinner.test.tsx` (new), `ui/__tests__/store.test.ts`, `ui/hooks/__tests__/useMessageHandlers.test.tsx`
- `apps/cli/README.md`, `apps/cli/src/ui/spinnerSounds.ts` (line format in the docs)

## Symptom

User's screenshot, 2026-09-23:

```
● MCP(searxNcrawl › crawl)
    ⎿ … +17 lines (ctrl+o)
  ∴ Thinking…
◦ Sploosh… (esc to interrupt · 976s · ↓ 70.9K tokens)
```

"The counter shows the whole task, not the step in the task. I want to see both."

## What was happening

The spinner had one clock. `App.tsx` stamped `Date.now()` into a ref whenever
`isLoading` became true (a user message, or an answer to a question) and the
spinner counted from there until `completion_result` or `resume_task` set it
false again. With auto-approval nothing in between touches `isLoading`, so the
number is the whole turn. The CLI had no notion of a step: `handleSayMessage`
dropped `say: api_req_started` without looking at it.

A step here is one request to the model plus the tools it asked for, which is
also how the core loops: `TaskApiLoop.ts` says `api_req_started` at the top of
every request (before the stream, after the provider's rate-limit wait), then
rewrites the same message (same `ts`) when the cost arrives.

Evidence, the screenshot's task `01a0ceed` in `~/.vscode-mock/global-storage/tasks`:

| offset | message |
| --- | --- |
| +879.0 s | `ask: use_mcp_server` searxNcrawl crawl |
| +884.9 s | `say: mcp_server_response` |
| +885.0 s | `say: api_req_started` (tokensOut 16634 once finished) |
| +886.8 s | `say: reasoning` "The crawl returned mostly empty content…" |
| +1076.7 s | first `say: text` of that answer |

At the screenshot's 976 s the current request was 91 s old and went on to think
for 190 s. The single number could not show that. The same task had requests of
350 s, 129 s, 191 s, 200 s and 216 s between runs of 3 to 10 s ones.

## Fix

- `store.ts`: `markStepStarted(ts)` records the `ts` of the latest
  `api_req_started` and only ever moves forward, because the same request is
  re-delivered with its cost and a `state` push replays every earlier one.
  `resetForTaskSwitch` clears it (`reset` does through `initialState`).
- `store.ts`: `setLoading` now stamps `turnStartedAt` on the false-to-true edge.
  This replaces the ref in `App.tsx`, which was written in an effect AFTER the
  render that showed the spinner, so the spinner's first frame always saw the
  previous turn's start (or 0). The old one-clock spinner hid that by showing
  `0s` until its first tick; a clock that reads the start at mount cannot, and
  the sound word was already seeded from the stale value for that frame.
- `App.tsx`: step start = `max(turnStart, stepStartedAt)`. A start older than the
  turn is replayed history, meaning the turn's first request has not begun yet,
  so the step is the turn so far.
- `Spinner.tsx`: one `now` state ticked every second drives both clocks, so they
  change together. Line: `(esc to interrupt · total 16m 16s · step 1m 31s · ↓ 70.9K tokens)`.
  `formatElapsed`: `42s`, `16m 16s`, `1h 05m` (a bare `976s` is unreadable, and
  hours drop the seconds to keep the line short).

Width: the longest line (`Kerchunk`, hours, 6-digit tokens) is 78 columns, so it
still fits an 80-column terminal on one row.

## Tests

- `Spinner.test.tsx`: `formatElapsed` table; the screenshot's numbers render as
  `total 16m 16s · step 1m 31s` and tick together one second later; a new step
  start resets only the step.
- `store.test.ts`: turn start stamped only on the false-to-true edge (an approval
  that re-asserts loading does not restart it); step start moves only forward;
  a task switch forgets it.
- `useMessageHandlers.test.tsx`: `api_req_started` via `messageUpdated` sets the
  step, the cost re-delivery keeps it, a `state` replay of older requests does
  not move it back, and no row is added. Verified by commenting out the
  `markStepStarted` call: the test fails with `expected null to be 2000`.
- Full CLI suite: 82 files pass. 2 of 11 full runs failed one test each, both
  times (where the name was captured) `SelectList > calls onSelect with the
  focused value on Enter` ("expected 'second' to be 'third'"): its second
  arrow-down keystroke is lost when the machine is busy. `SelectList` is not
  touched here and nothing it renders reads the new state.

## Notes

- "total" keeps its old meaning. It restarts only when `isLoading` goes from
  false to true (a new message after a completion, a resumed task). A follow-up
  question or an approval only sets `pendingAsk` and leaves `isLoading` true, so
  the time the user takes to answer is counted in the total (the spinner is
  hidden meanwhile), exactly as before. The step clock counts it too, until the
  next request starts.
- The step restarts only when the core says `api_req_started`; anything the core
  does before that (a retry wait, for instance) stays in the previous step. Not
  checked live: how the clocks behave across a subtask hand-over.
