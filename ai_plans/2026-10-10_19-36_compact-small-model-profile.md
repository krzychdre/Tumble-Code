# Compact profile for small-context models

Status: proof of concept complete and measured on branch `feat/compact-small-model-profile` (local only, not pushed,
not merged into `main`; the workstream branches are merged into it). Overview plan; each workstream branch adds its own
plan next to this one.

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

## Results (2026-10-10)

Harness `~/Projekty/QUB-IT/compact-eval/` (Tumble CLI, isolated HOME, fixtures under `/tmp`), live llama.cpp,
Qwen3.5-4B Q4_K_M, window 40,960, temperature 0.6 unless noted. The CLI prompt is smaller than the VS Code one (no
global rules, skills, MCP or memory index), so the baseline sizes understate what the extension sends.

| Configuration                                                                  | T1 ask: answer | T2 code: dated append                       | T3 code: bug fix                                   | T4 ask: find | Tool errors |
| ------------------------------------------------------------------------------ | -------------- | ------------------------------------------- | -------------------------------------------------- | ------------ | ----------- |
| `main` (1 run each)                                                            | 1/1            | 0/1 (rows under yesterday, success claimed) | 1/1                                                | 1/1          | 1           |
| compact, before review fixes (2 runs, plus 2 at temperature 0.8 for T2 and T3) | 2/2            | 4/4                                         | 4/4                                                | 2/2          | 0           |
| compact, after review fixes (2 runs)                                           | 2/2            | 2/2                                         | 2/2 (one ended with an unasked follow-up question) | 2/2          | 0           |
| compact, after the example and rule fixes below                                |                | 1/2, then 3/3                               | 2/2                                                |              | 0           |

| First request             | `main` ask   | `main` code  | compact ask | compact code |
| ------------------------- | ------------ | ------------ | ----------- | ------------ |
| System prompt chars       | 24,787       | 23,409       | 5,333       | 4,375        |
| Tools (count / chars)     | 12 / 24,081  | 16 / 33,566  | 6 / 2,816   | 9 / 4,444    |
| Environment details chars | about 700    | about 700    | about 210   | about 210    |
| Input tokens              | about 11,600 | about 13,700 | about 2,400 | about 2,650  |

Wall time per run fell from 90-171 s to 27-56 s. Prompt fixes found by the measurements: the dated-entry example
first used a changelog, and the model then offered to add a CHANGELOG.md entry after fixing a bug, so the example now
uses meeting notes and a rule says to finish without offering extra work; one run logged an undated request under
yesterday, so the rule now says an entry without a date belongs to today.

Known limits: the orchestrator mode's own instructions still delegate with `new_task` and `run_parallel_tasks`, which
the compact toolset hides, so it can only switch modes under compact. The four tasks are small; multi-file changes
were not measured. `src/__tests__/single-open-invariant.spec.ts` fails on `main` as well, independent of this branch.

## Settings UI: one model size choice (owner's request, 2026-10-10)

The owner found two checkboxes that both said "small models" (slim toolset and compact mode) confusing, and asked
for one radio choice that tells smaller models from very small ones. The advanced profile settings now show "Model
size" with three options: Standard (full prompt and tools, large models), "Smaller models: slim toolset" (full
prompt, one obvious tool per job, mid-size models) and "Very small models: compact mode" (32k to 40k windows). The
MCP sub-checkbox appears under the group only for the slim option.

Storage is unchanged: the profile keeps the two flags `slimToolset` and `compactProfile`, so no profile needs a
migration and the extension's behaviour is the same. `ModelSizeControl` derives the option with compact winning, as
the tool filter does, and a selection writes only the flags whose effective value changes. It replaces
`SlimToolsetControl` and `CompactProfileControl`; the locale keys moved to `settings:advanced.modelSize.*` in all 18
locales, with the existing MCP sub-checkbox translations carried over.

## Subagents off under compact (owner's request, 2026-10-10)

"When compact mode is activated, deactivate subagents and set them to off." Every subagent setting
(`parallelTasksMaxConcurrency`, the followup timeout, `alwaysAllowSubtasks`) is global, so writing one of them from a
compact profile would take subagents away from large models too. Subagents are therefore off per profile, at runtime:
`NewTaskTool` and `RunParallelTasksTool` refuse for a compact task right after the background check, counting a mistake
(`recordFailure`) so a small model cannot loop on the refused tool, and `new_task` gets no checkpoint and no streaming
card under compact (plan `2026-10-10_22-36_compact-no-subagents.md`). In the settings, selecting the compact option
shows a disabled, unchecked "Subagents" switch under it, and the Subagents tab notes that a compact profile never starts
subagents whatever its settings say.

