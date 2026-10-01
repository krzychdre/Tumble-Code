# Small core cleanups (simplification round 2, item C12)

Status: implemented on `refactor/core-small-cleanups`, one commit per sub-item.

## Touched files

- a: `src/core/context-management/index.ts`, `__tests__/context-management.spec.ts`
- b: `src/core/prompts/sections/custom-instructions.ts`, `sections/__tests__/custom-instructions.spec.ts`
- c: `src/core/task/Task.ts`, `src/shared/tools.ts`, `src/core/tools/ApplyDiffTool.ts`,
  `src/core/tools/__tests__/writeToFileTool.spec.ts`
- d: `src/core/task/TaskTokenTracking.ts`, `src/core/task/TaskAskSay.ts`, `src/core/task/Task.ts`
- e: `src/activate/runPromptAction.ts` (new), `src/activate/__tests__/runPromptAction.spec.ts` (new),
  `src/activate/registerCodeActions.ts`, `registerTerminalActions.ts`, `handleTask.ts`,
  `src/core/webview/ClineProvider.ts`, `.changeset/code-action-allow-list-error.md`
- f: `packages/core/src/utils/regexp.ts` (new) and its spec, `packages/core/src/utils/index.ts`,
  `src/core/tools/EditFileTool.ts`, `src/core/tools/helpers/searchTaskHistory.ts`,
  `src/core/tools/ReadArtifactTool.ts`, `webview-ui/src/utils/mcp.ts` (+ new spec),
  `apps/cli/src/ui/components/Markdown.tsx`

## a. Condense threshold resolved once

Problem: `willManageContext` (old lines 193-203) and `manageContext` (old 362-380) each resolved the per-profile
condense threshold with the same rules; only the second warned about an invalid value, and the JSDoc of the first
said it avoided duplicating the logic.
Fix: `resolveCondenseThreshold(profileThresholds, profileId, globalPercent, warnOnInvalid = false)`. `manageContext`
passes `true`, so the warning is still logged once per request (both functions run for each request,
`TaskContextManager.ts:607`), not twice.
Tests: two new unit tests (values, warning only when asked); the 144 context-management specs pass.

## b. Dead branch in the mode rules header

Problem: `custom-instructions.ts:486` skipped the `# Rules from <usedRuleFile>:` header when `usedRuleFile`
contained `path.join(".roo", "rules-<mode>")`. `usedRuleFile` is only ever `rules-<mode> directories`,
`.roorules-<mode>` or `.clinerules-<mode>` (lines 434-447): none contains `.roo/` or `.roo\`, so the header was
always written.
Fix: delete the branch. Prompt bytes unchanged: all 423 prompt specs (snapshots, prefix stability) pass, and a new
assertion pins `# Rules from rules-test-mode directories:` (it also passes on the old code).

## c. Diff strategy always set

Problem: `Task.diffStrategy` was optional (`Task.ts:386`) but always set to `MultiSearchReplaceDiffStrategy` in the
constructor (old line 1028), the only implementation. `ApplyDiffTool` kept a "No diff strategy available"
fallback (old line 77) and three `diffStrategy && getProgressStatus` checks (old lines 165, 208, 297).
Fix: the field is required and initialized where it is declared; `getProgressStatus` is required on the
`DiffStrategy` interface. The interface stays because specs mock the strategy with plain objects
(`applyDiffTool.spec.ts:115`, the `ClineProvider*.spec.ts` module mocks). `TaskLifecycleAccess.diffStrategy` and
`ClineProvider.ts:2274` keep their optional chaining: their specs build tasks without the field.

## d. Status and queue out of TaskTokenTracking

Problem: `TaskTokenTracking` held `taskStatus`, `taskAsk`, `queuedMessages` and `processQueuedMessages`, which
read the pending asks and the message queue (state `TaskAskSay` already owns), and its doc comments (and
`Task.processQueuedMessages`) described a `@param context` that does not exist.
Fix: the four members move to `TaskAskSay` (its access interface gains `submitUserMessage`), `Task` delegates to
`askSay`, and `TaskTokenTrackingAccess` drops the fields only they used, plus `workspacePath` and `providerRef`,
which nothing in the module read. About 60 lines moved; no cancel/abort code touched.
Tests: `Task.spec.ts` (queued message drained after condense, no cross-task drain), `ask-*` specs,
`Task.access-types.spec.ts` (compile-time contract), `bridge.spec.ts`.

## e. One handler for editor and terminal actions

Problem: `ClineProvider.handleCodeAction` and `handleTerminalAction` differed only in that the terminal one
showed an `OrganizationAllowListViolationError`; VS Code does not show errors thrown from a command handler, so for
editor actions and the "New Task" command the reason was lost.
Fix: `runPromptAction(command, promptType, params)` in `src/activate` (next to its three callers, outside
ClineProvider) with the error shown for every action. User-visible, so it has a changeset.
Tests: new `runPromptAction.spec.ts` (add-to-context vs new task, the error shown and rethrown for an editor and
a terminal action, other errors not shown, no provider).

## f. One escapeRegExp

Problem: the same `escapeRegExp` was copied in `EditFileTool.ts:58`, `searchTaskHistory.ts:363`,
`ReadArtifactTool.ts:464`, `snapshotDrift.ts:357`, inline in `webview-ui/src/utils/mcp.ts:17` and
`apps/cli/src/ui/components/Markdown.tsx:282`. All six use the identical regex and replacement.
Fix: `packages/core/src/utils/regexp.ts`, exported through `utils/index.ts` (so through the browser-safe and the
CLI entries). src and the webview import it from `@roo-code/core/browser`, the CLI from `@roo-code/core/cli`.
`src/core/memory/snapshotDrift.ts` keeps its copy (memory is on the do-not-touch list).
Tests: new `regexp.spec.ts` in packages/core (browser-entry spec still passes), new `webview-ui` `mcp.spec.ts`
for the template matcher, the CLI `Markdown.test.tsx`, and the src tool specs.

## Gates

- tsc `--noEmit`: src, webview-ui, apps/cli, packages/core clean.
- eslint and prettier on every touched file; `pnpm knip` exit 0.

## Notes / caveats

- Only e changes behaviour (error now shown for editor actions and New Task). a-d and f are internal.
