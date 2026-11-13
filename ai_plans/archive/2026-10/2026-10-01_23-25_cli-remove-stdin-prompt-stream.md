# B5: remove the CLI `--stdin-prompt-stream` mode

**Status:** done on `chore/cli-remove-stdin-prompt-stream` (simplification round 2, item B5; owner decision: remove).

## Touched files

- Deleted: `apps/cli/src/commands/cli/stdin-stream.ts`, `apps/cli/src/commands/cli/stdin-stream/**` (session, router,
  parse, queue tracker, end-of-stdin waits, five command handlers), `apps/cli/src/commands/cli/cancellation.ts`, their
  specs (`stdin-stream`, `parse-stdin-command`, `cancellation`, `run-resume-bootstrap`,
  `json-event-emitter-control`), the 15 stdin cases of the integration suite and `scripts/integration/lib/stream-harness.ts`.
- `apps/cli/src/commands/cli/run.ts`: flag checks, the stdin resume bootstrap (`isLiveResumeAskWaiting`), the
  `--signal-only-exit` keep-alive and parking, the request id plumbing into the emitter.
- `apps/cli/src/main.ts`, `apps/cli/src/types/types.ts`: the two flags.
- `apps/cli/src/lib/process-guards.ts`: the `keepAlive` and `isExpectedError` options (only the stdin mode set them).
- `apps/cli/src/agent/json-event-emitter.ts`: see Fix.
- `apps/cli/src/agent/extension-host.ts`, `extension-client.ts`: methods only the stdin mode called.
- `apps/cli/src/types/json-events.ts`, `packages/types/src/cli.ts`: event types.
- `apps/cli/scripts/integration/`: new `lib/print-harness.ts` and two print-mode cases.
- `apps/cli/README.md`, `.github/workflows/code-qa.yml` (job comment), argument-parser help snapshot.
- `.changeset/`: one new changeset; the two pending changesets that described fixes to the removed mode
  (`cli-stdin-stream-stuck-task-exit.md`, `f1-cli-resume-ask-race.md`) are deleted so the release notes do not
  announce fixes to a mode that no longer exists.

## Problem

`--stdin-prompt-stream` (NDJSON `start`/`message`/`cancel`/`ping`/`shutdown` commands on stdin) had no caller outside
its own tests: a grep of `scripts/`, `self-hosted-cloudapi/`, `apps/vscode-e2e/` and `packages/agent-interchange/` for
`stdin-prompt-stream` finds nothing. It cost about 1,150 lines in `commands/cli/stdin-stream*`, a second command output
path in `JsonEventEmitter` (four maps and a 250 ms grace timer merging `commandExecutionStatus` updates with
`say:command_output`, `json-event-emitter.ts:114-115,139-148,412-461,709-718,802-824` at `65fdaba16`), a cancellation
classifier that returned `false` for every other mode (`cancellation.ts:107`), keep-alive options in the process guards,
and the whole CLI integration suite (all 15 cases drove the stdin protocol, including the flaky F1 case
`create-with-session-id-resume-loads-correct-session`).

## Fix

- Delete the mode, its flags, help text and README section.
- `JsonEventEmitter`: drop `emitControl`, `emitQueue`, `emitCommandOutputChunk`, `markCommandOutputExited`,
  `emitCommandOutputDone`, the grace timer and its maps (`statusDrivenCommandOutputIds`, `completedCommandOutputIds`,
  `pendingCommandCompletionByToolUseId`), the `requestIdProvider`/`schemaVersion`/`protocol`/`capabilities` options and
  the unused `getEvents`/`clear`. Command output now has one path: `say:command_output`, reported under the id of the
  `execute_command` tool use, as a delta in `stream-json`. 969 lines become 750. The `completedCommandOutputIds` check
  could only fire after a status-driven completion: without that path an id is cleared from "active" at the moment it
  completes, so the set never matched.
- The init event keeps `schemaVersion: 1` and `protocol: "roo-cli-stream"` (consumers may check them) but loses
  `capabilities`, which listed only the removed stdin commands.
- `packages/types/src/cli.ts`: delete the input command schemas, the control and queue event schemas and the event
  fields only those events carried (`requestId`, `command`, `taskId`, `code`, `queueDepth`, `queue`, `capabilities`,
  `tool_result.exitCode`). The output schemas stay: their types are the CLI's JSON event types.
  `apps/cli/src/types/json-events.ts` no longer re-declares every field on top of them.
- `ExtensionHost.runTask` loses the `configuration`/`images` parameters (only the stdin `start` command passed them);
  `ExtensionHost.getAgentState`/`isWaitingForInput` and `ExtensionClient.hasActiveTask`/`getCurrentAsk`/`cancelTask`
  had no other caller.
- The integration suite keeps its runner, the scripted model, the `ROO_CLI_FAKE_AI_MODULE` hook and the CI job, and
  now runs two print-mode cases: `print-stream-json-completes` (init event, prompt echo, one successful result with
  the answer and a cost) and `print-json-command-output` (a shell command's tool use and its output under the same id
  in the `json` object). Without them the CI job would have had nothing to run.

## Tests

- `apps/cli`: full suite, `vitest run --maxWorkers=2`: 102 files passed, 1 skipped (1320 tests).
- The `print-and-json-output` characterization snapshots changed only by the removed `capabilities` field (22 snapshots).
- `packages/types`: `src/__tests__/cli.test.ts` (2 tests).
- Integration suite run locally against the existing extension bundle: 2/2 passed.
- `tsc --noEmit` in `apps/cli` and `packages/types`, eslint, prettier, `pnpm knip`.

## Notes

- Output change for `stream-json`/`json` users: the init event has no `capabilities` field any more. No other field of
  the print-mode output changes (the removed fields were only ever set by the stdin mode).
- The F1 flake goes away with its case; the resume path of print mode (`--session-id`) is unchanged and is covered by
  the unit specs of `ExtensionHost.resumeTask` and the delivery reader.
