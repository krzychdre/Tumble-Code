# Subagent transcript opens at the bottom and follows new rows

Status: done on branch feat/subagent-transcript-autoscroll, not merged
Related plans: 2026-11-18_11-35_subagent-header-context.md, 2026-11-18_11-50_subagent-header-full-prompt.md
Touched:

- `webview-ui/src/components/chat/SubagentTranscriptView.tsx`
- `webview-ui/src/components/chat/__tests__/SubagentTranscriptView.spec.tsx`
- `.changeset/subagent-transcript-autoscroll.md`

## Problem

A subagent opened in the main window showed the top of its transcript and stayed
there while the child streamed. At the parent commit (`d7477bcc5`) the bare
Virtuoso had:

- `followOutput={(atBottom) => (atBottom ? "auto" : false)}` (line 362), no ref and no scroll lifecycle, so the first paint was index 0, the subtask box heading the list (lines 269-285).
- `onHeightChange={noop}` (line 373): a row that grew while streaming never corrected the position.
- `toggleRowExpansion` (lines 287-289) only flipped `expandedRows`; nothing told the scroll code the user had started reading.

## Fix

The view now uses `useScrollLifecycle` from
`webview-ui/src/hooks/useScrollLifecycle.ts`:

```tsx
useScrollLifecycle({
	virtuosoRef,
	scrollContainerRef,
	isStreaming,
	isHidden: false,
	taskTs: loaded ? taskMessage?.ts : undefined,
	hasTask: loaded && messages.length > 0,
})
```

- Virtuoso receives `ref={virtuosoRef}`, `followOutputCallback`, `atBottomStateChangeCallback`, `atBottomThreshold={10}` and `handleRowHeightChange`, inside a wrapper `div` that becomes `scrollContainerRef`.
- A truthy `taskTs` starts the hydration window (`HYDRATING_PINNED_TO_BOTTOM`, hook lines 221-241), which pins with `scrollToIndex({ index: "LAST", align: "end", behavior: "auto" })`.
- `followOutputCallback` returns `"auto"` except in `USER_BROWSING_HISTORY` (lines 288-290); an at-bottom signal returns the phase to `ANCHORED_FOLLOWING` (line 313).
- `toggleRowExpansion` calls `enterUserBrowsingHistory()` before flipping the row, so opening a row stops the follow.

## Tests

`SubagentTranscriptView.spec.tsx`, "opens at the bottom and follows until the
user opens a row". The react-virtuoso mock became a `forwardRef` exposing
`scrollToIndex` and recording the last `followOutput`; the ChatRow mock calls
`onToggleExpand` on click. The test checks that nothing scrolls before messages
arrive, then `scrollToIndex({ index: "LAST", align: "end", behavior: "auto" })`,
`followOutput?.()` equal to `"auto"`, and `false` after clicking a row.

Mutation checks: setting `taskTs: undefined` and removing the
`enterUserBrowsingHistory()` call from `toggleRowExpansion` each failed the new
test (the first on the `scrollToIndex` and `"auto"` expectations, the second on
the `false` after the click).

## Notes

- No scroll-to-bottom button: `showScrollToBottom` and `handleScrollToBottomClick` are not destructured in this view.
- Message loading, ordering and row rendering are unchanged; only the list position is.
- A subagent opened while queued has no messages, so `taskTs` is undefined and the pinned phase is skipped; the effect starts it when the first message and its ts arrive.
- Wheel, keyboard and upward pointer drag on the list also release the follow, because `scrollContainerRef` is wired; scrolling back to the bottom resumes it.
