# Fix: ChatView re-renders on every checkpointIndices recompute

**Source:** Zoo-Code commit [5ea544d07](https://github.com/Zoo-Code-Org/Zoo-Code/commit/5ea544d07) by Elliott de Launay
**Type:** Performance fix (one-liner)
**Risk:** Trivial — narrows a `useEffect` dependency.

## Problem

In [webview-ui/src/components/chat/ChatView.tsx:1278](webview-ui/src/components/chat/ChatView.tsx#L1278), the `useEffect` that resets
`checkpointJumpCursorRef` depends on the entire `checkpointIndices` array:

```tsx
useEffect(() => {
	checkpointJumpCursorRef.current = null
}, [task?.ts, checkpointIndices])
```

`checkpointIndices` is built with `useMemo` from `groupedMessages`, but its identity changes
whenever `groupedMessages` changes — which happens on every streamed message tick. Each
identity change re-runs the effect, clobbering the user's checkpoint-jump cursor mid-scroll.

The cursor only needs to be reset when the _number_ of checkpoints changes (a checkpoint
was added or removed), not when the array reference flips.

## Change

Single-line edit in [webview-ui/src/components/chat/ChatView.tsx](webview-ui/src/components/chat/ChatView.tsx) at the dependency array
(currently around line 1278 — locate the `useEffect` that contains
`checkpointJumpCursorRef.current = null` and depends on `[task?.ts, checkpointIndices]`):

```diff
 	useEffect(() => {
 		checkpointJumpCursorRef.current = null
-	}, [task?.ts, checkpointIndices])
+	}, [task?.ts, checkpointIndices.length])
```

**Important:** This file in your fork has _two_ lines that read `checkpointJumpCursorRef.current = null` (lines 1278 and 1415 per `grep`). Only the
first one is the `useEffect` body — the second is inside `handleScrollToLatestCheckpoint` and
must remain untouched. Verify the edit with:

```bash
grep -B1 -A2 "checkpointJumpCursorRef.current = null" webview-ui/src/components/chat/ChatView.tsx
```

The first hit should now show `}, [task?.ts, checkpointIndices.length])` directly underneath.

## Verification

1. Type-check:
    ```bash
    pnpm --filter webview-ui check-types
    ```
2. Run the ChatView test suites to make sure nothing depended on the looser deps:
    ```bash
    pnpm --filter webview-ui test -- ChatView
    ```
3. Manual: in the running extension, trigger a long streamed reply with at least one
   checkpoint. Click "jump to latest checkpoint", then keep streaming — the cursor should
   stay where you put it instead of jumping back to "latest" every render. Adding or
   removing a checkpoint should still reset the cursor (this is what `.length` preserves).

## Why `.length` is sufficient

`checkpointIndices` is monotonic in this view — entries are appended to the end as new
checkpoints come in, never reordered or deleted in the middle. Two arrays with the same
length therefore index the same checkpoints. If a future change ever permits in-place
reordering, this dependency would need to be revisited (e.g., depend on the last
element's value or the array's hash). Add a comment if that risk grows.

## Notes

- Cosmetic-only behavior change for users; no telemetry, settings, or types affected.
- No new lint disables; ESLint's `react-hooks/exhaustive-deps` accepts `.length` as a
  derived primitive dependency on a memoized value.
