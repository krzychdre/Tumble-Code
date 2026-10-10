# Compact profile, workstream A: the compact system prompt

Status: implemented on branch `feat/compact-a-prompt` (local only, commits `dd706857f`, `9e95911a0`), waiting for
integration with B, C and D. Part of [the compact profile overview](2026-10-10_19-36_compact-small-model-profile.md),
row A.

Measured (built-in modes, no user content, no memory index): 3,292 characters (code, debug) to 3,455 (orchestrator),
against about 25.6k for the long prompt with the same inputs. The capped memory index adds about 3,100.

## Goal

Under `isCompactProfile(settings)`, `SYSTEM_PROMPT` assembles a short prompt written for a 4B model (Qwen3.5-4B
Q4_K_M, 40,960-token window) instead of the long one. With the flag absent or false nothing changes
(`compact-off-golden.spec.ts` passes without `-u`).

Baseline failure this prompt targets: asked to add two coffees for today to a markdown diary, the model appended rows
under yesterday's table and claimed success; it also called `update_todo_list` for nothing and invented parameters.

## Design

- New sections in `src/core/prompts/sections/compact/`, one small module per piece, re-exported from its `index.ts`.
- `system.ts` branches once, after the shared inputs (mode, role, custom instructions) are resolved, so the user's
  own content goes through the same `addCustomInstructions` and `getModeSection` as today.
- Compact head (identical across modes): opener, tools, editing files, dates (the one example), rules (finish,
  ask, language, brevity, markdown, paths), system information (two lines), memory instruction, memory index.
- Compact tail: modes list (one line per mode, before anything mode-dependent so a mode switch keeps it cached),
  tools in this mode (only for a mode without `read`, `edit` or `command`; names only `switch_mode`, because the
  compact toolset has no `new_task`), the vendor confidentiality note for stealth models, MODE, USER'S CUSTOM
  INSTRUCTIONS.
- Omitted under compact: MCP availability, skills, deferred-tools catalog, the non-ASCII `\uXXXX` escape rule (a 4B
  model on llama.cpp writes UTF-8 directly; the escape rule only adds a way to corrupt `old_string`).
- Memory, variant a: `buildCompactMemoryInstruction` (at most 600 chars) and `truncateCompactMemoryIndex` (the
  MEMORY.md body cut to at most 3,000 chars at a line boundary, plus a one-line note) in `memoryPrompt.ts`, loaded
  through `sections/compact/memory.ts`. Both return "" when memory is disabled (`autoMemoryEnabled`,
  `ROO_DISABLE_AUTO_MEMORY`) or the path module is not initialized, like the existing loaders.

## Tests

- `compact-profile-prompt.spec.ts`: size budget per built-in mode with empty user content (at most 4,000 chars,
  memory index excluded), snapshots of the full compact prompt per built-in mode in
  `__snapshots__/compact-profile/`, MCP and skills invisible, memory truncation.
- `prefix-stability.spec.ts`: compact prompts are byte-stable, share the whole compact head across modes, and may
  differ from the non-compact prompt.
- `memoryPrompt.spec.ts`: compact instruction length, truncation at a line boundary, disable switches.
- Guards run before each commit: `compact-off-golden.spec.ts`, `system-prompt-parity.spec.ts`.

## Out of scope (other rows)

Tool descriptions and the compact toolset (B), `read_file` / `edit` behaviour (C), environment details and the
`Current time` line (D).
