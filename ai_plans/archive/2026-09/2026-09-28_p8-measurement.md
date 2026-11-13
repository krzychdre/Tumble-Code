# P8 measurement: are whole-file task saves slow enough to need JSONL?

Date: 2026-09-28. Roadmap item: P8 in `ai_plans/2026-09-27_simplification-roadmap.md` ("every save
rewrites all of `ui_messages.json` and `api_conversation_history.json`, which is quadratic over a
long task. Fix: append-only JSONL with compaction. Do it last, only if long tasks are measurably
slow").

This document measures the claim. It does not implement P8.

## Verdict

**Not needed now.** The rewrite is quadratic in bytes written, but the constant is small: on the
longest real task on this machine (615 API requests, 2.5 hours) all whole-file rewrites together cost
about 27 s of awaited write time for the API history and about 35 s of background write time for
the UI messages, i.e. well under 1% of the task's wall-clock time, and no single save blocks the
extension host thread for more than about 20 ms. An append-only log would save roughly 18 s of the
27 s on that task (the fsync floor stays), at the price of a format change, a migration, a
dual-format reader, and a full rewrite anyway on every condense, truncation, edit, delete and resume.

P8 becomes worth doing when one of the thresholds in "When P8 becomes needed" is crossed.

## Method

1. Code trace of every save path on `main` @ d98e267b0.
2. Real data: every task folder on this machine, read-only.
3. Timing of the real `safeWriteJson` (`packages/core/src/fs/safeWriteJson.ts`, lock + streamed
   stringify + fsync + rename) on copies of real files, writing into a scratch directory on the same
   ext4 NVMe disk as VS Code's globalStorage (`/tmp` is tmpfs here, where fsync is free, so it was
   not used as the write target).
4. A full replay of the longest real task: every prefix of its API history cloned and written once,
   exactly as `saveApiConversationHistory` does after each push.
5. A simulation of the CORE-R7 `ui_messages.json` coalescer on the real message timestamps of every
   task, to count real UI writes.

Script: `scripts/bench-task-persistence.ts` (removed from the tree on 2026-10-01 in simplification round 2, item
B9; it never changed after it was added, so `git show 6a758ccf3:scripts/bench-task-persistence.ts` restores it).
Run from the repo root:

```
pnpm exec tsx scripts/bench-task-persistence.ts \
  --inputs /tmp/p8-inputs --scratch ~/.cache/p8-bench \
  --replay /tmp/p8-inputs/longest-api_conversation_history.json \
  --tasks ~/.config/Code/User/globalStorage/qub-it.tumble-code/tasks
```

`--inputs` holds copies named `ui-p50.json`, `api-p99.json` and so on. Machine: 12 cores, Node
22.22.1, load average about 2 during the run (another agent was working).

## 1. Code trace: when does a save happen?

### `api_conversation_history.json` (`TaskMessageLog.saveApiConversationHistory`)

- Called on every `addToApiConversationHistory` push (assistant message after the stream ends in
  `AssistantMessageAssembler`, user message with tool results in `TaskApiLoop`), on every
  `overwriteApiConversationHistory` (condense, sliding-window truncation in `TaskContextManager`,
  message edit/delete in `message-manager`, resume in `TaskResumption`, delegation), and in
  `flushPendingToolResultsToHistory`.
- Not debounced. It is awaited, so it sits on the agent loop's critical path between LLM turns.
- Each call does `structuredClone(apiConversationHistory)` synchronously on the extension host
  thread, then `safeWriteJson` of the whole array.
- Not during streaming: pushes happen after a stream completes. About 2 saves per API request
  (1230 history entries for 615 requests in the longest task).

### `ui_messages.json` (`TaskMessageLog.saveClineMessages`)

- Called on every added message and on every finished partial, but since CORE-R7 step 4 the writes
  are coalesced: one write after 1 s of quiet, at least every 3 s while messages keep coming. The
  first write, writes after abort, a blocking ask (`TaskAskSay`, `flushClineMessages`) and
  `dispose` write immediately.
- The coalesced write is fire-and-forget (`void queueClineMessagesWrite()`), so it is off the agent
  loop's critical path, but it can run during streaming.
