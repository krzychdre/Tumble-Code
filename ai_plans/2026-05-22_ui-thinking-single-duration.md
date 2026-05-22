# Fix Duplicate / Incorrect Duration on the Thinking Block — Implementation Plan

**Date:** 2026-05-22
**Branch:** `fix/ui-api-request-finished-dimming` (per user instruction "Also fix this")
**Status:** Approved

## 1. Objective

The "Thinking" block showed **two** durations (e.g. `05:50 PM · 6.6s` **and**
`3s`), one in a different font. Show a single, correct duration in the shared
font used by every other status block.

## 2. Evidence (traced, not assumed)

`webview-ui/src/components/chat/ReasoningBlock.tsx` rendered two independent
time elements in its header:

1. `<BlockTimestamp startTs={ts} endTs={finishedTs} />` — added by the
   block-timestamps feature; styled `text-[10px]` muted (the shared, "correct"
   font).
2. A legacy live-elapsed counter: `{elapsed > 0 && <span className="text-sm
...">{secondsLabel}</span>}` — styled `text-sm` (~14px), the "other font".

The two values disagree because they measure different things:

- `elapsed` counts from the component's **mount** time (`startTimeRef =
useRef(Date.now())`), ticks only while `isLast && isStreaming`, and is floored
  to whole seconds.
- `BlockTimestamp` used `finishedTs`, frozen via
  `useEffect(() => { if (!isStreaming) setFinishedTs(prev => prev ?? Date.now()) })`.

That `finishedTs` logic is itself **buggy**: a block mounted when already
finished (a reopened/historical task — `isStreaming` false at mount) sets
`finishedTs = Date.now()`, so the duration becomes `now - ts` — proven by the
failing test output `D(1779465473770)` (a duration computed from a raw epoch).

Every other status block (API Request, todo) derives its end time from
`nextMessageTs` — the `ts` of the next conversation message — passed from
`ChatRow.tsx` (`ChatRow.tsx:273`). `ReasoningBlock` was the only block not using
this shared, persisted, history-correct mechanism.

## 3. Tech Strategy

- **Remove** the legacy elapsed-counter machinery entirely: `startTimeRef`,
  `elapsed` state, the 1s `setInterval` effect, `seconds`, `secondsLabel`, and
  the now-removed `isStreaming` / `isLast` props.
- **Remove** the self-frozen `finishedTs` state and its effect.
- `ReasoningBlock` gains an `endTs?: number` prop; `ChatRow` passes
  `endTs={nextMessageTs}`. `BlockTimestamp` then renders exactly one duration,
  in the shared font — and `undefined` while thinking is still the latest
  message (no duration shown yet, consistent with the API Request block).
- Net result: Thinking uses the identical timestamp mechanism as every other
  block; the duration is correct for both live and reopened tasks.
- The `chat:reasoning.seconds` i18n key is now unused; left in place
  (removing it from ~20 locale files is unrelated churn).

## 4. File Changes

| Action | File Path                                                          | Brief Purpose                                                   |
| :----- | :----------------------------------------------------------------- | :-------------------------------------------------------------- |
| [MOD]  | `webview-ui/src/components/chat/ReasoningBlock.tsx`                | Drop legacy counter + buggy `finishedTs`; accept `endTs` prop   |
| [MOD]  | `webview-ui/src/components/chat/ChatRow.tsx`                       | Pass `endTs={nextMessageTs}`; drop `isStreaming`/`isLast` props |
| [ADD]  | `webview-ui/src/components/chat/__tests__/ReasoningBlock.spec.tsx` | Cover single-duration / endTs-driven behaviour                  |

## 5. Execution Sequence (TDD)

1. RED: add `ReasoningBlock.spec.tsx` — verified failing 2/3, with the failure
   `D(1779465473770)` exposing the `finishedTs = Date.now()` bug.
2. GREEN: rewrite `ReasoningBlock` + update `ChatRow` call site — verified 3/3
   pass (and 11/11 across ReasoningBlock + TodoChangeDisplay + BlockTimestamp).

## 6. Blast Radius

`ReasoningBlock` and its single call site in `ChatRow`. Behaviour change: while
thinking is still streaming, no live ticking counter is shown — only the start
time — until the next message fixes the duration. This matches the API Request
block and removes the inconsistent, inaccurate live counter.

## 7. Verification Standards

- [x] New `ReasoningBlock.spec.tsx`: 3/3 pass (RED→GREEN evidenced).
- [x] `pnpm check-types` clean in webview-ui.
- [x] `pnpm lint` clean in webview-ui.
- [ ] Visual: Thinking shows one duration in the 10px muted font; reopened
      tasks show a sane duration, not a raw-epoch value.
