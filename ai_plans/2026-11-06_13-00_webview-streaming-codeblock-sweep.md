# Webview streaming: code block re-highlighted per token, memory sweep that never fired

**Status:** done on `perf/webview-streaming`
**Related:** security audit 2026-11-06, findings WO-1, WO-6 (WO-5, WO-7 judged in the audit status, no change)
**Touched:** `webview-ui/src/components/common/CodeBlock.tsx`, `webview-ui/src/components/chat/ChatView.tsx`

## Problem

- WO-6: `CodeBlock`'s highlight effect depends on `[source, currentLanguage]` and ran Shiki's
  `codeToHast` over the whole block for every streamed token: O(n) passes growing to n per block.
- WO-1: `ChatView` swept `everVisibleMessagesTs` from a 60 s `setInterval` in an effect keyed on
  `modifiedMessages`/`visibleMessages`, which are new arrays on every token, so the interval was cleared
  and restarted per token and never fired while a task streamed.

## Fix

- `CodeBlock` highlights at most once per `HIGHLIGHT_INTERVAL_MS` (150 ms). The first highlight, and any
  change after a quiet interval, runs at once as before; changes inside the interval are coalesced into one
  timer at the interval's end, which highlights the latest source (the effect cleanup cancels the older timer).
- The sweep is deleted rather than moved to refs: the set is an `LRUCache` with `max: 100` and a 5 min TTL,
  and it is cleared on task change and when the view hides, so memory was already bounded. The sweep only
  dropped entries for messages no longer in the task, which `filterVisible` never looks up.

## Tests

`CodeBlock.spec.tsx`: 20 tokens 10 ms apart call `codeToHast` 3 times and the last call gets the full
source. Mutation: interval 0 gives 21 calls. ChatView and row-pipeline specs pass unchanged.
