# R4 E3: the edit/delete edge-case block becomes four behaviour tests

Status: done.

Related plans: `2026-10-23_17-20_maintenance-audit-round-4.md` (item E3).

## Touched files

- `src/core/webview/__tests__/ClineProvider.spec.ts`

## Problem

`describe("ClineProvider - Comprehensive Edit/Delete Edge Cases")` ran the edit and delete paths of
`messageHandlers/messageEdits.ts` 20 ways with its own copy of the provider setup. Network timeout, connection
drop, authorization failure and "cleanup during failed edit" each made one mock reject and landed in the same
`catch`; images, file attachments, large text, large payloads, concurrent edits, identical and future timestamps
were the happy path with other strings. Several tests could not fail: they asserted that
`showInformationMessage` (which the handler never calls) was not called, or asserted nothing. The malformed-request
test had no current task, so the field checks of `submitEditedMessage` never ran.

## Change

Four behaviour tests in the existing `describe("editMessage")`, which reuses the main provider setup:

1. Submit only posts `showEditMessageDialog` and changes nothing (the cancel case); confirm rewinds from the
   preceding `user_feedback` message and calls `submitUserMessage` with the new text.
2. `test.each` over `editMessageConfirm` / `deleteMessageConfirm`: a failing rewind shows
   `error_editing_message` / `error_deleting_message` (the two `catch` mappings).
3. Confirming an edit of a message that is gone shows `message_not_found` and changes nothing.
4. Malformed `submitEditedMessage` (no value, non-number value, no content, no current task) opens no dialog, and
   `deleteMessage` with value 0 shows `invalid_timestamp_for_deletion`.

Delete-specific cases (message not in history, identical timestamps, keeping earlier messages) stay covered by
`webviewMessageHandler.delete.spec.ts` and the existing `deleteMessage` tests. The rest of the old block,
`getTaskWithId`, keeps a trimmed setup under `describe("ClineProvider getTaskWithId")`.

`ClineProvider.spec.ts`: 4161 lines before, 3361 after (the old block was 925 lines plus 45 of `getTaskWithId`).

## Tests

- `ClineProvider.spec.ts`: 120 passed. Whole `src/core/webview/__tests__`: 58 files, 963 tests passed.
- Mutations in `messageEdits.ts`, each red, then restored:
    - edit `catch` maps to the delete key: row `editMessageConfirm` of test 2 red;
    - delete `catch` maps to the edit key: row `deleteMessageConfirm` red;
    - `typeof message.value === "number"` dropped from `submitEditedMessage`: test 4 red;
    - the `return` after `message_not_found` in edit confirm dropped: test 3 red;
    - no walk back to the preceding `user_feedback`: test 1 and the existing edit test red.
