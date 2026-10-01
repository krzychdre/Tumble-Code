# Status Block Timestamps + Durations - Implementation Plan

**Date:** 2026-05-22
**Branch:** `feat/ui-block-timestamps` (stacked from `feat/ui-api-request-typography`)
**Status:** Approved

## 1. Objective

Show a small, muted start timestamp beside each status block header, and a
duration once the block finishes. Apply to API Request, Thinking, and the
"Todo List Updated" block (with per-item durations on finished todos).

## 2. Evidence (data model verified)

- `ClineMessage` carries `ts: z.number()` (epoch ms) —
  `packages/types/src/message.ts:250`. Confirmed: every status block has a
  start timestamp.
- `ChatRowContent` already destructures `clineMessages` from context
  (`ChatRow.tsx:185`) and computes a `nextMessage` via
  `clineMessages.findIndex(m => m.ts === message.ts)` (`ChatRow.tsx:854-855`).
  Therefore **end time = next message's `ts`**; duration = `nextTs - message.ts`.
- For Thinking: `ReasoningBlock` receives `ts` and already tracks live
  `elapsed` while streaming (`ReasoningBlock.tsx:23-41`). Block start = `ts`;
  block end derives from `elapsed` freezing when `isStreaming` ends.
- Todo block: `UpdateTodoListToolBlock` does NOT currently receive a `ts`.
  It is invoked at `ChatRow.tsx:1402` (`user_edit_todos`) and todos render at
  `updateTodoList` case (`ChatRow.tsx:554-560` via `TodoChangeDisplay`).
- **Verified data-model constraint:** `TodoItem` (`packages/types/src/todo.ts`)
  only carries `id`, `content`, `status` — there are **no per-item timestamps**.
  Per-todo start/duration cannot be derived from real data, so the timestamp +
  duration is applied at the **todo block level** (block start `ts`, block end
  = next message `ts`), consistent with the other status blocks. Inventing
  per-item times would violate the evidence-before-claims mandate.

## 3. Tech Strategy

- **Pattern:** One reusable pure component `BlockTimestamp` (start + optional
  duration). Inject at the 3 explicitly-named status blocks rather than editing
  all 25 `headerStyle` sites (anti-shotgun: a generic tool block has no
  meaningful start/end distinct from its single render).
- **Format helpers:** Add `formatTimestamp` (HH:MM, locale-aware) and
  `formatDuration` (e.g. `1.2s`, `3m 04s`) to `webview-ui/src/utils/format.ts`,
  reusing the existing `i18next.language` locale pattern already in that file.
- **Style:** `text-[10px]` muted via `text-vscode-descriptionForeground` —
  matches the existing muted-secondary convention (ReasoningBlock.tsx:56).
- **Constraints:** No new deps. No new font. Non-intrusive.

## 4. File Changes

| Action | File Path                                                          | Brief Purpose                                                                  |
| :----- | :----------------------------------------------------------------- | :----------------------------------------------------------------------------- |
| [MOD]  | `webview-ui/src/utils/format.ts`                                   | Add `formatTimestamp` + `formatDuration`                                       |
| [NEW]  | `webview-ui/src/utils/__tests__/format.spec.ts`                    | TDD tests for the two helpers                                                  |
| [NEW]  | `webview-ui/src/components/chat/BlockTimestamp.tsx`                | Reusable muted timestamp/duration badge                                        |
| [NEW]  | `webview-ui/src/components/chat/__tests__/BlockTimestamp.spec.tsx` | TDD tests for the component                                                    |
| [MOD]  | `webview-ui/src/components/chat/ChatRow.tsx`                       | Render `BlockTimestamp` in API Request header; pass `ts` to todo block         |
| [MOD]  | `webview-ui/src/components/chat/ReasoningBlock.tsx`                | Render `BlockTimestamp` in Thinking header                                     |
| [MOD]  | `webview-ui/src/components/chat/UpdateTodoListToolBlock.tsx`       | Accept optional `startTs`/`endTs`; show block-level start + duration in header |

## 5. Execution Sequence

1. **TDD format helpers:** write `format.spec.ts` (RED) for `formatTimestamp`
   and `formatDuration`, then implement (GREEN).
2. **TDD BlockTimestamp:** write `BlockTimestamp.spec.tsx` (RED) covering
   start-only and start+duration, then implement (GREEN).
3. **Wire API Request:** add `BlockTimestamp` to the `api_req_started` header
   block in ChatRow; end ts from `nextMessage?.ts`.
4. **Wire Thinking:** add `BlockTimestamp` to `ReasoningBlock` header; duration
   from frozen `elapsed`.
5. **Wire Todo block:** add optional `startTs`/`endTs` props to
   `UpdateTodoListToolBlock`, thread them from ChatRow, render a block-level
   `BlockTimestamp` in the header. (Per-item timing is not in the data model.)
6. Run typecheck, lint, targeted tests.

## 6. Blast Radius

- `format.ts` — additive only; existing `formatDate`/`formatTimeAgo` untouched.
- `UpdateTodoListToolBlock` — new prop is optional; the `user_edit_todos`
  caller (ChatRow.tsx:1402) keeps working without passing `ts`.
- `ReasoningBlock` — already receives `ts`; no signature change.
- No tests currently assert on these headers, so no regressions expected.

## 7. Verification Standards

- [ ] `pnpm vitest run` for format + BlockTimestamp specs: all green.
- [ ] `pnpm check-types` clean.
- [ ] `pnpm lint` clean.
- [ ] Visual: timestamps render small/muted; durations appear after completion.
