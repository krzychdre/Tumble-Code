# Rebrand: Roo Code → Tumble Code

**Date:** 2026-05-26
**Status:** Plan — awaiting URL/handle decisions before execution
**Driver:** Upstream Roo Code is unmaintained. This fork is going its own way under the name **Tumble Code** (logo: tumbleweed). Roo identifiers inside the source (file names, command IDs, class names, env var prefixes) stay for compatibility; only user-visible names, URLs, branding, and assets change. Original authors keep attribution.

---

## 1. Guiding rules

1. **Public-facing string → change.** UI labels, marketplace metadata, README, docs, locale strings, URLs, social handles, logo.
2. **Internal identifier → keep.** `roo-cline.*` command IDs, view IDs, config keys (`roo-cline.something`), env-var prefixes (`ROO_CODE_PROVIDER_URL`), class names (`ClineProvider`, `Roo`), file names (`roo.ts`, `web-roo-code/`), TS types (`RooCodeAPI`). Renaming any of these breaks user settings, telemetry continuity, and creates churn for no user-visible gain.
3. **Attribution is preserved.** The original Roo Code team's copyright in `LICENSE` stays; we add a new top-level "Tumble Code Fork" section to README explaining the lineage. No copyright stripping.
4. **Clean-fork VS Code publish.** New publisher ID, new extension ID, new marketplace entry. Existing users install a separate extension; we ship a one-shot settings import on first launch.
5. **Cloud services are self-hosted.** `self-hosted-cloudapi/` (Python, alembic + pytest) replaces `app.roocode.com`/`clerk.roocode.com`/`ph.roocode.com`. Default URLs become configurable via env vars; no hard dependency on roo-owned infra.

---

## 2. Open decisions

These are the inputs the plan needs. Decisions locked in during implementation are marked LOCKED.

| #   | Decision                                   | Value                                                                                                                                     |
| --- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | New domain                                 | **LOCKED:** `tumblecode.dev`                                                                                                              |
| D2  | GitHub org/repo URL                        | **LOCKED:** `github.com/krzychdre/tumble-code` (existing repo will be renamed on GitHub; GH auto-redirects old URLs)                      |
| D3  | VS Code publisher ID                       | **LOCKED:** `QUB-IT`                                                                                                                      |
| D4  | VS Code extension name (manifest `"name"`) | **LOCKED:** `tumble-code`                                                                                                                 |
| D5  | New extension `displayName`                | **LOCKED:** `Tumble Code`                                                                                                                 |
| D6  | Social handles                             | X: `@tumblecode`, Discord: new server, Reddit: new sub or none, YouTube: new channel or drop                                              |
| D7  | Tumbleweed logo source                     | **LOCKED:** Generate placeholder SVG in branch 5; swap to designed asset later                                                            |
| D8  | Self-hosted cloud default URL              | `http://localhost:8080` for dev, env-driven for prod                                                                                      |
| D9  | Settings-import bridge                     | **LOCKED:** Yes — required because the config property namespace moved from `roo-cline.*` to `tumble-code.*` (see §11)                    |
| D10 | `galleryBanner.color`                      | **LOCKED:** `#B8895A` (warm sandy, matches tumbleweed palette)                                                                            |
| D11 | Auto-import config filename support        | NLS examples updated to `tumble-code-settings.json`; if dual support is desired, branch 7 can keep `roo-code-settings.json` as a fallback |
| D12 | Security contact email for `SECURITY.md`   | open                                                                                                                                      |

---

## 3. Naming & rename matrix