- Each write does `structuredClone(clineMessages)` synchronously, then `safeWriteJson`, then
  `taskMetadata` (a synchronous metrics pass over all messages, plus a cached folder size), then a
  history item update.
- Simulated on real timestamps (all 1157 tasks of the current extension): writes per task p50 47,
  p90 188, p99 498, max 1341; overall 0.565 writes per UI message. This is an upper bound because
  every ask is counted as a blocking flush, and auto-approved asks do not flush.

### `safeWriteJson`

- Yes, it fsyncs: `flushToDisk` opens the temp file and calls `handle.sync()` before the rename
  (added by R2). It also takes a `proper-lockfile` lock (a `mkdir` of a lock directory) per call.
  The measured fsync floor on this disk is about 7 ms per save, whatever the size.
- The JSON is produced by `JsonStreamStringify` piped into a write stream, so it is not one big
  synchronous `JSON.stringify`; the thread is released between chunks, except inside one huge string
  value, which is emitted in one go.

## 2. Real data

Task roots found: `~/.config/Code/User/globalStorage/qub-it.tumble-code/tasks` (1205 tasks),
`.../rooveterinaryinc.roo-cline/tasks` (159, the pre-rebrand extension), and
`~/.vscode-mock/global-storage/tasks` (CLI, 139). No `customStoragePath` is set. 1503 task folders
in total.

| Quantity                              | p50    | p90    | p99     | max     |
| ------------------------------------- | ------ | ------ | ------- | ------- |
| `ui_messages.json` bytes              | 103 KB | 697 KB | 3.49 MB | 10.0 MB |
| `api_conversation_history.json` bytes | 154 KB | 696 KB | 1.79 MB | 5.12 MB |
| UI messages per task                  | 68     | 304    | 804     | 2209    |
| API history entries per task          | 24     | 122    | 407     | 1230    |
| API requests per task                 | 12     | 62     | 208     | 615     |

The largest API history (5.12 MB, 18 entries) is one 5.09 MB `tool_result`, not a long task. The
longest task (`019f7603-...`, 615 requests, 1230 API entries, 1998 UI messages, 3.17 MB API history,
6.08 MB UI messages) ran 8844 s, i.e. 14.4 s per API request on average.

No real `[perf]` counter lines (`tumble-code.debug`) exist in the VS Code logs, so save counts come
from the code trace and the timestamp simulation above, not from counters.

## 3. Cost per save on real payloads (ext4 NVMe, medians)

| File    | Bytes   | safeWriteJson ms | max ms | longest stall inside the write, ms | structuredClone ms | JSON.stringify ms | metrics pass ms | append one line + fsync ms |
| ------- | ------- | ---------------- | ------ | ---------------------------------- | ------------------ | ----------------- | --------------- | -------------------------- |
| api p50 | 154 KB  | 9.9              | 13.9   | 0.9                                | 0.17               | 0.65              | -               | 6.8                        |
| api p90 | 696 KB  | 13.9             | 15.2   | 0.6                                | 0.70               | 3.0               | -               | 7.0                        |
| api p99 | 1.79 MB | 28.3             | 31.0   | 0.9                                | 2.75               | 7.3               | -               | 6.8                        |
| api max | 5.12 MB | 34.3             | 36.4   | 23.2                               | 3.42               | 20.7              | -               | 18.9                       |
| ui p50  | 103 KB  | 9.0              | 9.4    | 0.6                                | 0.21               | 0.44              | 0.10            | 6.9                        |
| ui p90  | 697 KB  | 14.5             | 18.8   | 0.7                                | 0.97               | 3.6               | 0.54            | 6.8                        |
| ui p99  | 3.49 MB | 34.8             | 36.7   | 0.9                                | 4.73               | 15.1              | 0.61            | 6.8                        |
| ui max  | 10.0 MB | 95.4             | 101.0  | 4.7                                | 11.4               | 62.2              | 0.25            | 7.0                        |

Reading the table:

- For the median task a whole-file save costs 9 to 10 ms, of which about 7 ms is the fsync floor
  that an append-only log would pay too. The rewrite itself is not the cost there.
