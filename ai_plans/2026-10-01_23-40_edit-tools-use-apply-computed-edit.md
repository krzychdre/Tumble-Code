# write_to_file and apply_diff use applyComputedEdit (C1)

Status: implemented on branch `refactor/edit-tools-use-apply-computed-edit` (PR open, not merged).
Item C1 of `ai_plans/2026-10-01_simplification-round-2.md`.

## Touched files

- `src/core/tools/helpers/applyComputedEdit.ts`: new options `cardTool: "editedExistingFile"`, `cardPatch`,
  `cardDiff`, `progressStatus`, `resultPrefix`, `openDiffView`, `showFileOnDirectSave`.
- `src/core/tools/WriteToFileTool.ts`: `execute()` computes the content and the original content, then calls
  `applyComputedEdit`; `handlePartial()` (the streaming preview) is unchanged.
- `src/core/tools/ApplyDiffTool.ts`: after the diff strategy succeeds, calls `applyComputedEdit`; the
  failure path (telemetry, mistake counters, `diff_error`) and `handlePartial()` are unchanged.
- `src/core/tools/helpers/toolWriteResult.ts`: doc comment only.
- Tests: `src/core/tools/__tests__/writeAndApplyDiffPipeline.spec.ts` (new, first commit pins the old behaviour,
  second commit flips the tests marked "Shared step:"); harness mocks added to `writeToFileTool.spec.ts`,
  `toolStreamState.perTask.spec.ts` (`fs/promises`) and `applyDiffTool.spec.ts` (`utils/pathUtils`).
- `.changeset/edit-tools-shared-save-step.md`.

## Problem

