# Compact profile, workstream D: context budget

Status: in progress on `feat/compact-d-context` (local only). Overview and invariants:
`2026-10-10_19-36_compact-small-model-profile.md` (row D).

Everything below is gated on `isCompactProfile(...)` of the profile that serves the request. With the flag absent
or false every output is today's (`compact-off-golden.spec.ts` plus the flag-off tests listed per item).

## 1. Environment details (`src/core/environment/getEnvironmentDetails.ts`)

- One line `Current time: YYYY-MM-DD HH:MM (Weekday), <IANA zone>` (local time; `formatCompactCurrentTime` in
  `currentTime.ts`), emitted under the same rule as today's block (every turn while `includeCurrentTime`, always on
  a full emission).
- No cost, no todo reminder (the compact toolset has no `update_todo_list`).
- `Current mode: <slug>` only when it changed (no name, no model, no mode-details lookup).
- Visible files and open tabs on one line each, at most 5 paths, only when changed.
- Recently modified files: at most 5 paths on one line.
- Terminals kept, each output cut to its last 800 characters at a line boundary.
- First-turn workspace listing: at most 50 entries and 1,500 characters, with a note when cut.
- Budgets (tested): first turn at most 2,500 characters, later turns at most 200 in a quiet workspace.

## 2. Output reservation

- `getModelMaxOutputTokens` (`packages/core/src/api/model-options.ts`): under compact, when the model states no
  positive `maxTokens` (and the user set no explicit `modelMaxTokens` override on a model that supports one),
  reserve `min(4096, floor(contextWindow * 0.15))`. A positive `maxTokens` keeps today's 20 percent clamp. Every
  caller that passes the task's profile (context management, the request recorder, providers that send
  `max_tokens` from this rule) gets the same number.
- `OpenAiHandler.addMaxTokensIfNeeded`: under compact always send `max_completion_tokens` (llama.cpp reads it as
  an alias of `n_predict`), equal to the reservation, or to the user's smaller explicit value when
  `includeMaxTokens` is on.
- Added on request: one tool call per message under compact. `TaskApiLoop` sets `parallelToolCalls: false` in
  the request metadata (every handler that sends `parallel_tool_calls` reads it: openai, lm-studio, deepseek,
  qwen-code, xai, the base OpenAI-compatible handlers; Anthropic turns it into `disable_parallel_tool_use`), and
  `OpenAiHandler` also forces `false` from its own options. Native Ollama has no such parameter.
- Not covered (follow-up): LM Studio and native Ollama send no output limit at all (`max_tokens` / `num_predict`).

## 3. Condensing

- Compact default threshold 70 percent: the effective global percent becomes `min(global, 70)`; a valid
  per-profile threshold still wins, `autoCondenseContext: false` still disables condensing.
- The condense request uses the compact toolset (`compactProfile` passed to the condense metadata build), so it
  does not carry the full tool array.
- The prune pass is skipped under compact: its previews cite `read_artifact`, which compact does not offer;
  microcompaction (a send-time strip whose placeholder says "re-read or re-run") covers the same ground.

## 4. Tool output caps

- `execute_command`, `search_files`, `list_files`: each result capped at 6,000 characters at a line boundary, with
  a note on how to narrow the query (command output keeps head and tail, the two listings keep the head).
- No artifact spill under compact: a result over the inline budget is truncated in place (head and tail), and
  `execute_command` does not persist its output to a `command-output` artifact.

## Tests

Targeted vitest files only; `compact-off-golden.spec.ts` before every commit, never with `-u`.
