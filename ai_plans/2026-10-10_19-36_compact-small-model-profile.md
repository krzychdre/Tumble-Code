# Compact profile for small-context models

Status: in progress, proof of concept on branch `feat/compact-small-model-profile` (local only, not pushed, not
merged). Overview plan; each workstream branch adds its own plan next to this one.

## Problem

A heavily quantized Qwen3.5-4B (Q4_K_M, llama.cpp `--jinja`, `-c 40960`, one slot, GTX 1650 4 GB, prompt
processing about 110-150 tokens/s) failed a trivial task: "add two coffees at 9:40 and 12:00" to a markdown table
(task `01a126c9-0226-7411-818b-f2c82651eb76`, 2026-10-10, profile "qwen3.5-2B", provider `openai`).

Evidence from the recorded exchanges (`llm_exchanges` in the self-hosted cloud database) and `ui_messages.json`:

| Request | Mode | Input tokens | System prompt | Tools array            | Outcome                                                                     |
| ------- | ---- | ------------ | ------------- | ---------------------- | --------------------------------------------------------------------------- |
| 1       | ask  | 15,229       | 39,601 chars  | 12 tools, 19,406 chars | `read_file` called                                                          |
| 2       | ask  | 18,420       |               |                        | correct answer: no coffee logged today                                      |
| 3       | ask  | 18,803       |               |                        | `switch_mode` to code                                                       |
| 4       | code | 21,174       | 38,225 chars  | 16 tools, 28,891 chars | malformed `apply_diff` (no `=======`, stray `\|\|\|\|@@`)                   |
| 5       | code | 21,841       |               |                        | malformed `apply_diff` (`:start_line:` inside REPLACE)                      |
| 6       | code | 22,393       |               |                        | malformed `apply_diff` (empty SEARCH, two `=======`), mistake limit reached |

Findings:

1. The SEARCH/REPLACE format of `apply_diff` is beyond this model. Every attempt also copied the `N | ` prefix
   that `read_file` puts in front of each line into the diff content.
2. The prompt and the tool definitions take 15-21k tokens before the conversation starts, about half of the window.
   The biggest pieces: the memory section (about 9.7k chars plus the MEMORY.md index), `read_file` (4.7k),
   `execute_command` (3k), `ask_followup_question` (2.4k), `update_todo_list` (2.1k), `read_artifact` (2.7k).
3. Prompt processing of 21k tokens took 157 s. The mode switch changed the system prompt and the tool array, so
   llama.cpp could not reuse its KV cache.
4. `convertToolsForOpenAI` (`src/api/providers/base-provider.ts`) makes every property required (strict mode,
   `stripNull`), so the model had to invent `limit: 2000` and a full `indentation` object for a plain read.
5. No temperature is sent, so llama.cpp samples at its default 0.8.
6. With `openAiCustomModelInfo.maxTokens = -1` (the default of `openAiModelInfoSaneDefaults`) the context
   management reserves no output space (`-1 || 8192` is `-1`).

Reading and answering worked; the model fails on tool formats and on the tight window.

## Decision: one per-profile flag, `compactProfile`

A new optional boolean in the shared provider-profile settings, next to `slimToolset`, following the same path
field for field (`packages/types/src/provider-settings.ts`, `provider-config/shared.ts`, `sharedFieldNames` in
`provider-profile.ts`, the UI control in the advanced section of `ApiOptions.tsx`, all 18 locales).

Invariants:

- **Off means today's bytes.** The flag is checked with `=== true` only. With the flag absent or false, the system
  prompt, the tool array (before and after provider conversion), the environment details, the tool results and the
  context management are byte-identical to `main`. A golden test pins this before any behaviour change lands
  (`src/core/prompts/__tests__/compact-off-golden.spec.ts`); later commits must pass it without `-u`.
- **The flag follows the profile that serves the request.** Live requests read it from the task's own
  `apiConfiguration` (the one its API handler was built from), not from the globally active profile, so a
  background task on another profile is not affected. The "copy system prompt" preview resolves it the same way it
  resolves the model, and `system-prompt-parity.spec.ts` keeps both in step.
- **Compact supersedes slim.** When both flags are on, the compact rules apply; `slimToolset` alone keeps its
  current behaviour.
- **Explicit opt-in.** No automatic activation from `contextWindow`: a large model with a small window must not
  change behaviour behind the user's back.
- **General fixes stay gated.** Fixes that would also help large models (the `apply_diff` error texts, the `-1`
  reservation) apply only under the flag on this branch. Their ungated versions are listed under follow-ups.

## Budgets (compact profile, measured on the rendered output)

