# CLI: id index in the transcript reducer, no event buffer in stream-json (audit C-4, C-5)

**Status:** done on `perf/sec-cli-reducer`
**Audit:** `private_docs/security-audit-2026-11-06/report.md` C-4, C-5 (C-7 and CO-2 judged here too)
**Touched:**

- `apps/cli/src/agent/transcript-reducer.ts`: `Reduction.positions` (id to index), used by `findMessage` and `addMessage`
- `apps/cli/src/agent/json-event-emitter.ts`: `emitEvent` keeps events only in `json` mode

## C-4: quadratic reduction per state push

Every state push replays the whole `clineMessages`; `reduceSay` calls `findMessage` (a linear
`find`) before the `hasSeen` early-out, so one push cost O(N^2). The Reduction now builds an
id-to-index map on first use (O(N) per push) and keeps it current on `addMessage` (rows are only
appended or replaced in place, never moved).

Measured (synthetic transcript, one push per new message, 2/3 text and 1/3 `api_req_started`,
reducer plus the bench's own consolidation pass):

| messages | before  | after   |
| -------- | ------- | ------- |
| 500      | 161 ms  | 102 ms  |
| 1000     | 895 ms  | 330 ms  |
| 2000     | 5473 ms | 1141 ms |

Covered by the existing reducer tests: an off-by-one position or a missing position update turns
two of them red.

## C-5: stream-json kept every event

`emitEvent` pushed into `events` in both modes; only `json` mode reads it (`outputFinalResult`).
Now `stream-json` writes the line and keeps nothing. Not observable except in memory; the json
mode tests go red when the push is removed altogether.

## Judged, not changed

- C-7: ink 8's `<Static>` renders only items past the last rendered index
  (`ink/build/components/Static.js`, `items.slice(index)`), so old items build no JSX. What is
  left per render is `buildStaticItems`' plain object array: 0.056 ms for 1000 messages.
- CO-2: the token consolidation per push costs about 0.15 ms at 2000 messages (309 ms over the
  whole synthetic 2000-message task); running totals would have to follow in-place updates of
  `api_req_started`. `getTaskCost` runs only at task completion, not per message.
