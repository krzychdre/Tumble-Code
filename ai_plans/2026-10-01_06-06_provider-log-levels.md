# provider.log calls get real log levels

Status: done (branch `refactor/provider-log-levels`)

## Touched files

Source (27): `src/core/webview/ClineProvider.ts` and its collaborators (`DelegationService`, `TaskHistoryGateway`,
`ModeProfileBinding`, `BackgroundTaskRunner`, `TaskSlot`, `CloudProfileSync`, `ProviderStateBuilder`,
`diagnosticsHandler`, `skillsMessageHandler`, `worktree/handlers`), the message handlers under
`src/core/webview/messageHandlers/` (codeIndex, cloudAuth, mcp, commandsAndSkills, taskLifecycle, providerProfiles,
debug, worktrees, customModes, settings, promptsAndModes, context), `src/core/task/{Task,TaskLifecycle,TaskApiLoop}.ts`,
`src/core/checkpoints/index.ts`, `src/core/plan-review/planReviewPause.ts`. Specs: the ones that mocked or asserted
`provider.log` / `host.log`, the routing characterization snapshot, and the logger spies still named `console*`.

## Problem

Since #722 `ClineProvider.log(message)` was `logger.info(message)`. About 155 call sites went through it, directly
(`provider.log`, `this.log`) or through the `log` member of seven collaborator host interfaces wired as
`log: (message) => this.log(message)`. Every one of them landed in the Tumble Code output panel at info level, also
the ones that report a failure (`Failed to initialize MCP Hub`, `Error saving code index settings`, storage errors)
and the per-operation chatter (`Set pending operation`, dispose sub-steps, delegation reattach decisions).

## Fix

Every call site now calls `logger.error/warn/info/debug` directly, text unchanged (one exception below):

- error: a failed operation the user asked for or a component that failed to start (handler `Error ...` /
  `Failed to ...` lines, storage errors, failed metadata writes);
- warn: a recoverable problem with a fallback (non-fatal delegation steps, failed state pushes, missing workspace
  for an indexing command, profile restore fallbacks, memory writer fallback, checkpoints disabled after an error);
- info: lifecycle (task created or rehydrated, dispose, delegation attach/detach, migration, MCP server deleted,
  command files created/deleted);
- debug: per-operation traces (pending edit operations, dispose sub-steps, reattach rejections that are normal
  races, the `[perf]` request-cycle line, which only exists while the debug setting is on anyway).

With no caller left, `ClineProvider.log` is removed, together with the `log` member of `CloudProfileSyncHost`,
`TaskSlotHost`, `BackgroundTaskHost`, `DelegationHost`, `ProviderStateSources`, `TaskHistoryGatewayHost`,
`ModeProfileHost` and the `log` parameter of `generateErrorDiagnostics`. Nothing outside `src` called it (checked
`apps/` and `packages/`).

The one text change: `[cancelTask] abort still in progress after 3s bound, continuing` had an em dash before
"continuing"; it is a comma now (repo text rule).

## Tests

- Specs that asserted on `provider.log` / `host.log` / a `log` callback now spy on the logger method of the chosen
  level, so they also pin the level. Stale `log: vi.fn()` members of provider and host doubles are removed.
- `webviewMessageHandler.routing.spec.ts` (characterization) now records logger calls as `logger.<level>` events, so
  the snapshot still shows every log line in order; the diff is `provider.log` -> `logger.info/warn` at the same
  positions, plus three existing `logger.info` lines that were already emitted but not recorded (batch deletion,
  marketplace install).
- Spies on `logger` still named `consoleErrorSpy`, `consoleWarnSpy`, `consoleLogSpy`, `consoleInfoSpy`,
  `consoleSpy`, `consoleError` are renamed `logger<Level>Spy` after the method they spy on (pure rename, 18 files).

Runs: the 66 specs that cover the touched files (1003 passed), the 18 specs with removed stale doubles (204 passed),
the 20 renamed specs (367 passed); `tsc --noEmit` in `src`; eslint and prettier on touched files; `pnpm knip` exit 0.

## Notes

- `src/core/config/__tests__/CustomModesManager.spec.ts` keeps its `consoleError` name: the file is reworked on
  `fix/custom-modes-atomic-write`; rename it there or after both merge.
- Other `log` wrappers that write `logger.info` for everything were left as they are, since they are not
  `provider.log`: `ShadowCheckpointService` / `core/checkpoints/index.ts` (`log` = `logger.info`), `extension/api.ts`,
  the Codex OAuth manager, and the cloud package's own `log`.
