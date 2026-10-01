# Split three large core files (C13)

Status: implemented on branch `refactor/split-large-core-files` (PR open, not merged), one commit per file.
Item C13 of `ai_plans/2026-10-01_simplification-round-2.md`.

## Touched files

- (a) `src/core/condense/index.ts` (1005 lines, now 7): re-exports `factValidation`, `toolBlocksToText`,
  `summarize`, `historyView`, keeps `MIN_CONDENSE_THRESHOLD` / `MAX_CONDENSE_THRESHOLD`.
    - `toolBlocksToText.ts` (new): `toolUseToText`, `toolResultToText`, `convertToolBlocksToText`,
      `transformMessagesForCondensing` (old `index.ts:20-112`).
    - `summarize.ts` (new): `SUMMARY_PROMPT`, `injectSyntheticToolResults`, `extractCommandBlocks`, the
      `Summarize*` types, `reportCondenseUsage`, `streamSummary`, `summarizeConversation` (old `:135-718`); the
      hand-built error-details block of its catch (old `:508-536`) is now `describeCondenseError(error)`.
    - `historyView.ts` (new): `CONDENSE_KEEP_RECENT_MESSAGES`, `CONDENSE_MIN_SUMMARIZED_MESSAGES` (old `:117-133`),
      `getMessagesSinceLastSummary`, `toolPairsSatisfiedFrom`, `computeCondenseKeepBoundary`,
      `getEffectiveApiHistory`, `cleanupAfterTruncation` (old `:720-1005`).
    - `__tests__/condense-error-details.spec.ts` (new, committed before the split).
- (b) `src/core/tools/helpers/searchTaskHistory.ts` (962 to 757 lines): `HistoryQueryMode`,
  `compileHistoryQuery`, `parseSlashDelimited`, `isCatastrophicPattern`, `isUnboundedQuantifierAt` (old
  `:99-106`, `:166-361`) moved to `searchTaskHistoryQuery.ts` (new). The spec imports `compileHistoryQuery` from
  there. One doc pointer now says `condense/summarize.ts` instead of `condense/index.ts`.
- (c) `src/core/config/CustomModesManager.ts` (1032 to 766 lines): `exportModeWithRules`, `importRulesFiles`,
  `importModeWithRules` and the export/import types (old `:27-51`, `:748-1018`) moved to `modeExport.ts` (new) as
  functions that take a `ModeExportHost` (`getCustomModes`, `updateCustomMode`, `refreshMergedState`). The
  manager keeps `exportModeWithRules` / `importModeWithRules` as one-line delegators. `ROOMODES_FILENAME` moved
  to `modeRulesDir.ts` and is exported, so the manager and `modeExport.ts` share it without an import cycle;
  `modeExport.ts` uses the `modeRulesDir` helper (#678) as the moved code already did.

## Problem

Three files over 950 lines, each holding two or three unrelated groups (see the line ranges above), which makes
review and blame noisy.

## Fix

Pure moves. `git diff --color-moved=plain` per commit: (a) 969/978 removed/added lines are moved blocks, the rest
is imports, the extracted `describeCondenseError` and comment dashes; (b) 207/210 moved; (c) 274/291 moved (with
`--color-moved-ws=allow-indentation-change`; the rest are the host interface, the delegators and
`this.` to `host.` in four calls).

Notes on "no behaviour change":

- `condense/index.ts` still exports every name it exported (`export *` of the new modules), so no importer
  changed. Specs that `vi.spyOn(condenseModule, ...)` on the index namespace or `vi.mock("../../condense")`
  still pass (context-management, message-manager, Task specs).
- Inside the condense modules, `summarizeConversation` now reaches `getMessagesSinceLastSummary` /
  `computeCondenseKeepBoundary` / `transformMessagesForCondensing` through module imports instead of
  same-module calls. No spec spies on those through the index for that path.
- The manager's delegators pass closures (`() => this.getCustomModes()`), so specs that spy on the manager's
  methods still intercept the calls the export/import make.
- Comments of moved condense code use "-" where they had an em dash (repo text rule); comments only.

## Tests

- New `condense-error-details.spec.ts` (4 tests) pins the error-details text (status, code, response, body,
  unserializable values, non-Error throws); green on the old code, then on the split.
- Green: `src/core/condense`, `src/core/context-management`, `src/core/message-manager`,
  `Task.spec`, `Task.persistence.spec`, `flushPendingToolResultsToHistory.spec`, `reasoning-preservation.test`,
  `grounding-sources.test`, `TaskResumption.snapshot.spec` (29 files, 520 tests); `searchTaskHistory.spec`,
  `src/core/tools/__tests__`, `presentAssistantMessage-search-task-history.spec` (40 files, 810 tests);
  `src/core/config`, `webviewMessageHandler.modeImportExport`, `webviewMessageHandler.routing`,
  `src/services/marketplace` (19 files, 487 tests).
- `tsc --noEmit -p src`, eslint on touched files, `pnpm knip` exit 0.

## Notes

- No changeset: no behaviour change.
- The thresholds stay in `condense/index.ts` because item C12 (condense threshold helper) may touch them.
