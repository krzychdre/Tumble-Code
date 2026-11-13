# D2: no literal settings defaults at call sites (roadmap 2026-09-27, Priority 2)

Roadmap item D2 (`ai_plans/2026-09-27_simplification-roadmap.md:83`): `TaskApiLoop` hard-codes
`autoCondenseContext = true` / `autoCondenseContextPercent = 100`, `RetryHandler` uses
`requestDelaySeconds || 5`. Fix: `?? SETTINGS_DEFAULTS.key`, plus a grep check in CI so a literal
default on a settings key cannot come back.

## Inventory (main @ d691671d, after D1)

| Site                                      | Today                                        | Change                                                                                                                                                     |
| ----------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/task/TaskApiLoop.ts:1318`       | `autoCondenseContext = true`                 | `?? SETTINGS_DEFAULTS.autoCondenseContext`                                                                                                                 |
| `src/core/task/TaskApiLoop.ts:1319`       | `autoCondenseContextPercent = 100`           | `?? SETTINGS_DEFAULTS.autoCondenseContextPercent`                                                                                                          |
| `src/core/task/TaskApiLoop.ts:1320`       | `profileThresholds = {}`                     | keep `{}` — not a settings-table scalar default, it is a container the caller may treat as its own; a shared frozen default would risk accidental mutation |
| `src/core/task/RetryHandler.ts:101`       | `state?.requestDelaySeconds \|\| 5`          | `?? SETTINGS_DEFAULTS.requestDelaySeconds`                                                                                                                 |
| `packages/types/src/settings-defaults.ts` | `requestDelaySeconds` missing from the table | add `requestDelaySeconds: 5` (the value the `\|\| 5` implied)                                                                                              |

The CI guard (run over the whole repo) then found **25 literal defaults on table keys**, not
just the two the roadmap names — the full sweep is part of this PR, otherwise the guard could not
land green:

- `getEnvironmentDetails.ts` (`maxWorkspaceFiles`, `showRooIgnoredFiles`, `maxGitStatusFiles`,
  `includeCurrentTime`, `includeCurrentCost`), `processUserContentMentions.ts` (params),
  `TaskLifecycle.ts` + `ClineProvider.ts` (`currentApiConfigName`), `ExecuteCommandTool.ts`
  (state read + param), `ListFilesTool.ts`, `enhanceAndSearch.ts`, `ClineProvider.ts`
  resolveWebviewView terminal block — all values match the table except two forks:
    - `ClineProvider.ts:882` `terminalShellIntegrationDisabled = false` vs table `true` — the
      literal is dead (getState() resolves the table value), so aligning is a no-op in practice;
    - `getEnvironmentDetails.ts:230` `includeCurrentTime/includeCurrentCost = false` vs table
      `true` — same: resolveSettings fills `true`, the literal only fires when the provider is
      missing entirely. Aligning makes the no-provider edge case match the documented default. The
      stale "both default off" comment (pre-CORE-R1) is removed.
- Allowlisted with reasons (in `scripts/check-settings-defaults.mjs`):
    - `packages/types/src/web-tools.ts:100,101` — import cycle: `settings-defaults.ts` imports
      `WEB_TOOLS_DEFAULTS` from `web-tools.ts`, so the resolver there cannot read the table;
    - `src/extension/api.ts:358` — write path, where `\|\|` also guards the empty-string value a
      profile clear produces (a read-side `??` would save `""` as a config name).

`requestDelaySeconds` has no other readers (verified: no webview/CLI/activate hits; the only
other occurrence is the evals preset `DEFAULT_EVALS`-style override object with 10, which is a
preset, not a default).

## Behavior change (intentional, one)

`requestDelaySeconds || 5` coerced a user-set `0` to 5 s. With `??`, `0` now means what it says:
no retry backoff delay (`calculateBackoffDelay` returns 0 → `backoffAndAnnounce` returns at once;
the retry still happens, just without a countdown). `0` is a legitimate value for a "delay between
requests" setting; the `||` was masking it. Recorded in the changeset.

For users who never set the setting nothing changes: the effective default was 5 (via `|| 5`) and
the table now says 5, which `resolveSettings` fills into the state before `RetryHandler` reads it.

## CI guard

`scripts/check-settings-defaults.mjs`:

- parses the `settingsDefaults = { ... }` block of `packages/types/src/settings-defaults.ts`
  (regex per line: `key: literal,`) to get the keys that have a static default,
- scans `src/`, `packages/`, `apps/` `.ts`/`.tsx` (excluding `__tests__`, `*.spec.*`, `*.test.*`,
  the `settings-defaults.ts` source itself, and `node_modules`/`dist`) for a literal default on
  those keys: destructuring `key = <literal>` or `key ?? <literal>` or `key || <literal>`,
- exits 1 listing every hit; an inline allowlist (`ALLOWED`) documents justified exceptions
  (currently: none expected, the preset object in `global-settings.ts` writes defaults rather
  than reading them, so it is not a call site — the scan only flags reads).

Wired into `.github/workflows/code-qa.yml` as a step of the `knip` job, plus a unit test
`scripts/__tests__/check-settings-defaults.test.mjs` (runs under the existing
`node --test 'scripts/__tests__/*.test.mjs'` step) that proves: the parser reads the table, the
scanner flags a literal default on a table key, `?? SETTINGS_DEFAULTS.x` passes, and non-table
keys are ignored.

## Regression tests

- `packages/types/src/__tests__/settings-defaults.spec.ts`: `requestDelaySeconds` resolves to 5
  when unset, keeps an explicit value (including 0).
- `src/core/task/__tests__/RetryHandler.rate-limit-abort.spec.ts` sibling: add a case asserting
  `calculateBackoffDelay` with `requestDelaySeconds: 0` returns 0 (the `||`-masking regression).
- Existing ladder spec (`TaskApiLoop.no-auto-retry-auth-errors.spec.ts`, base 5 s) must pass
  unmodified.

## Acceptance criteria

- No literal default on a settings-table key in runtime code (`node scripts/check-settings-defaults.mjs` exits 0).
- `requestDelaySeconds` in `SETTINGS_DEFAULTS`, resolved everywhere via the table.
- Typecheck, lint, touched specs green; changeset added.