## Follow-ups outside this branch

- Ungated: route malformed `apply_diff` errors through `toolError` so they carry the minimal example, and stop
  answering swapped markers with the merge-conflict escaping advice.
- Ungated: treat `maxTokens <= 0` as unset when reserving output space.
- `slimToolset` reads its flags from the globally active profile; background tasks on another profile get the
  foreground flags.

## Foundation (F)

Done on `feat/compact-small-model-profile` (commits `2ff16982c`, `866ea42ee`, `acff04b52`, `65f694e89`). Workstreams
A to D branch from the commit that adds this section. Nothing reads the flag yet: with it on or off every output
is today's.

### The flag and the helper

- Field: `compactProfile`, a plain optional boolean (never nullish) in `baseProviderSettingsSchema`
  (`packages/types/src/provider-settings.ts`), in the strict `sharedProfileSettingsSchema`
  (`packages/types/src/provider-config/shared.ts`) and in `sharedFieldNames` (`provider-profile.ts`). It is stored
  in the shared section of a persisted profile and read back flat.
- Helper: `isCompactProfile(settings?: { compactProfile?: boolean } | null): boolean`, true only for an explicit
  `true`. Import it as `import { isCompactProfile } from "@tumble-code/types"` (it works in `src`, `packages/core`
  and `webview-ui`). Never test the field directly; always go through the helper.
- UI: `webview-ui/src/components/settings/CompactProfileControl.tsx`, after `SlimToolsetControl` in the advanced
  section of `ApiOptions.tsx`; keys `settings:advanced.compactProfile.{label,description}` in all 18 locales.

### Where to read it (exact expressions)

The flag follows the profile that serves the request: the task's own `apiConfiguration`, the profile its API
handler was built from. `getState().apiConfiguration` is the panel's active profile and belongs to the focused
task, so code inside a task must not read the flag from there.

1. Prompt sections (`SYSTEM_PROMPT` and the sections it calls): `isCompactProfile(settings)`, where `settings` is
   the `SystemPromptSettings` in `options.settings` (`src/core/prompts/types.ts`, field `compactProfile`). It is
   filled by `buildSystemPromptInput` from `SystemPromptSource.compactProfile`, which the caller resolves: the live
   path (`ApiRequestBuilder.buildSystemPrompt`) passes `isCompactProfile(this.access.apiConfiguration)`, the
   preview (`generateSystemPrompt`) passes `isCompactProfile(state.apiConfiguration)`, the same profile it resolves
   the preview model from. A section that needs the flag gets it passed down from `system.ts`.
2. Tool filtering: `isCompactProfile(settings)` inside `filterNativeToolsForMode` / `filterMcpToolsForMode`
   (their `settings` argument is `filterSettings` from `build-tools.ts`, which now carries `compactProfile`), and
   `isCompactProfile({ compactProfile })` or `filterSettings` inside `buildNativeToolsArrayWithRestrictions`.
   The value arrives as the `BuildToolsOptions.compactProfile` option, passed by `ApiRequestBuilder.buildToolsArray`
   as `isCompactProfile(this.access.apiConfiguration)`. It is NOT read from the `apiConfiguration` option, which is
   the active profile (the slim flags keep reading that one, unchanged). Specs that call
   `buildNativeToolsArrayWithRestrictions` directly pass `compactProfile: true` as an option.
3. Code inside a task: `isCompactProfile(task.apiConfiguration)` wherever a `Task` is at hand (tools such as
   `ReadFileTool`, `EditTool`, `WriteToFileTool`, `ExecuteCommandTool` get `task`; `getEnvironmentDetails` gets
   `cline`, so `isCompactProfile(cline.apiConfiguration)`); in a helper module on an access interface
   (`TaskApiLoop`, `TaskContextManager`, `TaskStreamProcessor`, ...): `isCompactProfile(this.access.apiConfiguration)`.
   Documented on `TaskApiConfigurationAccess` (`src/core/task/access-groups.ts`). `getModelMaxOutputTokens` is
   already called with `settings: this.access.apiConfiguration` from the task, so inside
   `packages/core/src/api/model-options.ts` it is `isCompactProfile(settings)`.
4. Provider handlers: `isCompactProfile(this.options)` (`ApiHandlerOptions` is the task's profile without
   `apiProvider`, built by `buildApiHandler(task.apiConfiguration)`). `BaseProvider` has no `options`, so
   `convertToolsForOpenAI` needs the flag passed in by the subclass that calls it.

