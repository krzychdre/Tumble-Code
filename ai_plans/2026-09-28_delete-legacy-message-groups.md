# Delete the deprecated pre-S7 message group aliases

Date: 2026-09-28. Branch: `chore/delete-legacy-message-groups` (off `main` @ 996fd30db).

## Decision

Owner decision (2026-09-28): delete the deprecated group aliases that S7
(`ai_plans/2026-09-28_s7-split-extension-message-types.md`, section 5) kept in
`packages/types/src/vscode-extension-host/legacy-groups.ts` "until no outside
consumer of `@roo-code/types` needs them". `@roo-code/types` is an internal
workspace package with no outside consumer.

## What is deleted

- `packages/types/src/vscode-extension-host/legacy-groups.ts` (290 lines): the
  19 `@deprecated` `Extract` aliases, 9 host-to-view
  (`ExtensionTaskMessageType`, `ExtensionUiMessageType`,
  `ExtensionModesMessageType`, `ExtensionProviderMessageType`,
  `ExtensionMcpMessageType`, `ExtensionCodeIndexMessageType`,
  `ExtensionMarketplaceMessageType`, `ExtensionWorktreeMessageType`,
  `ExtensionPlanReviewMessageType`) and 10 view-to-host (the same with the
  `Webview` prefix plus `WebviewSettingsMessageType`).
- Its re-export in `packages/types/src/vscode-extension-host.ts`.

Before the deletion, a repo-wide search for the 19 names found them only in
`legacy-groups.ts` and the two types specs.

## Tests

Commit 1: `vscode-extension-host-surface.spec.ts` lists the export set without
the 19 names and adds `RemovedLegacyGroupExports`, one `@ts-expect-error` per
deleted name, so re-exporting one is a type error. On main the package type
check fails with 19 TS2578 errors. `vscode-extension-host-message-types.spec.ts`
drops the "deprecated pre-S7 groups still partition both sets" test.

Commit 2: the deletion. Gates: the two types specs (2 files, 9 tests);
`check-types` clean in types, src, webview-ui, apps/cli, cloud, core,
vscode-shim; eslint on touched files; `pnpm knip` exit 0.