- The synchronous, thread-blocking part of a save is `structuredClone` plus the longest streamed
  chunk plus (UI only) the metrics pass: under 1 ms at p50, about 6 ms at p99, about 16 ms at the
  10 MB maximum. The only stall above 20 ms (23 ms) comes from the single 5 MB tool result string,
  which is a spill-size problem (P10 spill previews), not a rewrite problem.
- `JSON.stringify` is shown for comparison only: the save path does not call it (only the
  debug-only `perfCounters` does).

## 4. Whole task: replay of the longest real task

Every one of the 1230 API history prefixes cloned and written once (measured, not fitted):

- 1230 saves, 2.45 GB written in total (the quadratic part).
- 26.9 s of awaited write time over the whole task; 3.6 s of `structuredClone` on the thread; the
  longest stall inside any write 3 ms.
- Append-only instead: 8.7 s (7.1 ms per line, the fsync floor), so JSONL would save about 18 s.
- Fitted per save: `safeWriteJson ms = 9.4 + 6.4 * MB` (r2 0.99), `structuredClone ms = 1.9 * MB`.

The same task's UI side, from the coalescer simulation: 1341 writes, 3.45 GB, about 35 s of write time
(fire-and-forget, off the critical path) and about 5 s of clone time on the thread.

Against the task:

- Wall-clock 8844 s. API history writes 27 s = 0.30%; UI writes 35 s = 0.39% but in the background.
- Per API request: two API saves at the end of the task cost about 2 x 30 ms = 60 ms against an
  average turn of 14.4 s (0.4%). At p50 size it is about 2 x 10 ms against the same turn.
- The worst thread block per save at the end of the task is about 6 ms clone + 3 ms chunk, below
  one 16 ms frame, and the webview renders in its own process anyway.

## 5. Synthetic long tasks

From the fit above, with the replayed task's mean API entry of 2574 bytes:

| N entries | final MB | rewrite total s | clone total s | last save ms | append total s |
| --------- | -------- | --------------- | ------------- | ------------ | -------------- |
| 500       | 1.29     | 6.7             | 0.05          | 17.6         | 3.6            |
| 1000      | 2.57     | 17.6            | 1.3           | 25.8         | 7.1            |
| 2000      | 5.15     | 51.5            | 7.6           | 42.1         | 14.2           |

The quadratic term shows (N doubles, the total roughly triples), but at N = 2000, about twice the
longest real task, the rewrite total is 52 s against about 14 s for appends, over a task that at the
observed pace would run about 4 hours.

## When P8 becomes needed

Any one of these, measured with this script or with the `tumble-code.debug` perf counters:

1. **Critical path:** the awaited API history save exceeds about 1% of a turn. With
   `9.4 + 6.4 * MB` ms per save and 2 saves per turn, that is an API history of about 10 MB at a
   14 s turn, or about 3.5 MB if turns get to 5 s (fast local models). Today p99 is 1.8 MB and the
   largest multi-turn history is 4.8 MB.
2. **Thread blocking:** one save blocks the extension host for more than about 50 ms. At about
   1.9 ms per MB of clone plus the metrics pass, that is a UI message list of about 20 to 25 MB.
   Today the maximum is 10 MB (about 16 ms).
3. **Task length:** tasks of several thousand API entries become common (the non-destructive
   condense keeps every message in the file, so the file keeps growing past the context window).

Cheaper steps to try before a format change, if a threshold is crossed:

- Drop or narrow the `structuredClone` before each write (the only sizeable synchronous cost); it
  exists so a write sees a stable snapshot while the in-memory array keeps changing, so any change
  must keep that guarantee.
- Coalesce API history saves the way CORE-R7 coalesced the UI saves, with a flush before each API
  request and on delegation.
- Keep single huge tool results out of the history files (spill previews), which removes the only
  stall above 20 ms that was measured.

## Why not JSONL anyway

- It saves about 18 s of I/O on a 2.5 hour task; the fsync floor (about 7 ms) stays per save.
- Every `overwriteApiConversationHistory` (condense, truncation, edit, delete, resume, delegation)
  and every in-place UI message change (partials finishing, edits) is not an append, so the log needs
  compaction or tombstones, a migration, and a reader for both formats (roadmap estimate: L).