### How the task profile behaves

- A mode switch to a mode with a bound profile, a profile switch and a saved profile edit all call
  `ModeProfileBinding.updateTaskApiHandlerIfNeeded(..., { forceRebuild: true })`, which calls
  `task.updateApiConfiguration`: `task.apiConfiguration` and `task.api` (hence `this.options`) change together,
  for the focused task only. The non-rebuild branch of that method would update `apiConfiguration` without the
  handler; no caller reaches it today, keep it that way or `this.options` goes stale.
- Background subagents (`BackgroundTaskRunner`) and detached parents keep their own profile; the profile-change
  listener skips them on purpose.
- Pre-existing, not changed here: `switch_mode` called by a background task runs `provider.handleModeSwitch`,
  which switches the FOCUSED task's mode and profile, not the caller's.
- Compact supersedes slim, but the two read different profiles (slim: active, compact: task). For the focused
  task they are the same profile.

### Golden test

`src/core/prompts/__tests__/compact-off-golden.spec.ts`, snapshots in `__snapshots__/compact-off-golden/`. It pins,
on the live path, the system prompt and the native tools array for every built-in mode, plus the tools and the
other request parameters after the OpenAI-compatible handler for code and ask mode, for the profiles `{}` and
`{ slimToolset: true }`, and checks that `compactProfile: false` gives the same files. The real modes, memory
(with a MEMORY.md index above 3,000 characters), skills and MCP sections are rendered. Run it, never with `-u`:

```
cd src && CI=true npx vitest run core/prompts/__tests__/compact-off-golden.spec.ts
```

`CI=true` makes a missing snapshot fail instead of being written. Snapshot files store en and em dashes as
`\u2013` / `\u2014` escapes (lossless) and use the `.snap` extension so lint-staged does not reformat the JSON.
Related guards: `core/prompts/__tests__/system-prompt-parity.spec.ts` (preview equals live, with a compact case),
`core/task/__tests__/ApiRequestBuilder.compact-profile.spec.ts` (the flag comes from the task, not the panel).

## Review fixes (profile)

Done on `feat/compact-fix-profile` (cut from `73c559fc0`). The compact EDIT findings (`compactEdit.ts`, `EditTool.ts`,
`WriteToFileTool.ts`) are fixed on a separate branch.

- **Stale profile in the request builder (blocker).** `TaskApiLoop` built its `ApiRequestBuilder` once with a copy of
  `apiConfiguration`, so after `Task.updateApiConfiguration` the system prompt and the tool filter kept the start
  profile's compact flag. The builder reads `apiConfiguration` only for the compact flag (`buildSystemPrompt`,
  `buildToolsArray`), so it is now passed as a getter, like `rooIgnoreController`. Guard:
  `core/task/__tests__/TaskApiLoop.profile-switch.spec.ts` (switch in both directions, real tool building).
- **Compact document reads.** PDF, DOCX and other extracted documents now honour `offset` and `limit` under compact
  (the entry reaches `handleBinaryFile`), so the truncation line's offset reads on instead of repeating lines 1-400.
- **Condense requests.** `parallelToolCalls` in the condense metadata is false under compact; `TaskApiLoop` and
  `TaskContextManager` share `resolveParallelToolCalls` (`src/core/task/parallelToolCalls.ts`).
- **Compact `read_file` description.** No longer promises the lines "exactly as stored": a line over 2,000 characters
  is cut short. Tool arrays as sent: code mode 4,444 characters, ask mode 2,816 (were 4,399 and 2,771).
- **Compact memory note.** A note without frontmatter is not ignored but degraded (the recall ranker sees the file name
  only, the dream merge cannot store its summary, a rebuilt index line has an empty hook). The example note now starts
  with a `description` frontmatter line; the instruction stays at 598 characters with a 115-character path.
- **CONTRIBUTING.md line 67.** Not restored: `main`'s own line is not Prettier-clean, and the lint-staged `prettier
--write` re-indents it on any commit that stages the file (a restore commit ends as an empty commit).

Follow-ups (pre-existing, outside this branch):

- The builder's `api` is the same construction-time copy: after a profile switch `buildSystemPrompt` takes
  `modelInfo` from the old handler and `buildCleanConversationHistory` decides encrypted reasoning from it.
  `RetryHandler` holds copies of `apiConfiguration` (rate-limit fallback, telemetry provider) and `api` (model id in
  logs and telemetry) too. Passing them as getters would change large-model behaviour, so it needs its own change.
