# CLI Rebrand: Roo → Tumble

**Date:** 2026-08-04
**Status:** Implemented on `rebrand/09-cli-tumble` (commit `145baf361`), builds + 507 tests green
**Master plan:** [[2026-05-26_rebrand-roo-to-tumble-code]] — this is the CLI slice (branch 9, was not in the original 8-branch stack)

## Scope

Rename user-facing "Roo" in `apps/cli/` to "Tumble", following the master plan's guiding rules:
public-facing strings → change; internal identifiers → keep.

## Changes

| File                                                                  | Change                                                                                                                                                     |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/cli/package.json`                                               | package name `@roo-code/cli` → `@tumble-code/cli`; bin `roo` → `tumble`; description                                                                       |
| `apps/cli/src/index.ts`                                               | program name `roo` → `tumble`; command/auth descriptions; "Roo API key" → "Tumble API key"; "Roo models" → "Tumble models"                                 |
| `apps/cli/src/commands/cli/run.ts`                                    | all `Usage: roo …` → `tumble`; comment                                                                                                                     |
| `apps/cli/src/commands/auth/status.ts`                                | `Run: tumble auth login`, `tumble auth login` refresh hint                                                                                                 |
| `apps/cli/src/commands/cli/upgrade.ts`                                | "Roo CLI" → "Tumble CLI"                                                                                                                                   |
| `apps/cli/src/types/constants.ts`                                     | `AUTH_BASE_URL` / `SDK_BASE_URL` defaults: `app.roocode.com` → `http://localhost:3000`, `cloud-api.roocode.com` → `http://localhost:3001` (self-hosted D8) |
| `apps/cli/src/ui/components/Header.tsx`                               | TUI header `Tumble Code CLI v…`                                                                                                                            |
| `apps/cli/src/ui/theme.ts`                                            | comment only (kept `rooHeader`/`rooText` identifiers — internal)                                                                                           |
| `apps/cli/src/agent/{extension-client,extension-host,agent-state}.ts` | doc comments                                                                                                                                               |
| `apps/cli/install.sh`                                                 | tarball `tumble-cli-…`; binary/symlink `tumble`; installer banner                                                                                          |
| `apps/cli/scripts/build.sh`                                           | release dir/tarball `tumble-cli-…`; wrapper `bin/tumble`; verify + summary; release package.json name                                                      |
| `apps/cli/README.md`                                                  | title, all commands, auth section, provider default                                                                                                        |
| `apps/cli/src/commands/cli/__tests__/upgrade.test.ts`                 | assertion string                                                                                                                                           |

## Deliberately kept (internal, per master plan rule 2)

- Env vars: `ROO_AUTH_BASE_URL`, `ROO_SDK_BASE_URL`, `ROO_CODE_PROVIDER_URL`, `ROO_CLI_ROOT`, `ROO_EXTENSION_PATH`, `ROO_RIPGREP_PATH`, `ROO_INSTALL_DIR`, `ROO_BIN_DIR`, `ROO_VERSION`, `ROO_LOCAL_TARBALL`
- npm scope `@roo-code/*` in dependencies, the `roo-cline` filter in `build:extension`, the `roo` provider id, `RooClient` in `lib/sdk/client.ts`, `.roo` config dir, `~/.config/roo` creds path
- Upgrade source URLs `RooCodeInc/Roo-Code` (repo URL unchanged per D2 LOCKED; will follow the eventual rename in a dedicated change)

## Validation

- `pnpm build` — tsup + dts pass
- `npx vitest run` — 35 files / 507 tests passed (1 integration skipped)
- Smoke: `node dist/index.js --help` prints "Usage: tumble"; `auth status` prints "Run: tumble auth login"; `list modes` works

## Remaining/notes

- `list models` returns `{ "models": {} }` — pre-existing behavior (models come from the cloud API; empty without auth), not caused by this branch
- Next branch in the stack (if any): extension/user-facing strings outside `apps/cli` — tracked in the master plan's other branches
