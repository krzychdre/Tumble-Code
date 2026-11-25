# A system prompt written for delegated subtasks

Status: in progress. Overview: `2026-11-25_08-20_prompt-cache-overview.md`.

## Problem

A delegated task (a `new_task` child or a `run_parallel_tasks` subagent) got the full prompt of its mode, written
for a conversation with the user, and the orchestrator's instructions made it dictate the same contract into every
delegation message: "only perform the work outlined", "signal completion with attempt_completion ... source of truth"
and "these specific instructions supersede any conflicting general instructions the subtask's mode might have"
(`DEFAULT_MODES` orchestrator `customInstructions`, `packages/types/src/mode.ts`). In the esp32-modulator session the
code children carried:

- the memory-writing instructions (9,876 characters of the 58,316-character system prompt), although a subtask never
  talks to the user those instructions are about; one child saved a progress note (`project_s3s4_progress.md`),
  which those same instructions forbid;
- `switch_mode` (617 characters of tools), although the parent chose the mode.

## Fix

- `taskOrigin(task)` (`system-prompt-input.ts`): `user`, `new_task` (has `parentTaskId`) or `subagent`
  (`isBackground`). `SystemPromptSource.origin` replaces `isBackground`.
- `getRequestDisabledTools(state, origin)` reads a table: `new_task` loses `switch_mode`; `subagent` loses
  `switch_mode`, `new_task`, `run_parallel_tasks` and `wait_for_subagents` (as before, plus `switch_mode`). The cap
  rule for the subagent tools is unchanged.
- `settings.isSubtask` (origin is not `user`): the long and the compact prompt drop the memory-writing section (the
  MEMORY.md index stays, it is read-only knowledge) and add a SUBTASK section right before MODE: the assignment is
  binding over the mode's general instructions, stay in scope, ask only when blocked, finish with a complete
  `attempt_completion` report (the 100-word guideline of Output Efficiency does not apply to it).
- The orchestrator's instructions keep "all necessary context" and "a clearly defined scope" and say the rest is in
  the subtask's own prompt.
- The live request (`ApiRequestBuilder`, via `TaskApiLoop` access) and the preview (focused task) pass the origin.
- CONTRIBUTING.md, KV-cache contract: the measured render order (tools array, system prompt, messages) and what it
  implies.

Net effect per subtask request: 9,583 characters (about 2,600 tokens, 10% of system prompt plus tools) less; 238 such
requests in the analysed session. Subtasks of one mode still share their whole prefix with each other.

## Not done

Reordering the tools array so the tools every mode has come first was measured and left out: the tools array
renders first, so it would let orchestrator, architect and code share at most the orchestrator's 14.7k characters
of tools, while subtask starts were 2.2% of the session's uncached tokens.

## Tests

- `system-prompt-input.spec.ts`: `taskOrigin`, the per-origin removals, the cap rule, `isSubtask` in the input.
- `compact-profile-prompt.spec.ts`: for the long and the compact prompt, a subtask gets SUBTASK before MODE and the
  memory index but no memory-writing section, a main task the opposite (mutation-checked).
- Orchestrator snapshots updated (only the removed bullets).

KV-cache: one-time prefix invalidation for orchestrator tasks (their instructions changed) and for running delegated
tasks (new prompt); worth it, every later subtask request is 2,600 tokens shorter.
