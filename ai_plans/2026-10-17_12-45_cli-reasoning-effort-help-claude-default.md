# CLI `--reasoning-effort` help omits the Claude default

**Status:** done
**Related plans:** none (follow-up to #897)
**Touched:** `apps/cli/src/main.ts`, `apps/cli/README.md`, `apps/cli/src/__tests__/__snapshots__/argument-parser.test.ts.snap`, `.changeset/cli-reasoning-effort-help-claude-default-cli.md`

## Symptom

`tumble --help` said the reasoning effort defaults to "the model's reasoningEffort in the settings file's models,
then medium, or unspecified for the openai provider". The README table said "The model's entry, else `medium`".

## What the code does

`resolveReasoningEffort` in `apps/cli/src/lib/utils/provider-config.ts` picks, in order: the `--reasoning-effort`
flag, the model's `models` entry, the Claude model's own `reasoningEffort` from the shared model table (providers
anthropic, vertex, bedrock; e.g. Opus 5.5 runs at medium, most others at high), then `unspecified` for `openai`, else
`medium`. The third step came with #897; the help text and README were not updated.

## Fix

Text only: the help string and the README row now list the Claude step. The argument-parser snapshot is updated.
No behaviour change.

## Verification

- `npx vitest run src/__tests__/argument-parser.test.ts` in `apps/cli`: 31 passed.
