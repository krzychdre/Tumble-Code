# Live Elapsed Duration for Running Status Blocks — Implementation Plan

**Date:** 2026-05-25
**Branch:** `feat/ui-live-elapsed-duration` (target: new branch off `main`; implementation drafted on `feat/deferred-tool-loading` since files do not overlap)
**Status:** Drafted

## 1. Objective

Status blocks that already display a **static duration after completion**
(Thinking, API Request, Todo List Updated, Todo Change Display) currently show
only the start time while in progress. Add a **live-ticking elapsed time** to
those blocks, rendered with the **identical visual treatment** as the static
post-completion duration — same span, same font, same color, same separator.
No doubled durations. No font drift.

## 2. Evidence (current behavior verified)

- `BlockTimestamp` (`webview-ui/src/components/chat/BlockTimestamp.tsx:20-40`)
  is the single component rendering start time and optional duration. It only
  renders the duration when `endTs > startTs`; while running, callers pass
  `endTs = undefined` (or the next-message `ts` which is `undefined` for the
  latest message).
- Callsites:
    - `ReasoningBlock.tsx:48` — thinking block; `endTs` is the next message's
      `ts`, `undefined` while still streaming.
    - `ChatRow.tsx:1084-1087` — api_req_started; an explicit
      `isApiRequestInProgress` boolean drives `endTs = isApiRequestInProgress ?
undefined : nextMessageTs`.
    - `UpdateTodoListToolBlock.tsx:166, 189` — block-level start + duration on
      the "Todo List Updated" header.
    - `TodoChangeDisplay.tsx:70` — block-level start + duration on the
      "todos updated" header.
    - `TodoChangeDisplay.tsx:88` — **per-item** start-only badge for completed
      todos. This row passes only `startTs` (no `endTs` concept), and **must
      not start ticking live** when we add live behavior to the others.
- `formatDuration` (`webview-ui/src/utils/format.ts:63-74`) is the canonical
  duration formatter (`1.2s` / `3m 04s`). Reusing it preserves visual parity
  between live and final values.

## 3. Tech Strategy

- **Single source of visual truth:** keep `BlockTimestamp` as the only place
  that renders a duration. Live and final values use the same `<span>`,
  same Tailwind classes, same `formatDuration()` call.
- **Opt-in via `live` prop:** add a boolean `live` (default `false`) to
  `BlockTimestamp`. When `live` is `true` **and** `endTs` is missing, the
  component ticks every 1000 ms and renders `formatDuration(Date.now() -
startTs)`. The per-item completed-todo badge (only `startTs`, no time
  concept) keeps the default `live={false}` and renders unchanged.
- **Lifecycle:** `useEffect` registers a 1s `setInterval` only while
  `live && !hasFinalDuration`; cleared on unmount or when `endTs` arrives. No
  timer when component is in its static state — zero-cost for finished blocks.
- **Tick cadence:** 1 Hz. Cheap (one running block at a time in practice), and
  the displayed value (`X.0s` / `Xm YYs`) advances visibly each tick.
- **No new dependency. No new icon. No new style. No new font.**

## 4. File Changes

| Action | File Path                                                          | Brief Purpose                                                                               |
| :----- | :----------------------------------------------------------------- | :------------------------------------------------------------------------------------------ |
| [MOD]  | `webview-ui/src/components/chat/BlockTimestamp.tsx`                | Add `live` prop + 1 Hz interval that re-renders elapsed while running                       |
| [MOD]  | `webview-ui/src/components/chat/__tests__/BlockTimestamp.spec.tsx` | Cover: live ticking when running, no tick after `endTs` arrives, default behavior preserved |
| [MOD]  | `webview-ui/src/components/chat/ReasoningBlock.tsx`                | Pass `live` to `BlockTimestamp`                                                             |
| [MOD]  | `webview-ui/src/components/chat/ChatRow.tsx`                       | Pass `live={isApiRequestInProgress}` to api_req_started `BlockTimestamp`                    |
| [MOD]  | `webview-ui/src/components/chat/UpdateTodoListToolBlock.tsx`       | Pass `live` to the two header `BlockTimestamp`s                                             |
| [MOD]  | `webview-ui/src/components/chat/TodoChangeDisplay.tsx`             | Pass `live` to the block-level `BlockTimestamp`; per-item row unchanged                     |

## 5. Execution Sequence

1. Update `BlockTimestamp.tsx`:
    - Add `live?: boolean` prop (default `false`).
    - If `endTs > startTs`, render static duration (today's behavior).
    - Else if `live`, register a 1000 ms interval, render
      `formatDuration(Date.now() - startTs)`.
    - Otherwise, render start time only (today's behavior — protects per-item
      completed-todo badge).
2. Update `BlockTimestamp.spec.tsx`:
    - Add fake-timer test for live ticking when `live && !endTs`.
    - Add test that supplying `endTs` short-circuits ticking and renders
      static duration.
    - Add regression test that `live={false}` + no `endTs` shows no duration.
3. Wire the four in-progress callsites with `live` (or `live={isApiRequestInProgress}` for api_req).
4. `pnpm --filter @roo-code/webview-ui check-types` (or repo-level) + targeted
   `pnpm vitest run BlockTimestamp ReasoningBlock TodoChangeDisplay`.

## 6. Blast Radius

- `BlockTimestamp` API gains one optional prop; all current callsites compile
  unchanged. Callers that don't opt in get today's exact behavior.
- Only callsite semantic change: four in-progress headers gain a ticking
  display while running. Final-state output (post-completion) is byte-for-byte
  identical to today.
- No backend / message-shape changes. No i18n string additions (the displayed
  string is `formatDuration(...)`, already used).

## 7. Verification Standards

- [ ] `pnpm vitest run` for `BlockTimestamp.spec.tsx`: all green, including
      new live-tick cases under fake timers.
- [ ] `pnpm check-types` clean.
- [ ] Visual: while a request/thinking block is in progress, a single muted
      duration appears next to the start time and advances each second.
      After completion, the same span shows the final duration with no
      visible re-layout / font change.
