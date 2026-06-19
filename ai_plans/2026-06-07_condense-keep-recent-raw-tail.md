# Keep a recent raw tail on full condense (stacked follow-up #1)

Date: 2026-06-07
Branch: `feat/condense-keep-recent-tail` (stacked on `feat/context-microcompaction`, off `main`)

## Motivation / evidence

Recommendation #3 from the compaction gap analysis (see
`ai_plans/2026-06-07_context-microcompaction-layer.md`). Today tumble-code's
full summarization is a **total fresh start**: every message is tagged
`condenseParent` and the effective history collapses to **just the summary**
(`getEffectiveApiHistory` → `[summary]`). The model's only memory of what it was
_just_ doing is a lossy paraphrase — the exact recent tool calls, file contents,
and decisions are gone. That is a large part of the "condense feels ineffective"
complaint.

Verified by direct read:

- `condense/index.ts:466-487` tags **all** messages and appends the summary at
  the end.
- `condense/index.ts:546-607` — the summary branch of `getEffectiveApiHistory`
  is a **positional `slice(summaryIndex)`** (NOT tag-based): it returns the
  summary and everything physically after it, then strips orphan `tool_result`
  blocks (lines 569-590) and truncation-hidden messages.
- Claude Code keeps a recent raw tail in its `partialCompactConversation`
  (`'up_to'` direction) and `sessionMemoryCompact` paths: summarize the prefix,
  keep the recent suffix verbatim, and choose the keep-boundary so it never
  splits a `tool_use`/`tool_result` pair (`adjustIndexToPreserveAPIInvariants`).
  Its _full_ `compactConversation` has no tail — which is what tumble-code does
  today.

## Decision

After a full condense, keep the most-recent **raw** messages (the working set)
in the effective history instead of only the summary. Storage becomes:

```
[ ...prefix (tagged condenseParent=X), summary (isSummary, id=X), ...recentTail (raw, untagged) ]
```

Because `getEffectiveApiHistory` slices from the summary, the effective history
becomes `[summary, ...recentTail]` — a fresh start that still carries the recent
turns verbatim. No change to `getEffectiveApiHistory` is required.

### Approach B (summary covers everything) — chosen over A (summary covers only prefix)

The summarizer input is **unchanged** (it still summarizes the whole
since-last-summary region); we _additionally_ keep the recent tail raw and tag
only the prefix. A summary is a roughly constant-size paraphrase regardless of
how many messages it covers, so feeding it the prefix-only (approach A) would
save a negligible number of tokens while (a) changing the summarizer-request
path and its tests and (b) losing the robustness that the summary remains a
_complete_ fallback even if the tail boundary is imperfect. B is simpler, safer,
and ~equally effective.

### When the tail is kept

Only when the since-last-summary region is large enough that summarizing the
older prefix still yields a worthwhile reduction:
`getMessagesSinceLastSummary(messages).length >= CONDENSE_KEEP_RECENT_MESSAGES + CONDENSE_MIN_SUMMARIZED_MESSAGES`.
Otherwise fall back to the classic fresh-start (summarize all, no tail). This is
not test-fitting: keeping 6 raw and summarizing 2 in a tiny conversation saves
nothing — the tail only earns its keep on large (real-overflow) histories, which
is exactly when condense fires in production. Tiny unit-test fixtures (5-7 msgs)
therefore keep the exact classic behavior.

### Two correctness invariants (both verified as real failure modes)

1. **The new summary must stay the last `isSummary` in the array.**
   `getEffectiveApiHistory` and `getMessagesSinceLastSummary` both anchor on
   `findLast(isSummary)`. If the tail reached back to include a _prior_ summary,
   that prior summary would sort after the new one and break the slice. → The
   keep-boundary is floored just past any prior summary in the region.
2. **The boundary must not split a `tool_use`/`tool_result` pair.** A
   `tool_result` kept in the tail whose matching `tool_use` was summarized away
   is orphaned and silently stripped by `getEffectiveApiHistory:569-590` — we'd
   lose the very result we meant to keep. → Pull the boundary backward until
   every tool_result in the tail has its tool_use in the tail (capped at
   `keepRecent*2` and floored, so a pathological unpaired chain can't swallow the
   prefix; if the cap is hit the existing orphan-stripper still keeps the API
   request valid, just less complete).

## Design

### `src/core/condense/index.ts`

- New exported constants `CONDENSE_KEEP_RECENT_MESSAGES = 6` (≈3 native tool
  turns) and `CONDENSE_MIN_SUMMARIZED_MESSAGES = 4`.
- New exported pure helper `computeCondenseKeepBoundary(messages, keepRecent?)`:
  returns the index into `messages` at which the raw tail starts (or
  `messages.length` for "no tail"). Implements the gate, the prior-summary
  floor, and the tool-pair-safe backward expansion. Unit-testable in isolation.
- In `summarizeConversation`, replace the tag-all + append-summary block with:
  tag only `messages[0:boundary]`, then assemble
  `[...taggedPrefix, summaryMessage, ...messages[boundary:]]`.
- Token accounting: add the raw tail's tokens to `newContextTokens` (tool blocks
  converted to text via the existing `transformMessagesForCondensing`, then
  counted) so the caller's threshold math reflects the kept tail.

No changes to `getEffectiveApiHistory`, the summarizer request, tagging
semantics of the prefix, nested condense, or rewind — the tail is just untagged
recent messages positioned after the summary.

## Tests: `src/core/condense/__tests__/keep-recent-tail.spec.ts`

- `computeCondenseKeepBoundary`: no tail below the gate; correct boundary above
  it; backward adjustment when the boundary splits a tool pair; floor past a
  prior summary; cap on runaway expansion.
- `summarizeConversation` (large history): effective history is
  `[summary, ...tail]`; tail messages are untagged and byte-identical; prefix is
  tagged; `newContextTokens` includes the tail.
- Tool-pairing: a split pair at the boundary is healed (no orphan stripped, the
  kept tool_result survives).
- Regression: small history (< gate) → classic `[summary]`-only, all tagged,
  summary last (existing behavior unchanged).
- Existing `index.spec.ts` tests `should tag all messages…` and `should place
summary at end…` are updated to reflect the new contract for _large_ histories
  while keeping their small-fixture assertions valid.

## Known limitations / tradeoffs

- Fixed message-count tail (not token-budgeted). A very large uncleared
  `tool_result` in the tail could keep the post-condense context high; the
  microcompaction pre-pass (branch 1) already clears all but the most-recent
  tool results, so the tail's tool output is usually small. A token-budgeted
  tail (à la Claude Code's `sessionMemoryCompact`) is a possible future refinement.
- Mild redundancy: the summary describes the tail it also keeps raw. Negligible
  (summary size is ~constant) and bought back by robustness.
