# Port Zoo PR #670 — remove unused @vscode/test-cli + .vscode-test.mjs

## §0 Credit & provenance

- Upstream: Zoo-Code-Org/Zoo-Code PR #670, commit `ad7dcfeab`, merged 2026-06-20.
- Author: Elliott de Launay (renovate[bot] dropped as a bot).
- Commit trailer:
    ```
    Co-authored-by: Elliott de Launay <edelauna@gmail.com>
    ```

## §1 What & why

The PR title says "update @vscode/test-cli to v0.0.12", but its second commit
("removing unused dep") instead **deletes** the `@vscode/test-cli` runner and its
`.vscode-test.mjs` config — they were unused.

Verified the same holds in our fork: `apps/vscode-e2e` runs e2e via
`runTest.js` (the `@vscode/test-electron` path), not the `vscode-test` CLI. No
script invokes `vscode-test`, and nothing imports `.vscode-test.mjs` except the
file itself. So both are dead here too.

## §2 Edits

- Delete `apps/vscode-e2e/.vscode-test.mjs` (only consumer of `@vscode/test-cli`,
  via `defineConfig`; carried our rebranded `RooVeterinaryInc.roo-cline` launchArg).
- Remove `"@vscode/test-cli": "^0.0.11"` from `apps/vscode-e2e/package.json`.
- Refresh `pnpm-lock.yaml` (prunes the test-cli dep tree, -161 lines).

## §3 Scope cuts

- Ignored `icon-map.json` "vscode-test" entries — unrelated material-icon mappings.

## §4 Verify (binary acceptance) — all ✓

- No remaining `@vscode/test-cli` / `.vscode-test` references in tracked source.
- `pnpm install --lockfile-only` succeeds.
- `pnpm --filter @roo-code/vscode-e2e check-types` passes (e2e doesn't use the CLI).