| Old (token)                                        | New                                                                        | Where it appears                                      | Action                       |
| -------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------- |
| `Roo Code` (display)                               | `Tumble Code`                                                              | NLS, locales, README, marketing copy                  | Replace                      |
| `RooCode` (TitleCase)                              | `TumbleCode`                                                               | Marketing copy, social references                     | Replace                      |
| `roocode` (lowercase, in URLs/handles)             | `tumblecode`                                                               | Social URLs, badges, env-var fallbacks for new domain | Replace                      |
| `RooVeterinaryInc`                                 | new publisher (D3)                                                         | `src/package.json`, README badges, marketplace links  | Replace                      |
| `RooCodeInc/Roo-Code`                              | new repo (D2)                                                              | All GitHub links                                      | Replace                      |
| `roocode.com`                                      | new domain (D1) for user-facing, configurable self-hosted URL for services | URLs, env defaults                                    | Replace + introduce env var  |
| `roo-cline` (extension `name`)                     | `tumble-code` (D4)                                                         | `src/package.json` `"name"` only                      | Replace at manifest level    |
| `roo-cline.*` (command IDs, view IDs, config keys) | **unchanged**                                                              | Everywhere in `src/`, `webview-ui/`, `packages/`      | Keep                         |
| `ROO_CODE_PROVIDER_URL` (env var)                  | **unchanged**                                                              | `src/extension.ts:213`, `src/api/providers/roo.ts:47` | Keep, but change default URL |
| File path `apps/web-roo-code/`                     | `apps/web-tumble-code/`                                                    | Folder rename                                         | Optional — see §4.10         |
| File path `src/api/providers/roo.ts`               | **unchanged**                                                              | Internal                                              | Keep                         |
| Class `RooHandler`, type `RooModelId`              | **unchanged**                                                              | Internal                                              | Keep                         |
| Test fixtures using `https://app.roocode.com/...`  | new self-hosted URL                                                        | `packages/cloud/src/__tests__/*`                      | Replace                      |

---

## 4. Scope by area

### 4.1 VS Code extension manifest — `src/package.json`

Changes (anchors are exact lines):

- L2 `"name": "roo-cline"` → `"tumble-code"` (D4)
- L3 `"displayName"` → NLS-driven, English value updates in NLS files (§4.2)
- L5 `"publisher": "RooVeterinaryInc"` → new publisher (D3)
- L17 `"author": { "name": "Roo Code" }` → `{ "name": "Tumble Code (fork of Roo Code by RooVeterinaryInc, original authors)" }`
- L21 `"repository.url"` → new GitHub URL (D2)
- L23 `"homepage": "https://roocode.com"` → `https://<D1>`
- Keywords array (L33–46): drop `roo code`, `roocode`; add `tumble code`, `tumblecode`, `tumbleweed`. Keep `cline`, `claude`, `mcp`, `openrouter`, etc.
- `galleryBanner.color` — pick a new accent that matches tumbleweed aesthetic (sandy/warm) — open D10 below.
- Every `"command"` / `"view"` ID stays `roo-cline.*` (§1 rule 2).

### 4.2 NLS — `src/package.nls.json` + 17 sibling locale NLS files

Per-locale find/replace:

