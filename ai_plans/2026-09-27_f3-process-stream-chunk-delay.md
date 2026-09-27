# F3 — Chunk displayed one chunk late in processStream

Roadmap item F3 from [ai_plans/2026-09-27_simplification-roadmap.md](2026-09-27_simplification-roadmap.md) ("Each chunk is shown one chunk late", found while testing R5).

Branch: `fix/f3-process-stream-chunk-delay` (base `main` @ a2aef8f2f).

## Problem

In the stream loop of [`TaskApiLoop.processStream`](../src/core/task/TaskApiLoop.ts) the read of the next chunk
happened BEFORE the current chunk was processed. Every chunk therefore sat unread in a local variable
until the next one arrived (or the stream ended), so the user saw each piece of streamed text "one
chunk late" — the last piece only when the server closed the stream, and on a stalled connection only
after the R5 idle timeout fired.

## Root cause (with evidence)

The loop, before the fix (main @ a2aef8f2f, `src/core/task/TaskApiLoop.ts:745-752`):

```ts
try {
	let item = await nextChunkWithAbort()
	while (!item.done) {
		const chunk = item.value
		item = await nextChunkWithAbort()   // <-- reads the NEXT chunk...
		if (!chunk) {
			continue
		}
		this.access.streamProcessor.processChunk(chunk, streamModelInfo)  // <-- ...before processing the current one
```

Exact path: read-ahead → buffering → delayed display:

1. `item = await nextChunkWithAbort()` suspends the loop until the provider yields the next chunk.
   Until that resolves, the already-received `chunk` (in `item.value`) is not passed to
   [`processChunk`](../src/core/task/TaskStreamProcessor.ts:229).
2. `processChunk` is what turns `text`/`reasoning` chunks into `say(...)` partial-message posts to the
   webview (`partialMessage` events). While the chunk waits in the local, the webview cannot see it.
3. The delay is one inter-chunk gap for every chunk, and for the last chunk it lasts until
   `nextChunkWithAbort()` returns `{ done: true }` — i.e. until the server closes the stream, the
   connection drops, or the R5 idle timeout (`StreamIdleTimeoutError`) fires. This is exactly the
   "one chunk late" behavior observed while testing R5.

## Why the look-ahead existed (git history)

The look-ahead is NOT needed by any mechanism — it is a leftover of the manual-iterator rewrite:

- Before 2025-08 the loop was simply `for await (const chunk of stream)`.
- Upstream commit b30372d5c ("Fix token usage / cost often being underreported", #6122, 2025-08-11)
  replaced `for await` with a manual `iterator.next()` loop **so the iterator itself could be handed,
  mid-stream, to the new background usage drain** (`createBackgroundUsageDrain`). Its natural shape —
  `const chunk = item.value; item = await iterator.next()` — reads ahead one item, and the drain was
  seeded with that captured `item`. The delay was an unnoticed side effect.
- #9448 (2025-11-21) only wrapped `iterator.next()` in the abort race (`nextChunkWithAbort`) and kept
  the read-ahead shape.
- `31f5b8145` (#11) moved the code verbatim into `TaskApiLoop` during the Task.ts split.

Checks that nothing depends on the look-ahead:

- **`didAlreadyUseTool` / `didRejectTool` / `abort`**: set while _processing_ a chunk
  (`presentAssistantMessage` sets `didAlreadyUseTool` at
  `src/core/assistant-message/presentAssistantMessage.ts:280`; `abort` is set by the user, not by a
  chunk). The loop's break conditions read state produced by `processChunk(chunk)` of the CURRENT
  chunk — looking at the next chunk is not involved.
- **Background usage drain**: it is created AFTER the loop exits
  (`handleBackgroundUsageDrain`, `TaskApiLoop.ts:779`). It receives the loop's last `item`, which is
  always `{ done: true }` — both before and after the fix — because the loop owns the iterator until a
  `done` result ends it (breaks exit via `handleStreamError`/`finalizeStreamAndProcessResults`, which
  never re-enter the drain with a live item). Its own `while (item && !item.done)` then re-reads from
  the iterator directly. No behavior change.
- **`!chunk` guard**: the "Sometimes chunk is undefined" workaround now re-reads at the end of the
  `continue` branch instead of the top of the loop — same set of chunks processed, same termination
  (a `done` result still ends the loop; the drain is never entered with a chunk, since the guard can
  no longer hand it a `!chunk && !done` item it never had).

Conclusion: the look-ahead is a historical artifact of #6122, needed by nothing. The fix reorders
process-before-read.

## Fix

`src/core/task/TaskApiLoop.ts` (`processStream`):

- Move `item = await nextChunkWithAbort()` from before `processChunk` to the end of the loop body
  (and into the `!chunk` `continue` branch).
- Each chunk is now processed the moment it is received; a break (abort / didRejectTool /
  didAlreadyUseTool) also no longer pays for one extra `iterator.next()` whose result it would
  throw away.
- Deliberately NOT refactored further (that is S2's job). No do-not-touch area touched.

## Tests

New spec: `src/core/task/__tests__/TaskApiLoop.process-stream-chunk-order.spec.ts` (lowest layer that
represents the failure: `processStream` driven directly with a controlled async iterator whose
`next()` only resolves when the test pushes a result):

1. **read/process interleaving** — asserts the exact event log: `read#1, process:a, read#2, process:b, ...`
   (old code: `read#1, read#2, process:a, read#3, process:b`).
2. **last chunk visible immediately** — the chunk is processed while the next read is still pending
   (stalled-connection scenario; before the fix it stayed buffered until the stream ended / the R5
   idle timeout).
3. **no extra read after a break** — `didAlreadyUseTool` fires after one read, not two.

Proof the spec pins the bug: with the fix stashed (main's loop), all 3 tests fail; with the fix,
all 3 pass.

Suites run:

- `cd src && npx vitest run core/task core/assistant-message` — 84 files, 981 tests, all pass
  (includes the R5 idle-timeout specs, stream partials, usage-drain, abort ordering).
- `cd webview-ui && npx vitest run src/components/chat/__tests__` — 49 files, 664 tests, all pass
  (ChatRow golden renders, rate-limit wait, slash command).
- `cd src && npx tsc --noEmit` — clean.

## Residuals

- The `!chunk` "Sometimes chunk is undefined" workaround (2024-era comment, cause unknown) is kept;
  if a provider ever yields `undefined` values, the loop now skips them without a read-ahead.
- `processStream` is still 1,144+ lines of adjacent machinery in `TaskApiLoop`/`TaskStreamProcessor`;
  the planned S2 extraction is unchanged and now starts from a loop without the look-ahead wart.
- The `chunk` of the last non-done read on a break path is never processed — same as before the fix
  (breaks always discarded one buffered chunk; now they simply stop reading).
