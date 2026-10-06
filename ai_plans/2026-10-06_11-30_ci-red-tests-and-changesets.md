# CI red on main since 2026-10-02: five tests and three changesets

Status: done on `fix/ci-red-2026-10-06`

## Problem (evidence)

`Code QA Tumble Code` on main failed on every push from 2026-10-02 on (last checked run 37285565025, 63e76a80b).
`Changeset Release` failed on every PR in the same period.

Ubuntu and Windows `platform-unit-test`, both platforms:

- `api/__tests__/cost-call-sites.characterization.spec.ts`: `TypeError: Cannot read properties of undefined
(reading 'getModel')` at `TaskStreamProcessor.ts:617`. #765 made `createBackgroundUsageDrain` read
  `access.api.getModel().id` for the telemetry event; the spec's hand-built `access` has no `api`. Production
  always has one, so the spec is out of date, not the code.
- `core/webview/messageHandlers/__tests__/registry.spec.ts`: expected 137 handlers, got 138. #791 added the
  `reloadWindow` message and did not update the pinned count.

Windows only:

- `core/memory/__tests__/claimEvidence.spec.ts` and `snapshotDrift.spec.ts`: `git init` fails with
  `fatal: unable to access '\\.\nul': Invalid argument`. The specs set `GIT_CONFIG_GLOBAL=os.devNull`; git for
  Windows cannot open the NUL device as a config file. A missing file is read as an empty config.
- `api/providers/__tests__/qwen-code-token-refresh.spec.ts`: `expected 438 to be 384`. Windows has no POSIX
  permission bits; `stat` reports 0o666.

`Changeset Release` (`changeset version`): `Found mixed changeset cli-remove-stdin-prompt-stream ... Mixed
changesets that contain both ignored and not ignored packages are not allowed`. `@tumble-code/cli` is in
`ignore`, and `@tumble-code/vscode-webview` has no `version` field, so changesets treats it as ignored too.
`pnpm changeset status` listed three such files one after another.

## Fix

- cost spec: `access.api.getModel()` returns the model id under test.
- registry spec: 138, `reloadWindow (#791)` named in the test title.
- memory specs: `GIT_CONFIG_GLOBAL` points at a path that does not exist.
- qwen spec: the 0600 assertion runs off Windows only.
- `.changeset/cli-remove-stdin-prompt-stream.md`, `retire-gemini-cli-provider.md`: dropped the
  `@tumble-code/cli` line; `stale-lazy-chunk-reload.md`: dropped the `@tumble-code/vscode-webview` line. The
  text stays in the `tumble-code` changelog.

## Checks

The five specs pass locally; `pnpm changeset status` exits 0.