- `extension.displayName` value: `Roo Code` → `Tumble Code`
- `extension.description` value: keep tagline or rewrite ("A whole dev team of AI agents in your editor." → keep, it's brand-neutral)
- `views.contextMenu.label`, `views.terminalMenu.label`, `views.activitybar.title`, `views.sidebar.name`: `Roo Code` → `Tumble Code`
- `configuration.title`: `Roo Code` → `Tumble Code`
- `settings.enableCodeActions.description`: "Enable Roo Code quick fixes" → "Enable Tumble Code quick fixes"
- `settings.autoImportSettingsPath.description`: contains both "RooCode configuration file" and `~/Documents/roo-code-settings.json` example path — replace `RooCode` → `Tumble Code`, keep `roo-code-settings.json` for backward compatibility OR add a second supported filename `tumble-code-settings.json`. **Decision D11.**
- `settings.customStoragePath.description`: `D:\RooCodeStorage` example → `D:\TumbleCodeStorage`

All 18 NLS files: `package.nls.json` + `.ca`/`.de`/`.es`/`.fr`/`.hi`/`.id`/`.it`/`.ja`/`.ko`/`.nl`/`.pl`/`.pt-BR`/`.ru`/`.tr`/`.vi`/`.zh-CN`/`.zh-TW`.

### 4.3 i18n strings — `src/i18n/locales/<lang>/common.json` (× 19)

Mechanical replace per locale. Translations using grammatical agreement (German genitive, Polish/Russian declensions) may end up slightly awkward — accept the lint, fix in a follow-up locale pass. Track grammatical leftovers in a follow-up issue per locale.

### 4.4 Webview UI strings

Run the same replace pass over `webview-ui/src/i18n/locales/<lang>/*.json` (or wherever webview translations live — verify path before sed). Update any hardcoded `Roo Code` in React components/JSX.

### 4.5 README + localized READMEs

Top-level `README.md` and `locales/<lang>/README.md` (× 18). Required edits:

- Title: `# Roo Code` → `# Tumble Code`
- Subtitle/tagline: replace
- Badges block: marketplace badge URL → new extension ID (`marketplace.visualstudio.com/items?itemName=<D3>.<D4>`); X badge → `@tumblecode` (D6); YouTube/Discord/Reddit badges → new handles or drop
- **New "Lineage" section** near the top: a 2-3 paragraph block explaining this is a community fork of the original Roo Code by Matt Rubens & RooVeterinaryInc, that the original team is moving to Roomote, and Tumble Code is independent from this point forward. Link to the original repo and the original team's announcement.
- "What's New" section: replace with Tumble Code's own changelog excerpt
- Strip the existing "The Roo Code plugin is not going away" Roomote note (it's not our message to send)

### 4.6 Top-level docs

- `CONTRIBUTING.md` — replace Roo Code references, update repo URLs, drop "official Roo channels" verbiage
- `SECURITY.md` — replace security contact email/URL (D12 if not decided)
- `PRIVACY.md` — rewrite cloud section to describe the self-hosted-cloudapi model; drop references to Roo-team data handling
- `CODE_OF_CONDUCT.md` — replace project name, contact email
- `CHANGELOG.md` — leave existing entries (they describe Roo-era releases); add new top entry "Renamed to Tumble Code (community fork)" at current version + 1
- `AGENTS.md` — replace Roo references, keep agent-rules.org link if still relevant
- `COGNITIVE_COMPLEXITY_ANALYSIS.md` — name-only replace if any

### 4.7 LICENSE & attribution

- Do NOT remove existing copyright lines.
- Append: `Portions Copyright © 2026 Tumble Code contributors. This project is a community fork of Roo Code (originally by Roo Veterinary Inc.). See README for lineage.`
- Verify LICENSE type (Apache 2.0 / MIT?) permits forking under the same terms — quick read of `LICENSE` confirms before merging.

### 4.8 Cloud package — `packages/cloud/`

Code changes:

- `packages/cloud/src/config.ts:1-2`:
    ```ts
    export const PRODUCTION_CLERK_BASE_URL = process.env.TUMBLE_CLOUD_AUTH_URL ?? "http://localhost:8080/auth"
    export const PRODUCTION_ROO_CODE_API_URL = process.env.TUMBLE_CLOUD_API_URL ?? "http://localhost:8080"
    ```
    Keep the constant name `PRODUCTION_ROO_CODE_API_URL` (internal — rule 2). Same for `getRooCodeApiUrl()`.
- Tests that assert against `https://app.roocode.com` / `https://clerk.roocode.com` (10+ occurrences in `packages/cloud/src/__tests__/*.test.ts`): update fixture URLs to the new defaults. Don't change test logic — only the literal URL strings.
- Any UI strings inside cloud package (`Roo Code Cloud` in error messages) → `Tumble Code Cloud`.

### 4.9 Telemetry — `packages/telemetry/src/PostHogTelemetryClient.ts:39`

- Host `https://ph.roocode.com` → env-driven `process.env.TUMBLE_TELEMETRY_HOST ?? "http://localhost:8080/telemetry"` (or whatever endpoint `self-hosted-cloudapi/` exposes for ingest).
- If `self-hosted-cloudapi/` does not yet implement PostHog ingest, disable telemetry by default (skip client init when env var is unset) — fail soft, never silently send to Roo's PostHog.

### 4.10 Provider — `src/api/providers/roo.ts:47` & `src/extension.ts:213`

- Default URL `https://api.roocode.com/proxy` → `process.env.ROO_CODE_PROVIDER_URL ?? "http://localhost:8080/proxy"` (env var name stays — rule 2).
- UI label "Roo Code Cloud" provider → "Tumble Code Cloud" wherever the human-readable provider name appears (search webview-ui for the dropdown label).
- The provider class `RooHandler`, the model fetcher `roo.ts`, the spec file `roo.spec.ts` — all stay.

### 4.11 Marketing app — `apps/web-roo-code/`

Two options:

- **A (recommended):** Leave folder name as `apps/web-roo-code/` (rule 2 — internal), update site content/copy/metadata only. Lower risk, no broken imports.
- **B:** Rename to `apps/web-tumble-code/`. Requires updating `turbo.json`, `pnpm-workspace.yaml`, every cross-reference.

Default to A; reconsider during execution if the folder name is referenced externally (Vercel deploy hooks, CI).

### 4.12 Self-hosted cloud — `self-hosted-cloudapi/`

This is the destination for the env vars in §4.8–§4.10. Tasks here are out of scope for the rebrand branches but should be flagged:

- Confirm the service implements: auth (Clerk replacement), share-link issuance, telemetry ingest, LLM proxy
- Document the env var names the extension expects, in `self-hosted-cloudapi/README.md`
- Ship a Docker compose or quickstart so a user can run `docker compose up` and have a working backend at `http://localhost:8080`

### 4.13 Logo & icon assets — `src/assets/icons/`

Files to replace:

- `icon.png` (used by marketplace + activity bar)
- `icon.svg` (SVG source)
- `icon-nightly.png` (nightly build variant)
- `panel_light.png`, `panel_dark.png` (sidebar branding)

Strategy: tumbleweed silhouette, single-color, square 1024×1024 master. Need source asset (D7). Until then, use a placeholder SVG and mark a TODO. Add `assets/icons/icon.svg.original-roo` to preserve the original (for attribution + diff history) — optional.

Also check `webview-ui/public/` and `apps/web-roo-code/public/` for additional logo files referenced by the webview/marketing site.

### 4.14 Tests with hardcoded brand strings

Scan: `grep -rln 'Roo Code\|roocode\.com\|RooVeterinaryInc' src/__tests__/ src/**/__tests__/ packages/*/src/__tests__/`. Update assertions that test display strings; leave assertions that test internal IDs (`roo-cline.something`) alone.

Known files from initial scan:

- `src/__tests__/extension.spec.ts`
- `src/__tests__/task-resume-ui.spec.ts`
- `src/utils/__tests__/git.spec.ts`
- `src/services/mdm/__tests__/MdmService.spec.ts`
- `src/services/checkpoints/__tests__/ShadowCheckpointService.spec.ts`
- `src/core/webview/__tests__/*.spec.ts` (multiple)
- `src/api/providers/fetchers/__tests__/roo.spec.ts`
- `packages/cloud/src/__tests__/*.test.ts`

### 4.15 Build, CI, release artifacts

- `bin/` scripts — check for hardcoded extension names in install/install-vsix scripts
- `scripts/install-vsix.js` — likely greps for `roo-cline-*.vsix` filename; update glob to match new `tumble-code-*.vsix`
- `apps/vscode-nightly/` — nightly build pipeline references the extension name; update
- `releases/` folder — leave historical artifacts as-is, new releases use new name
- `package.json` root `name: "roo-code"` → `"tumble-code"`
- `pnpm-workspace.yaml` — no change needed (uses globs)
- `.github/workflows/*` (if present) — replace any hardcoded `roo-code`/`Roo-Code` references in workflow yaml, especially release upload steps and any VSCE publish steps that reference the publisher

### 4.16 Settings-import bridge (D9 — recommended yes)

On first activation of Tumble Code, if the user has Roo Code installed (detect via `vscode.extensions.getExtension('RooVeterinaryInc.roo-cline')`), offer a one-shot dialog: "Import settings from Roo Code?" → copies extension storage (`globalState`, `secrets`, custom storage path contents). Implementation: `src/activate/migrateFromRoo.ts` (new file), called from `extension.ts` activate(). Idempotent — flag `tumble-code.migrationCompleted` in globalState.

---

## 5. Branch strategy

Per [[feedback_separate_branch_per_feature]], one branch per functionality, stacked when files overlap. Proposed stack (each builds on the previous):

| #   | Branch                               | Scope                                                              | Files                                                                                        |
| --- | ------------------------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| 1   | `rebrand/01-manifest-and-nls`        | Extension manifest + 18 NLS files                                  | `src/package.json`, `src/package.nls*.json`                                                  |
| 2   | `rebrand/02-readme-and-docs`         | All `.md` at repo root + `locales/*/README.md`                     | README, CONTRIBUTING, SECURITY, PRIVACY, CODE_OF_CONDUCT, AGENTS                             |
| 3   | `rebrand/03-i18n-strings`            | `src/i18n/locales/*/common.json` + webview-ui locales              | 19 locale dirs each side                                                                     |
| 4   | `rebrand/04-cloud-urls`              | `packages/cloud/src/config.ts` + tests + telemetry + provider URLs | `packages/cloud/**`, `packages/telemetry/**`, `src/api/providers/roo.ts`, `src/extension.ts` |
| 5   | `rebrand/05-icons`                   | Logo + panel assets                                                | `src/assets/icons/*`, plus webview/marketing public/                                         |
| 6   | `rebrand/06-license-and-attribution` | LICENSE append + README lineage section                            | `LICENSE`, `README.md` (lineage paragraph only)                                              |
| 7   | `rebrand/07-settings-import-bridge`  | First-run migration from `roo-cline`                               | new `src/activate/migrateFromRoo.ts`, hook into `extension.ts`                               |
| 8   | `rebrand/08-build-and-release`       | VSIX naming, nightly pipeline, CI yaml                             | `apps/vscode-nightly/**`, `scripts/install-vsix.js`, `.github/workflows/**`                  |

Each branch ships independently. PR titles use the branch slug. Each PR carries its own paired ai_plan doc OR references this master plan ([[2026-05-26_rebrand-roo-to-tumble-code]]) — pick whichever per branch.

---

## 6. Validation steps (per branch)

1. `pnpm install --frozen-lockfile && pnpm clean && pnpm check-types && pnpm lint && pnpm test`
2. `pnpm vsix` — verify VSIX builds with new name/publisher
3. Install the VSIX into a clean VS Code profile: confirm displayName, sidebar title, command palette entries, settings panel title
4. Manual smoke: open a chat, run a tool call, check that the activity bar icon renders the tumbleweed
5. For branch 4 (cloud URLs): run `self-hosted-cloudapi` locally, sign in, exercise share link, check telemetry events land in the local PostHog (or are silently dropped if disabled)
6. For branch 7 (migration): install both `RooVeterinaryInc.roo-cline` and `<publisher>.tumble-code` side by side; verify import dialog appears, settings copy correctly, idempotent on re-activation

---

## 7. Rollback

Each branch is small and independent enough to revert via `git revert`. The riskiest branches are:

- Branch 4 (cloud URLs) — wrong env var name breaks paid features for early users. Mitigation: keep `ROO_CODE_PROVIDER_URL` as the env var name (don't rename), only swap defaults.
- Branch 7 (migration) — bad migration overwrites Tumble Code settings with stale Roo settings. Mitigation: guarded by `migrationCompleted` flag, copies into a backup file first.

Logo rollback: keep original `icon.svg` saved in repo history (`git log -p src/assets/icons/icon.svg` retrievable), no need to keep it in-tree.

---

## 8. Out of scope (explicit non-goals)

- Renaming `roo-cline.*` command IDs, view IDs, or config keys (rule 2)
- Renaming `ClineProvider`, `RooHandler`, `Roo*` TS classes/types (rule 2)
- Building the self-hosted cloud backend itself — `self-hosted-cloudapi/` already exists; rebrand just points URLs at it
- Marketplace publishing flow — separate task once a publisher ID is registered (D3)
- Translation grammatical cleanup — track as follow-up per locale
- Removing PostHog client entirely — telemetry stays optional, just self-hosted (D8)

---

## 9. Open additions discovered during planning

- D10: `galleryBanner.color` — current is `#617A91` (slate blue). Tumbleweed suggests warm/sandy: `#B8895A` or similar — pick during icon design
- D11: Auto-import config filename — `roo-code-settings.json` legacy support? Suggested: accept both, prefer `tumble-code-settings.json`
- D12: Security contact email for `SECURITY.md`

---

## 11. Config namespace migration (discovered during branch 1 implementation)

The original plan assumed config property keys (e.g. `roo-cline.allowedCommands`) could stay as internal identifiers. Implementation revealed otherwise:

- Production code reads settings via `vscode.workspace.getConfiguration(Package.name)` at 20+ call sites
- `Package.name` is derived from `process.env.PKG_NAME ?? package.json#name` in [src/shared/package.ts:11](src/shared/package.ts#L11)
- Stable build has no `PKG_NAME` esbuild override, so changing manifest `name` from `roo-cline` to `tumble-code` shifts the runtime config namespace to `tumble-code.*`
- The manifest's `contributes.configuration.properties` keys define the JSON-Schema that backs VS Code's Settings UI and the keys stored in user `settings.json`
- If schema keys stay at `roo-cline.*` but runtime reads from `tumble-code.*`, the extension can't see any of its own settings

**Resolution:** Branch 1 renames all 18 config property keys in `src/package.json` from `roo-cline.*` to `tumble-code.*` to match the runtime namespace. This commits the project to a config-key migration in user `settings.json`.

**Branch 7 expanded scope:** in addition to copying `globalState`/`secrets` from the `RooVeterinaryInc.roo-cline` extension, the migration bridge must also rewrite user-settings keys:

```jsonc
// before
"roo-cline.allowedCommands": [...]
"roo-cline.debugProxy.enabled": true
// after migration
"tumble-code.allowedCommands": [...]
"tumble-code.debugProxy.enabled": true
```

The full list of 18 keys to migrate is the set under `contributes.configuration.properties` in the manifest at HEAD of `rebrand/01-manifest-and-nls`. Workspace-level settings (`.vscode/settings.json` in user projects) and global settings (`settings.json`) both need rewriting; the bridge should be idempotent and back up the originals before writing.

**Internal IDs that stay `roo-cline.*` (NOT migrated by branch 7):** all `commands[].command`, view IDs (`roo-cline.SidebarProvider`, `roo-cline-ActivityBar`), submenu IDs (`roo-cline.contextMenu`, `roo-cline.terminalMenu`), and the `when` clauses that reference them. These are runtime command/view identifiers, not user-edited config keys.

---

## 10. References

- Original Roo Code repo: `https://github.com/RooCodeInc/Roo-Code`
- Roomote announcement (context for fork): linked from current README "What's New"
- Self-hosted cloud subproject: `self-hosted-cloudapi/` (Python, alembic-managed schema)
- Related memory: [[feedback_separate_branch_per_feature]], [[feedback_ai_plans_markdown]]
