# CLI: `--mode` and `--reasoning-effort` defaults shadowed the settings file

**Status:** fixed on `fix/cli-flag-defaults-shadow-settings` (branch 1 of 4, stacked)
**Stack:** 1. this branch, 2. `refactor/cli-settings-user-owned`, 3. `feat/cli-settings-api-key`, 4. `feat/cli-per-mode-provider-settings`
**Related plans:** `2026-08-04_cli-bare-run-settings-sync.md` (removed the same kind of default for `-m`)
**Touched:** `apps/cli/src/index.ts`, `apps/cli/src/__tests__/flag-defaults.test.ts` (new),
`apps/cli/src/commands/cli/__tests__/run.test.ts`, `apps/cli/README.md`

## Symptom

The user wants to stop typing provider, base URL, model and reasoning effort on every
`tumble` run. Their shell history is almost entirely the full form:

```
tumble --provider openai --api-key 1111 --base-url http://192.168.50.194:11111/v1 --model GLM-5.3-NVFP4 --reasoning-effort high
```

`CliSettings` already has `mode` and `reasoningEffort` fields, and `run.ts` resolves
`flagOptions.X || settings.X || DEFAULT_FLAGS.X`, so a value in `~/.roo/cli-settings.json`
looked like it should work. It never did.

## What was happening

`index.ts` registered commander defaults for both options:

```ts
.option("--mode <mode>", "...", DEFAULT_FLAGS.mode)                   // "code"
.option("-r, --reasoning-effort <effort>", "...", DEFAULT_FLAGS.reasoningEffort) // "medium"
```

Commander fills a registered default in even when the flag is absent, so `flagOptions.mode`
was always `"code"` and `flagOptions.reasoningEffort` always `"medium"`. The `||` chain in
`run.ts` therefore never reached `settings.mode` / `settings.reasoningEffort`. The
2026-08-04 plan fixed exactly this for `-m`; these two options kept the pattern.

## Fix

Drop both commander defaults. `run.ts` already falls back to `DEFAULT_FLAGS` after the
settings value, so behaviour without a settings value is unchanged. The help text now names
the fallback and lists the reasoning efforts from `REASONING_EFFORTS` (the hard-coded list
was missing `max`).

## Tests

- `flag-defaults.test.ts` imports the real `index.ts` with the command actions mocked and
  checks the options commander hands to `run`. Against `main`'s `index.ts` it fails with
  `expected 'code' to be undefined`; with the fix it passes.
- `run.test.ts`: settings `mode` / `reasoningEffort` reach the extension host on a bare run,
  explicit flags win over them, and `code` / `medium` remain the fallbacks.

## Notes

Options after the positional prompt are not parsed (`passThroughOptions()`), so flags must
come before the prompt text. That is existing behaviour, not changed here.
