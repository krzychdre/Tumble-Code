# CLI: drop the `-k, --api-key` option (security audit 2026-11-06, C-10)

**Status:** done on `fix/sec-cli-drop-api-key-flag`
**Touched:** `apps/cli/src/main.ts`, `src/types/types.ts`, `src/commands/cli/run.ts`, `src/commands/cli/list.ts`,
`src/lib/storage/mode-model.ts`, `README.md`, `scripts/integration/lib/print-harness.ts`, tests.

## Problem

`tumble -k <key>` put the provider key in argv, readable by every local user through `ps` and
`/proc/<pid>/cmdline`, and in shell history.

## Fix (owner decision)

The option is removed from the run command and from `list commands|modes|sessions`. Keys come only from the
settings file (`apiKey`, `apiKeyEnv`, top level, mode or model entry) or the provider's env var
(`resolveProviderConfig` already handled both). The flag layer of the provider resolution now carries provider,
model and base URL only. Error and hint texts and the README no longer mention the flag; the integration harness
passes `ANTHROPIC_API_KEY` in the environment.

## Tests

`argument-parser.test.ts`: `--api-key` and `-k` on the run command and `--api-key` on `list modes` fail with
commander's "unknown option" and exit 1 (red when the option is put back). `run.test.ts` cases that leaned on the
flag key now set the provider's env var.

## Notes

Breaking for scripts that pass `-k`; the changeset gives the migration.
