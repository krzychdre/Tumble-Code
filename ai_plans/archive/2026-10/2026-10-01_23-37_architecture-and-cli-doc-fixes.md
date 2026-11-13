# Stale claims in docs/architecture.md and docs/07-cli.md (E3)

Status: done (PR open, not merged)

## Touched files

- `docs/architecture.md`: the `src/shared` lint exceptions, the `cloud --> core` edge
- `docs/07-cli.md`: boot step for choosing the TUI, the message-flow diagram and its text
- `docs/04-tools-and-providers.md`, `docs/10-adding-things.md`: the path of `toolArgParsers.ts`; four em dashes in
  `10-adding-things.md` replaced

## Problem

- `architecture.md` said `shared/cloud-urls.ts` and `shared/vsCodeSelectorUtils.ts` were the only exceptions to the
  vscode-import ban in `src/shared`. Neither file exists; `src/eslint.config.mjs` has no exceptions, and
  `packages/config-eslint/__tests__/boundaries.test.mjs` asserts the rule rejects both old names. Nothing to remove
  from the config.
- The dependency diagram showed `cloud --> types` only, but `packages/cloud/package.json` depends on
  `@roo-code/core` (`packages/cloud/src/backoff.ts` re-exports `@roo-code/core/backoff`).
- `07-cli.md` drew `StateStore` and `OutputManager`/`JsonEventEmitter` reading the extension messages. Since the
  one-event-stream work, there is no state store; `JsonEventEmitter` reads the client's `delivery` events
  (`attachToClient`, `agent/json-event-emitter.ts`); print mode's text comes from `TranscriptPrinter`, a sink of the
  same `TranscriptReader` the TUI uses (`agent/extension-host.ts` constructor), and `OutputManager` only writes.
- `04-tools-and-providers.md` and `10-adding-things.md` pointed at `src/core/assistant-message/toolArgParsers.ts`;
  the file is `src/core/tools/toolArgParsers.ts`.

## Fix

Doc text and diagrams corrected to the code. The CLI section describes the TUI and print mode (text, json,
stream-json) only.

## Spot checks (claims in docs/01..10 checked against code, all correct unless noted)

1. Every backticked file path in `docs/*.md` exists (script over `git ls-files`): only `toolArgParsers.ts` was wrong.
2. `06-persistence.md`: stale lock after 31 s (`safeWriteJson.ts` `stale: 31000`), UI save debounce 1 s / 3 s
   (`CLINE_MESSAGES_SAVE_IDLE_MS`, `..._MAX_WAIT_MS`), reconcile every 5 min and the 10 min watcher window
   (`TaskHistoryStore`), `quarantineCorruptFile` on a damaged file.
3. `07-cli.md` boot: 10 s ready limit (`pWaitFor(..., 10_000)`), `updateSettings`, `cliModeProviderSettings`,
   `webviewDidLaunch` in this order; six variables and two slots in `packages/types/src/cli-runtime.ts`.
4. `03-task-agent-loop.md`: backoff capped at 600 s (`MAX_EXPONENTIAL_BACKOFF_SECONDS`), 30 s
   `CONTROL_REQUEST_TIMEOUT_MS`, `apiRequestTimeout` default 600 s, `raceNextChunkWithAbort` in `TaskApiLoop.ts`.
5. `08-cloud.md`: 50 s session refresh (`RefreshTimer`), 60 s JWT (`routers/auth.py`), 6 h retention sweep
   (`retention_sweep_hours`), `--timeout-graceful-shutdown 25` in `docker-entrypoint.sh`, Python 3.13 slim and a
   non-root user in the Dockerfile.
6. `02-extension-host.md`: the state push methods in the table exist (`WebviewStatePusher`, `TaskMessageLog`).

## Tests

Docs only. Prettier on the touched files; `pnpm knip` exit 0.

## Notes

The master plan's E3 row also names "cloud README architecture link and title": already done on `main` by #682.
