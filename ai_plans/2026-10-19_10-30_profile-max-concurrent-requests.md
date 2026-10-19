# Max concurrent requests per provider profile (configuration)

**Status:** configuration implemented on `feat/profile-max-concurrent-requests`; enforcement pending (see Notes)
**Related plans:** `2026-10-19_10-00_subagents-background-wait.md` (branch 2 of that plan)
**Touched:** `packages/types/src/provider-settings.ts`, `provider-config/shared.ts`, `provider-profile.ts`,
`provider-concurrency.ts` (new), `index.ts`, type tests and snapshots;
`webview-ui/src/components/settings/MaxConcurrentRequestsControl.tsx` (new), `ApiOptions.tsx`, 18 `settings.json`
locales, tests; `apps/cli/src/types/types.ts`, `apps/cli/src/lib/utils/model-settings.ts`, `provider-config.ts`,
tests, `apps/cli/README.md`, `apps/cli/examples/`; `docs/04-tools-and-providers.md`, `docs/07-cli.md`; two changesets.

## Problem

The owner: "Every model has a limited pool of context and of parallel requests. Add to the configuration a separate
number: max concurrent requests to the provider, which will be the cap on the number of spawned agents. I want to
steer the number of subagents per model used. The same for the CLI, and fill in the example configuration."

Today the only limit is the global `parallelTasksMaxConcurrency` (default 3, max 8), the same for every profile. A
local server with 2 parallel slots and a hosted plan that takes 8 requests at once get the same number of subagents,
so the small server queues requests (or times out) and the large one is underused.

## Change

- `ProviderSettings.maxConcurrentRequests`: optional whole number, 1 or more. Unset means no per-profile cap (only the
  global setting applies). It is a shared profile field (`sharedProfileSettingsSchema`, `sharedFieldNames`), so it is
  saved, exported and imported with the profile like `consecutiveMistakeLimit`.
- `subagentSlotsForProfile(maxConcurrentRequests, parentUsesProfile)` in `packages/types/src/provider-concurrency.ts`:
  `undefined` without a limit, else `max(0, limit - (parentUsesProfile ? 1 : 0))`. The parent task counts as one
  request when it runs on the same profile, because its next request goes to the same server while the subagents work.
- Settings UI: "Max concurrent requests" number field under the error and repetition limit in the profile settings,
  empty = no limit (placeholder "No limit"), bound through `setApiConfigurationField`, so it edits the settings draft
  like the other profile fields. With a limit set, a second line shows the slots left for subagents when the main
  task runs on the profile (`subagentSlotsForProfile(value, true)`), which makes "the main task counts as one"
  concrete and gives the helper its first production caller. Not added to the static search index: profile fields are not indexed there (the
  providers tab registers its own entries at runtime and the profile controls have none).
- CLI: `models.<id>.maxConcurrentRequests`, validated like `contextWindow` (whole number above 0), in
  `ANY_PROVIDER_KEYS` (works with every provider, never reported as ignored). `applyModelSettings` writes it into the
  extension `ProviderSettings` always (undefined clears a value an earlier run left in the extension state), so the
  base profile and every per-mode profile in `cliModeProviderSettings` carry the limit of the model that mode runs.
  A subagent started in mode X gets `modes[X] ?? base` (`ModeProfileBinding`), so it gets that model's limit.
- Example settings: GLM-5.3-Flash-NVFP4 4, GLM-5.3-NVFP4 2, Qwen3.8-4B 1, claude-sonnet-5-5 8.

## Tests

- `packages/types/src/__tests__/provider-concurrency.spec.ts`: the helper (no limit, parent elsewhere, parent on the
  profile, limit 1 with the parent) and the schema (1 and 8 accepted, 0, -2 and 1.5 rejected). Shared-field lists in
  three specs and the two schema snapshots updated.
- `webview-ui/src/components/settings/__tests__/MaxConcurrentRequestsControl.spec.tsx` (empty field, stored value,
  typed and cleared values, slots line: 3 for a limit of 4, 0 for 1, absent without a limit) and one wiring case in
  `ApiOptions.spec.tsx` (value shown, typed and cleared values reach `setApiConfigurationField`, hidden in the welcome
  view).
- `apps/cli`: validation and `listSetModelSettings` in `model-settings.test.ts`; `toProviderSettings` and `withModel`
  carry and clear the field in `provider-config.test.ts`; `run.test.ts` checks that the base and per-mode profiles get
  the limit of their own model; `settings-example.test.ts` keeps the example and both READMEs in step.

## Notes

- Enforcement lands after `feat/subagents-background-wait`: that branch adds the slot pool `run_parallel_tasks` will
  draw from, and branch 2 then caps each profile with `subagentSlotsForProfile` and refuses a fan-out that could never
  start (limit 1 with the parent on the profile) with a message telling the model to do the work itself. Until then the
  field is stored and shown but does not limit anything.
- The CLI has no way to set the global `parallelTasksMaxConcurrency`; a CLI run uses the default (3).
