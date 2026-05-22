# 24-Hour Timestamps + Full Date-Time in Task List — Implementation Plan

**Date:** 2026-05-22
**Branch:** `fix/ui-api-request-finished-dimming` (continuing the iterative UI work)
**Status:** Approved

## 1. Objective

Two related time-display corrections:

1. Chat status-block timestamps must use **24-hour** format (`17:50`, not
   `05:50 PM`).
2. The task list (history) shows a relative time (`2 hours ago`); it must
   instead show the **full date and time** in `yyyy-mm-dd hh:mm:ss` form
   (`2026-05-22 17:50:33`).

## 2. Evidence (traced, not assumed)

- `webview-ui/src/utils/format.ts` → `formatTimestamp` calls
  `toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })`. With no
  `hour12`/`hourCycle`, the `en` locale defaults to 12-hour → `05:50 PM`. This
  is the single source for every `BlockTimestamp` (API Request, Thinking, todo).
- The task-list relative time is `formatTimeAgo(item.ts)`, rendered in
  `webview-ui/src/components/history/TaskItemFooter.tsx:41`. `TaskItemFooter` is
  the **only** production consumer of `formatTimeAgo` (confirmed by grep) and is
  the shared footer for both `TaskItem` and `HistoryPreview` task rows.
- No `yyyy-mm-dd hh:mm:ss` formatter exists; `formatDate` produces a
  locale "Month day, time" string — not the requested fixed format.

## 3. Tech Strategy

- **24-hour:** add `hourCycle: "h23"` to `formatTimestamp`'s options. `h23`
  explicitly yields `00`–`23` (avoids the legacy `hour12: false` "24:00"
  quirk). This is locale-independent for the hour cycle while keeping the
  locale for separators.
- **Full date-time:** add a new `formatDateTime(timestamp)` helper that builds
  `yyyy-mm-dd hh:mm:ss` from local `Date` getters with zero-padding — a fixed,
  non-locale format exactly as requested. Swap `TaskItemFooter` from
  `formatTimeAgo` to `formatDateTime`.
- `formatTimeAgo` is left in `format.ts` (still unit-tested, generic utility) —
  it simply has no production caller now.
- The hover `StandardTooltip` (locale `toLocaleString()`) is kept unchanged —
  out of scope, harmless.

## 4. File Changes

| Action | File Path                                              | Brief Purpose                                        |
| :----- | :----------------------------------------------------- | :--------------------------------------------------- |
| [MOD]  | `webview-ui/src/utils/format.ts`                       | `formatTimestamp` → 24h; add `formatDateTime`        |
| [MOD]  | `webview-ui/src/components/history/TaskItemFooter.tsx` | Render `formatDateTime(item.ts)` instead of time-ago |
| [MOD]  | `webview-ui/src/utils/__tests__/format.spec.ts`        | 24h assertions + `formatDateTime` coverage           |
| [MOD]  | `.../history/__tests__/TaskItemFooter.spec.tsx`        | Mock + assert full date-time                         |
| [MOD]  | `.../history/__tests__/TaskItem.spec.tsx`              | Mock + assert full date-time                         |
| [MOD]  | `.../history/__tests__/TaskGroupItem.spec.tsx`         | Update `@/utils/format` mock                         |

## 5. Execution Sequence (TDD)

1. RED: rewrite `formatTimestamp` tests to expect `14:30`/`09:05` and add
   `formatDateTime` tests — verified failing 4/27.
2. GREEN: implement `format.ts` changes — verified 27/27.
3. Update `TaskItemFooter` + the three history specs — verified 59/59 across
   format + history suites.

## 6. Blast Radius

`formatTimestamp` is shared by every `BlockTimestamp` and the Codex rate-limit
dashboard — all now 24-hour (intended, consistent). Task-list rows lose the
relative "x ago" text in favour of an absolute timestamp. No data or layout
changes.

## 7. Verification Standards

- [x] `format.spec.ts`: 27/27 (RED→GREEN evidenced).
- [x] History suites (TaskItemFooter / TaskItem / TaskGroupItem): all pass.
- [x] `pnpm check-types` clean in webview-ui.
- [x] `pnpm lint` clean in webview-ui.
- [ ] Visual: block timestamps read `17:50`; task list rows read
      `2026-05-22 17:50:33`.
