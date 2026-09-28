# Legacy claude_messages.json is deleted without being migrated

Date: 2026-09-28. Branch: `fix/legacy-claude-messages-migration-loss`.

## Defect

`readApiMessages` (`src/core/task-persistence/apiMessages.ts`, lines 79-105 on
main fd0b170c8) falls back to the Cline-era `claude_messages.json` when
`api_conversation_history.json` is missing. After a successful parse it calls
`fs.unlink(oldPath)` and returns the messages, but it never writes
`api_conversation_history.json`. The data then lives only in the caller's
memory: if the caller does not save it, the conversation is gone from disk.
Every later read finds neither file and returns `[]`.

A second defect sits in the same block: the `unlink` is inside the `try` that
guards `JSON.parse`, so when two readers run at once, the one that loses the
unlink race gets `ENOENT`, lands in the "error parsing" branch and returns `[]`
although the file was valid.

## Callers of readApiMessages (main fd0b170c8)

| Caller                                                                                                                     | What it does with the result                               | Effect on a Cline-era task                 |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------ |
| `SearchTaskHistoryTool.ts:93`                                                                                              | read-only search over the current task                     | history deleted, never written back        |
| `DelegationService.ts:386` (`reattach`, logs as `tryReattachDelegatedParent`)                                              | read-only check of the parent's tail                       | parent history deleted, never written back |
| `DelegationService.ts:489` (`complete`)                                                                                    | appends a tool_result and calls `saveApiMessages` (`:591`) | survives (saved)                           |
| `TaskMessageLog.ts:136` `getSavedApiConversationHistory`, used by `TaskResumption.ts:94` and `:115`, `TaskSubtasks.ts:115` | in-memory; saved later                                     | see below                                  |
| `Task.ts:115`                                                                                                              | imported but unused                                        | none                                       |

Root-cause evidence inside the product itself: `TaskResumption` reads the
history twice in one resume. Step 3 (`:94`) gets the messages and deletes the
old file; step 6 (`:115`) reads again, gets `[]`, builds the resumed history
from that empty array and saves it with `overwriteApiConversationHistory`.
Resuming a Cline-era task therefore replaces its whole API history with only
the resume message.

Not callers: the export path (`TaskHistoryGateway.getTaskWithId`) reads
`api_conversation_history.json` directly, so it shows an empty history for an
unmigrated task but deletes nothing. Cloud backfill (`CloudService`,
`backfillMessages`) sends ui_messages only, never the API history.

Reproduced by the tests in commit 1 (4 fail on main): a second read-only call
returns `[]`, the new file is never written, the old file is deleted even when
the write fails, and concurrent readers get `[]`.

## Fix

- The legacy branch now migrates under `withLockedJsonTransaction` on the new
  file path, the same `proper-lockfile` lock `saveApiMessages` takes through
  `safeWriteJson`. Inside the lock: if the new file already exists (another
  reader migrated), read it; otherwise parse the old file, write the new one
  with the transaction's atomic writer (temp file + fsync + rename, compact
  JSON exactly like `saveApiMessages`), and only then unlink the old file.
- Any failure (lock, write, unlink) is logged, the old file stays, and the
  parsed messages are still returned; the next read retries.
- If the old file is missing when checked, the new file is checked once more:
  a concurrent migration writes the new file before deleting the old one, so
  there is never a moment where a reader sees neither file.
- The current-file branch moved unchanged into `readCurrentApiMessages`, so it
  can run after the lock is released (its quarantine rename must not run under
  the lock of the same path).

## Relation to D9

`ai_plans/2026-09-28_d9-config-migrations.md` ("Also noted, not moved") lists
this `claude_messages.json` fallback as a candidate for deletion together with
the other legacy migrations after a release note. This fix does not change
that: when the fallback is deleted, delete `LEGACY_API_MESSAGES_FILE`,
`readLegacyApiMessages` and `migrateLegacyApiMessages` together, and the
"Cline-era claude_messages.json" block in `apiMessages.spec.ts` with them.

## Tests

`src/core/task-persistence/__tests__/apiMessages.spec.ts`, block
"Cline-era claude_messages.json" (4 tests): repeated read, new file in the save
format and old file removed, old file kept when the write fails (via a
pass-through mock of `@roo-code/core/fs`), three concurrent readers.
