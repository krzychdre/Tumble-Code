# Per-Entry Completion Timestamp on the Todo-Change Block — Implementation Plan

**Date:** 2026-05-22
**Branch:** `fix/ui-api-request-finished-dimming` (per user instruction "implement in this branch")
**Status:** Approved

## 1. Objective

The "Updated the to-do list" block shows a start time + duration on its
**header**, but the individual todo **entries** show no timestamp. Add a small,
non-intrusive timestamp beside each entry that is **finished** (status
`completed`), so the user can see when each item was completed.

## 2. Evidence (traced, not assumed)

- The block in the screenshot is rendered by
  `webview-ui/src/components/chat/TodoChangeDisplay.tsx` — its header text is
  `t("chat:todo.updated")` = "Updated the to-do list"
  (`webview-ui/src/i18n/locales/en/chat.json:476`).
- Its header already renders `<BlockTimestamp startTs endTs />`. Each entry
  `<li>` renders only `{icon}` + `<span>{todo.content}</span>` — **no timestamp.**
- `TodoItem` (`packages/types/src/todo.ts`) carries only `id` / `content` /
  `status` — there is **no per-item timestamp** in the data model.
- However, `TodoChangeDisplay` represents a single `updateTodoList` message:
    - In the "updates" branch it filters to items whose status _just changed_ to
      `completed`/`in_progress` in this update (`TodoChangeDisplay.tsx:45-55`).
    - In the "initial state" branch (`previousTodos.length === 0`) it shows the
      first todo message.
    - In **both** cases, any displayed `completed` entry was completed _as of this
      message_. Therefore its completion time is the block's `startTs`
      (`message.ts`, passed from `ChatRow.tsx:572`). No message-history scan or
      data-model change is required, and no time is fabricated.

## 3. Tech Strategy

- For each rendered entry with `status === "completed"` (and a known
  `startTs`), render `<BlockTimestamp startTs={startTs} />` — reusing the exact
  component the header uses, so styling (10px, `descriptionForeground`, muted)
  stays consistent. No `endTs` is passed: a finished entry shows a completion
  time only, not a duration (per-entry duration would require a per-item
  `in_progress` start time, which the data model does not provide).
- The entry content `<span>` becomes `flex-1` so the timestamp sits at the
  right edge of the row; the timestamp is `shrink-0` and `mt-1` to align with
  the entry's first text line. Unfinished entries (`in_progress`, `pending`)
  render no timestamp.
- **Scope:** limited to `TodoChangeDisplay` (the block the user pointed at).
  `UpdateTodoListToolBlock` / `TodoListDisplay` render full lists where
  per-entry times would differ per item and require a message-history map —
  out of scope for this fix.

## 4. File Changes

| Action | File Path                                                             | Brief Purpose                                       |
| :----- | :-------------------------------------------------------------------- | :-------------------------------------------------- |
| [MOD]  | `webview-ui/src/components/chat/TodoChangeDisplay.tsx`                | Render `BlockTimestamp` beside each completed entry |
| [ADD]  | `webview-ui/src/components/chat/__tests__/TodoChangeDisplay.spec.tsx` | Cover finished/unfinished entry timestamp behaviour |

## 5. Execution Sequence (TDD)

1. RED: add `TodoChangeDisplay.spec.tsx` asserting completed entries get a
   timestamp and unfinished ones do not — verified failing (2 fail / 2 pass).
2. GREEN: add the per-entry `BlockTimestamp` to `TodoChangeDisplay` — verified
   all 4 tests pass.

## 6. Blast Radius

One `<li>` render path in a single component. No data-model or backend change.
Unfinished entries unchanged. No layout change for non-completed rows.

## 7. Verification Standards

- [x] New `TodoChangeDisplay.spec.tsx`: 4/4 pass (RED→GREEN evidenced).
- [x] `pnpm check-types` clean in webview-ui.
- [x] `pnpm lint` clean in webview-ui.
- [ ] Visual: completed todo entries show a small muted completion time;
      in-progress / pending entries show none.
