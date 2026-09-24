# Zoo #1637 port: skill, slash command, switch_mode and MCP allowlist use the task's mode

**Status:** ported, one commit on the zoo port branch (stacks on the #1625 port)
**Upstream:** Zoo-Code #1637 (commit 1a0f8fc04), by PierrunoYT
**Touched:** `src/core/tools/SkillTool.ts`, `src/core/tools/RunSlashCommandTool.ts`, `src/core/tools/SwitchModeTool.ts`, `src/core/tools/mcpServerRestriction.ts`, their specs

## Symptom

Four tools still resolved the mode from provider state, which holds the FOCUSED task's mode. A
task running in another mode (parallel subagent, memory writer, background task while the user
switches modes) therefore:

- `skill`: looked up skills (and listed "available skills") for the wrong mode;
- `run_slash_command`: fell back to a skill of the wrong mode;
- `switch_mode`: answered "Already in X mode" by the wrong mode, refusing a real switch or
  accepting a no-op one, and named the wrong "switched from" mode;
- MCP execution guard: applied the wrong mode's `allowedMcpServers` allowlist, so a restricted
  subagent could call servers its own mode forbids (or be blocked from allowed ones).

## Root cause in our code

- `SkillTool.ts:47-48`: `state?.mode ?? "code"`.
- `RunSlashCommandTool.ts:58`: `state?.mode ?? "code"`.
- `SwitchModeTool.ts:42`: `(await provider.getState())?.mode ?? defaultModeSlug`.
- `mcpServerRestriction.ts:46`: `state?.mode ?? defaultModeSlug`.

## Fix

All four use `await task.getTaskMode()`, the same source the #1625 port moved the per-turn readers
to. Provider state is still read for what really is global (custom modes, experiments, mode
prompts). `defaultModeSlug` imports that became unused are removed; the fallback now lives in
`Task.getTaskMode()`.

## Tests

New cases set provider mode `"code"` and task mode `"architect"` (or the restricted custom mode):

- `skillTool.spec.ts`: skill lookup and the available-skills list use the task mode (failed:
  called with `"code"`).
- `runSlashCommandTool.spec.ts`: the skill fallback uses the task mode (failed: `"code"`).
- `switchModeTool.spec.ts`: "already in mode" follows the task mode (failed: it switched and said
  "Successfully switched from Code mode"); the old "reads mode from provider state" test is
  rewritten to the new contract.
- `mcpServerRestriction.spec.ts`: a task in the restricted custom mode gets its allowlist while
  provider state says an unrestricted mode (failed: `undefined`, meaning unrestricted).

Mock tasks gained `getTaskMode`. `core/tools`, `core/assistant-message`, `core/task`: 98 files,
1272 tests pass. tsc and eslint clean.

## Not ported

- Zoo's `eslint-suppressions.json` count change (we have no suppression entry for that spec).
- Follow-up, out of scope: `switch_mode` (and a slash command's `mode:`) still switch through
  `provider.handleModeSwitch`, which always acts on the FOCUSED task. Run from a background task,
  the check is now right but the switch itself lands on the user's task.
