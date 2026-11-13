# CAPABILITIES no longer promises tools the mode may not have

**Status:** done on `fix/capabilities-no-false-tool-promise` (branched from `main` c9ec189f0).
**Related plans:** `2026-10-07_18-50_mode-tool-limits-note.md` (stacked on this branch, states what the mode lacks),
the empty-response retry fix in `src/core/task/TaskApiLoop.ts` (separate branch, other agent).
**Touched:** `src/core/prompts/sections/capabilities.ts`, `src/core/prompts/sections/system-info.ts`,
`src/core/prompts/sections/tool-use-guidelines.ts`, `src/core/prompts/__tests__/sections.spec.ts`, prompt snapshots.

## Symptom

A task in Orchestrator mode (GLM-5.3-Flash on vLLM) looped forever on "Model Response Incomplete / API
Request Failed". The model's saved reasoning said, verbatim: "orchestrator mode can run execute_command too
presumably".

## Root cause

1. The orchestrator mode has `groups: []` (`packages/types/src/mode.ts`), so its native tool list has no
   `execute_command`, no read tools and no edit tools.
2. The CAPABILITIES section is part of the STABLE HEAD (the same bytes for every mode, see CONTRIBUTING.md
   "KV-cache contract"), and it told every mode: "You have access to tools that let you execute CLI
   commands on the user's computer, list files, view source code definitions, regex search, read and write
   files ..." and "You can use the execute_command tool to run commands on the user's computer ...".
3. The model believed it and called `execute_command`. vLLM's GLM tool parser runs with
   `validate_tool_names=True`, so a call to a tool that is not in the request's `tools` is silently dropped:
   the client receives reasoning only, an "empty" response, and retries the identical request.

The same false promise reaches any model with rigid rules and any mode without the `command`, `read` or
`edit` groups, custom modes included. "view source code definitions" was already false for every mode (no
such tool is in `TOOL_GROUPS`).

## Fix

The section stays mode-independent (the head bytes are still identical across modes), but it no longer
promises any tool:

- The first bullet says the tools are exactly those in this request's tool list, that the list depends on
  the mode, what it CAN include, and that calling a tool that is not in the list fails with no result.
- The list_files and execute_command paragraphs open with "When your tool list includes ...". The usage
  advice (explain the command, prefer complex CLI commands over scripts, long-running allowed, a new
  terminal per command) is kept.

Audit of the other head sections and RULES:

- `system-info.ts` repeated the environment_details and list_files paragraph of CAPABILITIES word for word,
  with the workspace path hardcoded as `'/test/path'` (present since the upstream "Chat modes" commit). Every
  prompt therefore named a wrong workspace directory and promised list_files twice. The duplicate is
  removed; CAPABILITIES carries the paragraph once.
- `tool-use-guidelines.ts`: "using the list_files tool is more effective than running a command like `ls`"
  now opens with "when your tool list has both".
- Left unchanged on purpose: TOOL USE ("You have access to a set of tools" is true, the always-available
  tools exist in every mode), OBJECTIVE ("extensive capabilities" names no tool; `ask_followup_question` and
  `attempt_completion` are always available), OUTPUT EFFICIENCY (no tool claims), the batching example in
  the guidelines (an illustration of batching, not a capability claim), and RULES ("Chain shell commands
  with ..." is a how-to for commands, not a claim that the mode has them).
- Not changed here: the memory prompt (`src/core/memory/memoryPrompt.ts`) tells the model to save with
  `write_to_file` and search with `search_files`, also unconditionally. It is a separate subsystem with its
  own snapshots; the mode note of the stacked branch covers it by telling a mode without `edit` or `read`
  not to call those tools.

The head bytes change once (a one-time prefix-cache invalidation on upgrade), then stay stable across modes.

## Tests

- `sections.spec.ts`: new "does not promise execute_command or any other tool unconditionally" asserts
  the old sentences are gone, the tool-list sentence is present, and every sentence naming
  `execute_command` or `list_files` starts with "When your tool list includes <tool>".
- Snapshots updated after review (only the three CAPABILITIES bullets, the guidelines sentence, and the
  removed SYSTEM INFORMATION duplicate differ): `add-custom-instructions/*`, `prefix-stability`,
  `system-prompt/*`, `system-prompt-parity` (length and sha256 only).
- `prefix-stability.spec.ts` passes unchanged: the head is still byte-identical across modes.
