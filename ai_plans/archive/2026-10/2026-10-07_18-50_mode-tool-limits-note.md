# TOOLS IN THIS MODE: tell a mode which tools it lacks

**Status:** done on `fix/mode-tool-limits-note` (stacked on `fix/capabilities-no-false-tool-promise`).
**Related plans:** `2026-10-07_18-41_capabilities-no-false-tool-promise.md` (the head no longer promises
tools), the empty-response retry fix in `src/core/task/TaskApiLoop.ts` (separate branch, other agent).
**Touched:** `src/core/prompts/sections/mode-tool-limits.ts` (new), `src/core/prompts/sections/index.ts`,
`src/core/prompts/system.ts`, `src/core/prompts/types.ts`, `src/core/prompts/system-prompt-input.ts`,
`src/core/task/ApiRequestBuilder.ts`, `CONTRIBUTING.md`, specs and prompt snapshots.

## Symptom

A task in Orchestrator mode (GLM-5.3-Flash on vLLM) looped forever on "Model Response Incomplete / API
Request Failed". The model's saved reasoning said, verbatim: "orchestrator mode can run execute_command too
presumably".

## Root cause

The orchestrator has `groups: []`, but nothing in its prompt said so. CAPABILITIES (stable head) promised
every mode command, read and write tools; the stacked-on branch made that text conditional ("When your tool
list includes ..."), but a mode-independent sentence cannot tell a weak model what THIS mode lacks, and a
literal reader still guesses. When it guesses `execute_command`, vLLM's GLM parser
(`validate_tool_names=True`) drops the call and the client sees an empty response.

## Fix

A new variable-tail section, built by `getModeToolLimitsSection(groups, { removedTools, exampleMode })`
and placed right after the MCP availability section (both change only with the mode):

- Derived from the resolved mode config's groups (`getModeBySlug` with custom modes, as `system.ts`
  already did for MCP), so custom modes are covered.
- Emitted only when the mode lacks at least one of `command`, `read`, `edit`; zero bytes otherwise, so
  code and debug prompts are byte-identical to before.
- Names each missing capability with its tools, says a call to a tool outside the tool list is rejected
  and returns nothing, and names the way out: `new_task` and `switch_mode`, each only if the request
  really carries it.
- Availability of `new_task` / `switch_mode`: both are in `ALWAYS_AVAILABLE_TOOLS`, so only the request's
  removal list can take them away. That list is the user's `disabledTools`, the background-task removals
  (`new_task`, `run_parallel_tasks`) and the model's `excludedTools`. The background logic moved out of
  `ApiRequestBuilder.buildToolsArray` into `getRequestDisabledTools` (`system-prompt-input.ts`), used by
  both the tools array and `buildSystemPromptInput`, so the prompt and the array cannot disagree. The
  prompt input gains `SystemPromptSource.isBackground` and `SystemPromptSettings.removedTools`.
- "for example code" is printed only when the `code` mode as the user has it (a custom override counts)
  really has every group the current mode lacks.

Orchestrator output:

```
====

TOOLS IN THIS MODE

This mode cannot run shell commands (there is no execute_command tool), cannot read or search files (there is no read_file, list_files or search_files tool) and cannot edit files (there is no write_to_file or apply_diff tool). Do not call those tools: a call to a tool that is not in your tool list is rejected and you get no result. When the work needs commands or files, delegate it with new_task to a mode that has those tools (for example code), or switch with switch_mode.
```

Not done: no sentence added to the orchestrator's `customInstructions`. Its instructions already make
delegation with `new_task` the whole protocol, and the generic section now states the missing tools in
every mode that lacks them, custom modes included; a second copy in one mode would only add bytes.

The section is derived from groups, not from individual disabled tools: a user who disables
`execute_command` in a mode with the `command` group gets no note (CAPABILITIES is conditional for that
case).

## Tests

- `sections/__tests__/mode-tool-limits.spec.ts`: orchestrator gets all three (exact text), code gets "",
  an architect-like custom mode gets only commands, a command-only mode gets read and edit, `new_task` /
  `switch_mode` removed are not mentioned (each, and both), no example when `code` lacks a missing group.
- `__tests__/system-prompt-input.spec.ts`: `getRequestDisabledTools` (foreground, background, cap off) and
  `removedTools` carrying the background removal, `disabledTools` and `excludedTools`.
- `prefix-stability.spec.ts`: the section sits after the whole stable head and before MODES for the
  orchestrator and is absent for code; all byte-stability and cross-mode prefix tests pass unchanged.
- Snapshots updated after review (architect and ask gain the section): `add-custom-instructions/*`,
  `system-prompt/*`. The canonical code snapshot and the parity snapshot are unchanged.
