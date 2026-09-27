# D14 — Finish rebrand of user-visible "Roo Code" strings → "Tumble Code"

Roadmap item D14 from `ai_plans/2026-09-27_simplification-roadmap.md`.

## Goal

Three audited residual user-visible "Roo Code" strings remain after the earlier
rebrand (public strings change; internal ids `roo`/`@roo-code/*`/`ROO_*`,
env vars, config keys, file paths and i18n keys stay). Change only those
strings — no repo-wide sweep.

Branch: `feature/d14-user-visible-rebrand-strings` off `main` (NOT stacked on
D6, which touches unrelated files).

## Residuals (each re-verified on 2026-09-27 to still say "Roo Code")

### 1. `packages/cloud/src/WebAuthService.ts` — auth notifications

The audit pointed at "around line 89" (the class declaration). The actual
user-visible literals are the three `vscode.window.showInformationMessage`
calls; all other "Roo Code Cloud" occurrences in the file are dev-facing log
lines (`this.log(...)`) or thrown `Error` messages whose only caller
(`src/core/webview/messageHandlers/cloudAuth.ts:75-90`) catches them and shows
a generic toast ("Sign in failed." / "Sign out failed."), so the raw text never
reaches the user. Logs and thrown errors are left unchanged (when unsure,
leave it and note it — these are not user-visible).

| Line | Before                                             | After                                                 |
| ---- | -------------------------------------------------- | ----------------------------------------------------- |
| 312  | `"Invalid Roo Code Cloud sign in url"`             | `"Invalid Tumble Code Cloud sign in url"`             |
| 348  | `"Successfully authenticated with Roo Code Cloud"` | `"Successfully authenticated with Tumble Code Cloud"` |
| 383  | `"Logged out from Roo Code Cloud"`                 | `"Logged out from Tumble Code Cloud"`                 |

Brand convention check: the codebase already says "Tumble Code Cloud" in
`src/i18n/locales/en/common.json` (cloud_auth_required etc.),
`webview-ui/src/i18n/locales/en/cloud.json`, and
`src/package.nls.json` — these notifications match that convention.

**Test updates required** — `packages/cloud/src/__tests__/WebAuthService.spec.ts`
asserts the notification strings at lines 327, 330, 373, 487, 499, 522. Those
assertions must be updated to the new strings. The log/error assertions
(lines 311-312, 337, 446, 1130) stay because the underlying strings are
unchanged.

### 2. Custom modes JSON schema title/description

The schema is generated from zod by
[`generateRoomodesJsonSchema()`](packages/types/src/roomodes-schema.ts:46);
`schemas/roomodes.json` is the checked-in generated artifact guarded by a sync
test (`packages/types/src/__tests__/roomodes-schema-sync.spec.ts`). The title
and description are shown in editor hover/autocomplete for `.roomodes` /
`custom_modes.yaml` files, so they are user-visible.

| File                                    | Line    | Before                                                                                | After                                                                                    |
| --------------------------------------- | ------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `packages/types/src/roomodes-schema.ts` | 53      | `"Roo Code Custom Modes"`                                                             | `"Tumble Code Custom Modes"`                                                             |
| `packages/types/src/roomodes-schema.ts` | 54      | `"Schema for .roomodes configuration files used by Roo Code to define custom modes."` | `"Schema for .roomodes configuration files used by Tumble Code to define custom modes."` |
| `schemas/roomodes.json`                 | 105-106 | (same two strings, generated)                                                         | regenerated via `pnpm --filter @roo-code/types generate:schema`                          |

The `$id` (line 52, pointing at `RooCodeInc/Roo-Code` on GitHub) is a schema
identifier URL, not a display string — left unchanged.

### 3. `packages/core/package.json` — public-facing description

| Line | Before                                                 | After                                                     |
| ---- | ------------------------------------------------------ | --------------------------------------------------------- |
| 4    | `"Platform agnostic core functionality for Roo Code."` | `"Platform agnostic core functionality for Tumble Code."` |

Package name `@roo-code/core` stays (internal id).

## Left intentionally (seen, not touched)

- `packages/cloud/src/WebAuthService.ts` log lines and thrown error strings
  ("Roo Code Cloud auth/callback/logout") — dev-facing; raw errors never shown
  to the user (caller substitutes generic toasts).
- `packages/cloud/src/config.ts` comments referring to "Roo Code API URL" —
  comments; the identifiers they describe (`getRooCodeApiUrl`,
  `PRODUCTION_ROO_CODE_API_URL`) are internal API names.
- `packages/cloud/src/__tests__/config.spec.ts` test descriptions ("production
  Roo Code API URL by default") — test titles, not user-visible.
- `schemas/roomodes.json` / `packages/types/src/roomodes-schema.ts` `$id` URL
  — schema identifier, not display text.
- Repo-wide sweep of every other "Roo Code" literal — explicitly out of scope.

## Edits

1. Three `showInformationMessage` strings in
   [`WebAuthService.ts`](packages/cloud/src/WebAuthService.ts).
2. Six spec assertions in
   [`WebAuthService.spec.ts`](packages/cloud/src/__tests__/WebAuthService.spec.ts)
   (the ones asserting the three notifications).
3. Title + description in
   [`roomodes-schema.ts`](packages/types/src/roomodes-schema.ts), then
   regenerate `schemas/roomodes.json` (`pnpm --filter @roo-code/types generate:schema`).
4. `description` in [`packages/core/package.json`](packages/core/package.json).
5. Changeset: patch for `@roo-code/cloud`, `@roo-code/types`, `@roo-code/core`.

## Verification

- `cd packages/cloud && pnpm vitest run` (WebAuthService.spec.ts updated).
- `cd packages/types && pnpm vitest run src/__tests__/roomodes-schema-sync.spec.ts` — proves the
  regenerated artifact matches the source.
- `cd packages/types && pnpm vitest run src/__tests__/roomodes-schema.spec.ts` — validates the
  schema still parses/validates sample configs.
- `cd packages/core && pnpm vitest run` (description change is inert, but run
  for completeness).
- `pnpm knip` — no NEW findings vs the main baseline (exit 1 pre-existing).
- No webview-ui changes → no webview typecheck needed.

## Acceptance criteria

- The three notification strings, the schema title/description (source AND
  generated artifact), and the core package description say "Tumble Code".
- Sync test passes without hand-editing `schemas/roomodes.json`.
- No changes to internal ids, package names, env vars, config keys, i18n keys,
  or file paths.
- Tests green in packages/cloud, packages/types, packages/core; knip baseline
  unchanged; changeset added; committed on
  `feature/d14-user-visible-rebrand-strings` (not pushed).
