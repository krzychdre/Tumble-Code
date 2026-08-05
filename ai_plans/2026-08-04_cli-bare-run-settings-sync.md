# CLI bare-run settings-first (settings sync between the extension and the CLI)

**Date:** 2026-08-04
**Branch:** `feat/11-cli-bare-run-settings-sync` (created from `7393da590`, `feat/10-cli-provider-parity` HEAD)
**Status:** implemented

## Problem

Bare `tumble` (no flags, no prompt) currently cannot work from saved settings:

1. The CLI's `-m/--model` option registers a commander **default** (`DEFAULT_FLAGS.model`)
   in [`apps/cli/src/index.ts:51`](../../apps/cli/src/index.ts:51). Commander fills in the
   default even when the user passed no flag, so `flagOptions.model` is never `undefined`
   and `settings.model` from `~/.roo/cli-settings.json` is **shadowed on every run**.
2. Switching provider via `--provider openai` without `-m` keeps sending the persisted
   _openrouter_ model to the new provider (the persisted model was saved for a different
   provider and wins over the new provider's default).
3. The extension (VS Code GUI) configures provider/model/baseUrl only in its own
   globalStorage (real VS Code `state.vscdb`), which the CLI never reads — the CLI's
   mock-storage reader (`readVsCodeConfig`) only sees `~/.vscode-mock/` state written by
   the in-process `@roo-code/vscode-shim`. So settings made in the app never reach a bare
   CLI run.
4. `-w` already defaults to `process.cwd()` ([`apps/cli/src/commands/cli/run.ts:139`](../../apps/cli/src/commands/cli/run.ts:139)) — no change needed there beyond tests/documentation.

## Design

The **settings file is the shared contract** between the app and the CLI:

- Location: `~/.roo/cli-settings.json` (CLI's `getConfigDir()` in
  [`apps/cli/src/lib/storage/config-dir.ts:5`](../../apps/cli/src/lib/storage/config-dir.ts:5)).
- Shape (CLI `CliSettings`): `{ provider, model, baseUrl, ... }` — keys never nulled,
  undefined keys omitted (CLI `saveSettings` null-strips semantics).
- The extension **mirrors** its active `apiConfiguration` into this file:
    - on every `upsertProviderProfile` (the SettingsView/welcome "Save" path) and
      `activateProviderProfile` (profile switch / load),
    - once at extension activation when a config exists.
- The mirror is **best-effort** (try/catch, never breaks startup/save) and **never writes
  API keys** (same rule as the CLI's `run.ts` "API keys are never persisted" comment).

### CLI precedence (kept, now effective)

`flags > ~/.roo/cli-settings.json > mock VS Code config > defaults` — for provider, model,
baseUrl. With the `-m` commander default removed, a _defaulted_ model no longer clobbers a
persisted model; an **explicit** `-m` still wins.

### Provider/model coexistence (A3)

- `--provider X` with explicit `-m`: both flags win.
- `--provider X` without `-m`: use the persisted model **only when the persisted provider
  is the resolved active provider** (`settings.provider` resolves to `X`); otherwise use
  the default model for `X`.
- The model selection logic is extracted into a pure helper `resolveEffectiveModel()` so it
  is unit-testable without booting the extension host.

## Files

| File                                                  | Change                                                                                                                    |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `apps/cli/src/index.ts`                               | Remove the `-m/--model` commander default (keeps the flag, default resolved in `run()`).                                  |
| `apps/cli/src/commands/cli/run.ts`                    | Model resolution via helper; provider/model coexistence (A3); workspace precedence comment (unchanged behavior).          |
| `apps/cli/src/commands/cli/run.ts` (new helper)       | `resolveEffectiveModel(flagModel, settings, activeProvider)` — pure, exported for tests.                                  |
| `apps/cli/src/commands/cli/__tests__/run.test.ts`     | Tests for A3 resolution + bare-run workspace default `process.cwd()`.                                                     |
| `src/utils/cliSettingsMirror.ts` (new)                | `buildCliSettingsFromApiConfiguration()` pure mapper + `writeCliSettingsMirror()` best-effort read→merge→write (no keys). |
| `src/utils/__tests__/cliSettingsMirror.spec.ts` (new) | Unit tests for mapping + merge.                                                                                           |
| `src/extension.ts`                                    | Activation-time mirror when a config exists.                                                                              |
| `src/core/webview/ClineProvider.ts`                   | Mirror calls in `upsertProviderProfile` / `activateProviderProfile`.                                                      |

## Test plan

- CLI (unit, `cd apps/cli && npx vitest run`): model resolution helper; provider/model
  coexistence; bare run uses `process.cwd()` when `-w` omitted; persisted model applies
  only for the same provider.
- Extension (unit, `cd src && npx vitest run`): `buildCliSettingsFromApiConfiguration`
  mapping (openrouter/openai/anthropic, no key fields), merge preserves unrelated keys,
  best-effort failure, activation mirror.
- Lint `pnpm exec eslint`, typecheck `tsc -p` per package, build `cd apps/cli && pnpm build`.

## Usage (end result)

- Konfiguracja w aplikacji (VS Code) → zapis do `~/.roo/cli-settings.json` przy każdym
  zapisie/aktywacji profilu oraz przy starcie rozszerzenia.
- `tumble` (bare, z bieżącego katalogu) startuje z providerem/modelem/baseUrl z
  `~/.roo/cli-settings.json`; `-w` domyślnie = `pwd`.
- Flagi wciąż mają pierwszeństwo; `--provider X` bez `-m` używa zapisanego modelu tylko gdy
  zapisany provider == X.

## Fixes (2026-08-05)

Two real user-reported bugs found in the settings-sync path:

### Bug 1 — baseUrl was never persisted (or dropped on every run)

- **Root cause:** `run.ts` built `pendingSettings` with `provider`/`model` but never filled
  `pendingSettings.baseUrl` (and a hand-edited file with provider+model but no baseUrl key
  stayed without one — the openai handler then fell back to `https://api.openai.com/v1`).
- **Chosen semantics:** on a successful run the CLI persists the **effective** baseUrl
  (flag > settings > VS Code config) **only when it differs** from what is already in the
  file (no rewrite churn), and **only for a provider whose schema has a base-url field**
  (`getBaseUrlField()` — providers such as `unbound`/`baseten`/`vercel-ai-gateway` never get
  a `baseUrl` key). A hand-edited file with no baseUrl key is left untouched on a bare run.

### Bug 2 — model kept being rewritten to `anthropic/claude-opus-4.6` (the default) on every run

- **Root cause (a):** `run.ts` persisted the **effective** model. When the active provider
  differed from the persisted provider (or the model resolved to the built-in
  `DEFAULT_FLAGS.model`), that fallback default was written back into `cli-settings.json`,
  clobbering the user's model (e.g. `DeepSeek-V4-Flash-0731`).
  **Fix:** the model is persisted **only when it is explicitly tied to the active provider** —
  an explicit `-m`, or the persisted settings model whose provider matches the active one
  (via `resolveEffectiveModel()`). A VS Code-config/default model is **never** written back.
- **Root cause (b):** `src/utils/cliSettingsMirror.ts` used a hardcoded `MODEL_ID_FIELDS`
  list with `openRouterModelId` first — not provider-aware. With both `openRouterModelId`
  (stale `anthropic/claude-opus-4.6`) and `openAiModelId` present in globalState, it picked
  the stale openrouter model even though `apiProvider=openai`.
  **Fix:** the mirror now uses a provider-aware `providerFieldMap` (model + baseUrl field per
  provider, aligned with the CLI's `getModelField()`/`getBaseUrlField()`), so a model/baseUrl
  from another provider is never mirrored. `buildCliSettingsFromApiConfiguration()` stays
  pure; the existing 11 mirror tests still pass, extended with the stale-openrouter regression.
- **Also fixed:** the CLI's persistence path could still pick a VS Code-config model saved by
  the extension for a _different_ provider than the active CLI provider; that cross-provider
  value is no longer written into the CLI settings file.