`applyComputedEdit` (CORE-R8, #283) is the one approval, diff view and save step of edit, search_replace,
edit_file and apply_patch. `WriteToFileTool.ts:103-197` and `ApplyDiffTool.ts:122-263` (on main before this
change) repeated the same steps by hand, once for the diff editor and once for the direct-write mode
(the focus-disruption experiment), and had drifted from it and from each other:

- `WriteToFileTool.ts:152` slept 300 ms between the final `update()` and `scrollToFirstDiff()`; no other tool
  did.
- `WriteToFileTool.ts:147` stripped `read_file` line numbers only for the diff editor; the direct write
  (`:139`) saved the numbered content, and the card diff (`:156`) was computed from the numbered content in
  both modes.
- `ApplyDiffTool.ts:140-158` built the approval card without `isOutsideWorkspace`, so auto-approval
  (`src/core/auto-approval/index.ts:265`) treated every `apply_diff` as inside the workspace.
- Rejection: `write_to_file` returned without a result or reset in both modes; `apply_diff` called
  `processQueuedMessages()` only after a diff-editor rejection (`:211`), not after a direct-write one (`:170`).
- An unchanged file went through approval and a save in both tools; the shared step reports
  "No changes needed".

The plan-review pause (`pauseForPlanReviewIfNeeded(task, relPath)` after the write result) and the user-edits
feedback (`pushToolWriteResult`, which says `user_feedback_diff`) were the same in all three copies already.

## Fix

Both tools call `applyComputedEdit`. Per-tool differences that are kept became options:

| Kept per tool                                                                                              | Option                                   |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| write_to_file card type `editedExistingFile` / `newFileCreated`                                            | `cardTool`                               |
| write_to_file shows a created file as a patch against /dev/null (`convertNewFileToUnifiedDiff`)            | `cardPatch`                              |
| write_to_file reuses the diff session its streaming preview opened; otherwise a partial ask, then `open()` | `openDiffView`                           |
| write_to_file direct write never shows the file (`saveDirectly(..., false, ...)`), also for a new file     | `showFileOnDirectSave: false`            |
| apply_diff card `diff` is the SEARCH/REPLACE text the model sent                                           | `cardDiff`                               |
| apply_diff card carries `originalContent`                                                                  | `cardIncludesOriginalContent` (existing) |
| apply_diff approval shows the applied-block count                                                          | `progressStatus`                         |
| apply_diff result: partial-failure hint first, single-block notice last                                    | `resultPrefix`, `resultSuffix`           |
| apply_diff calls `processQueuedMessages()` after a rejection                                               | caller tail                              |

write_to_file now reads the original content of an existing file before the step (the session's
`originalContent` when the preview already opened it, else `fs.readFile`), like the other edit tools; before,
`open()` read it in the diff-editor mode and `fs.readFile` in the direct mode.

## Observable differences (old to new)

Preserved: message texts the model reads (write result JSON, part-failure hint, single-block notice, review note,
order of all three), the side-effect order of a successful save in both modes, save arguments
(`saveChanges(diagnostics, delay)`, `saveDirectly(relPath, content, false, ...)`), file tracking, telemetry
(`DIFF_APPLICATION_ERROR` is on the untouched failure path), the partial ask before the diff editor opens,
`toolCallId` stamping, the `handleError` labels and the catch tails.

Changed, with the reason:

1. **write_to_file: no 300 ms sleep before the scroll.** `update(content, true)` resolves after its final
   `applyEdit`, and `scrollToFirstDiff()` reads `document.getText()` synchronously, so the content it diffs is
   final; apply_diff and the four other tools never slept. The diff view scrolls 300 ms sooner. Not
   verifiable in a unit test (no real editor layout); if a slow machine ever shows the diff unscrolled, the
   fix belongs in `applyComputedEdit` for all tools.
2. **apply_diff card has `isOutsideWorkspace`.** With `alwaysAllowWrite` on and
   `alwaysAllowWriteOutsideWorkspace` off, an apply_diff on a file outside the workspace was auto-approved;
   now it asks, like every other edit tool. Security fix, in the changeset.
3. **write_to_file strips line numbers in both modes.** One content for the card, the diff view and the save:
   the direct write no longer writes `1 | ...` prefixes to disk, and the card shows the diff of what is saved
   (before, the diff-editor card showed the numbered content while the stripped one was saved). Also the
   partial placeholder card now carries the stripped content.
4. **Unchanged existing file (write_to_file, apply_diff):** "No changes needed for '<path>'" without an
   approval or a save, like the other edit tools. For apply_diff this needs a SEARCH/REPLACE whose applied
   blocks change nothing (identical blocks already fail in the strategy), so in practice it is write_to_file
   rewriting a file with its current content. The partial-failure hint is not added to this result.
5. **Rejection:** both tools now push "Changes were rejected by the user." and reset the diff view, in both
   modes. `askApproval` has already pushed the denial result, so the real `pushToolResult` drops the second one
   as a duplicate (one `console.warn`); the model sees the same result as before. apply_diff now also calls
   `processQueuedMessages()` after a direct-write rejection.
6. **Card key order and a `diff` key on write_to_file cards.** Keys follow the shared order (`tool, path, diff,
originalContent, isOutsideWorkspace, toolCallId, content, isProtected, diffStats`). write_to_file cards gain
   `diff` equal to `content`; the webview row reads `content` first and the files-changed panel reads
   `diff ?? content`, so both show the same patch as before. The dedup links cards by `toolCallId`, not by
   text.
7. **`diffViewProvider.originalContent` is set before the diff editor opens** (then overwritten by `open()`
   from disk, as for the other tools), and one extra `fs.readFile` of an existing file runs when the preview
   had not opened the diff view.

## Tests

- `writeAndApplyDiffPipeline.spec.ts`: 19 tests. Commit 1 (green on the old code) pins order, cards, saves,
  rejection, results; commit 2 changes exactly the tests marked "Shared step:" (items 1-6 above) and adds
  the outside-workspace card test.
- Green: `src/core/tools/__tests__/` (39 files, 758 tests incl. writeToFileTool, writeToFileTool.truncatedPath,
  applyDiffTool, editPipeline, toolStreamState.\*), `core/checkpoints/__tests__/checkpointed-tools.spec.ts`,
  `core/assistant-message/__tests__/presentAssistantMessage-dispatch-table.spec.ts`,
  `integrations/editor/__tests__/DiffViewProvider.race.spec.ts`, `core/auto-approval`.
- `tsc --noEmit -p src`, eslint on touched files, knip.

## Notes

- `applyComputedEdit` passes `isNewFile` as the `openFile` argument of `saveDirectly` for edit_file and
  apply_patch (so a created file is shown even with focus-disruption prevention on). That is their behaviour
  since #283 and is left alone; write_to_file opts out with `showFileOnDirectSave: false`.