| Piece                                                                              | Today (code mode)                     | Compact target                                  |
| ---------------------------------------------------------------------------------- | ------------------------------------- | ----------------------------------------------- |
| System prompt without user content (custom instructions, rule files, memory index) | about 14-23k chars                    | at most 4,000 chars                             |
| Memory section                                                                     | 9.7k chars + index up to 25,000 bytes | at most 600 chars + index capped at 3,000 chars |
| Tool array, code mode, as sent after provider conversion                           | about 29-33k chars                    | at most 5,000 chars                             |
| Tool array, ask mode                                                               | about 19-24k chars                    | at most 3,000 chars                             |
| Environment details, first turn                                                    | several kB                            | at most 2,500 chars                             |
| Environment details, later turns                                                   | about 400 chars                       | at most 200 chars                               |
| First request in total                                                             | 15-21k tokens                         | about 4-5k tokens                               |

## Compact toolset (canonical list, shared by all workstreams)

Allowed under `compactProfile` (still subject to the mode's groups and the existing feature gates):

- read: `read_file` (parameters `path`, optional `offset`, optional `limit`), `list_files`, `search_files`
- edit: `edit` (`file_path`, `old_string`, `new_string`, optional `replace_all`) replaces `apply_diff`;
  `write_to_file` stays for new files and full rewrites
- command: `execute_command` (`command`, optional `cwd`)
- always: `ask_followup_question`, `attempt_completion`, `switch_mode`
- `web_search`, `web_fetch` only where `webToolsEnabled` already allows them

Not offered under compact: `apply_diff`, `search_replace`, `edit_file`, `apply_patch`, `new_task`,
`run_parallel_tasks`, `update_todo_list`, `read_artifact`, `tools_load`, `skill`, `codebase_search`,
`generate_image`, `run_slash_command`, `search_task_history`, every MCP tool and `access_mcp_resource`.
Dispatch stays tolerant: a hidden tool the model calls anyway still runs, as with slim.

## Memory (owner's choice: variant a)

A short instruction (what the memory directory is, when to read a note, how to save one in at most a few sentences)
plus the MEMORY.md index truncated to 3,000 chars at a line boundary, with a note that it was truncated.

## Workstreams and file ownership

Each workstream is one branch and one worktree under `~/Projekty/QUB-IT/Roo-Code-wt/`, cut from the foundation
commit. A file listed for one workstream is not edited by another; shared needs go through the foundation helpers.

| ID  | Branch                                                     | Owns                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F   | `feat/compact-small-model-profile` (direct)                | the flag in `packages/types` and its tests and snapshots; the helper `isCompactProfile()`; threading into `SystemPromptSettings`, `buildSystemPromptInput`, `generateSystemPrompt`, `build-tools.ts` filter settings and a task-level accessor for tools and environment details; the UI control, locales and webview test; the golden test                                         |
| A   | `feat/compact-a-prompt`                                    | `src/core/prompts/system.ts` compact branch, new `src/core/prompts/sections/compact/`, the compact memory variant in `src/core/memory/memoryPrompt.ts`, skills and modes sections under compact, `prefix-stability.spec.ts` compact cases, snapshots in `__snapshots__/compact-profile/`                                                                                            |
| B   | `feat/compact-b-tools`                                     | `compactAllowed` column in `src/core/tools/toolDescriptors.ts`, `applyCompactToolset` in `filter-tools-for-mode.ts`, compact tool definitions in `src/core/prompts/tools/native-tools/`, `src/core/task/build-tools.ts`, non-strict schemas under compact in `base-provider.ts`, a tool-array size snapshot                                                                         |
| C   | `feat/compact-c-read-edit`                                 | `src/core/tools/ReadFileTool.ts` compact output and default limit, `src/core/tools/EditTool.ts` lenient matching and compact errors, compact error texts in `src/core/prompts/responses.ts`, `write_to_file` prefix stripping under compact                                                                                                                                         |
| D   | `feat/compact-d-context`                                   | `src/core/environment/getEnvironmentDetails.ts` compact variant, output reservation in `packages/core/src/api/model-options.ts` and `src/core/context-management/`, sending `max_tokens` from `src/api/providers/openai.ts` under compact, condense threshold default under compact, output caps and spill policy under compact for `execute_command`, `search_files`, `list_files` |
| E   | outside the repository (`~/Projekty/QUB-IT/compact-eval/`) | evaluation harness, baseline on `main`, measurements on the integrated branch                                                                                                                                                                                                                                                                                                       |

## Evaluation

A short run on the live llama.cpp endpoint, on copies of fixture files under `/tmp`, never on the owner's files:
answer a question from a diary file, append two rows to its table, a one-line fix in a small source file, find the
file that defines a function. Baseline: one run per task on `main`. Compact: two runs per task on the integrated
branch, temperature 0.6 in the test profile. Measured: success, requests, input tokens, wall time, tool errors.

## Follow-ups outside this branch

- Ungated: route malformed `apply_diff` errors through `toolError` so they carry the minimal example, and stop
  answering swapped markers with the merge-conflict escaping advice.
- Ungated: treat `maxTokens <= 0` as unset when reserving output space.
- `slimToolset` reads its flags from the globally active profile; background tasks on another profile get the
  foreground flags.
