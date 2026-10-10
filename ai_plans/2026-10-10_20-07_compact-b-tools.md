# Compact profile, workstream B: toolset and tool schemas

Status: implemented on branch `feat/compact-b-tools` (local only, cut from the foundation commit `195964e0c`),
waiting for integration with workstreams A, C and D.
Overview and invariants: [2026-10-10_19-36_compact-small-model-profile.md](2026-10-10_19-36_compact-small-model-profile.md).

## Goal

Under `compactProfile` the model sees at most 11 short tools (the canonical compact list of the overview plan),
with minimal schemas whose optional parameters stay optional after the OpenAI conversion. Budget, measured as
`JSON.stringify` of the tools array as the OpenAI-compatible handler sends it: at most 5,000 chars in code mode
and 3,000 chars in ask mode (web tools off). With the flag absent or false every byte is today's.

## Steps

1. `compactAllowed` column in `src/core/tools/toolDescriptors.ts`; `COMPACT_TOOLSET_ALLOWLIST` and
   `COMPACT_TOOLSET_ALLOWSET` (aliases folded in) derived from it in `filter-tools-for-mode.ts`, like slim.
2. `applyCompactToolset` in `filter-tools-for-mode.ts`, run after mode, group and model resolution: intersect with
   the compact allowset, offer `edit` in a mode that has the edit group (the only addition), drop every MCP tool
   and `access_mcp_resource` (also in `filterMcpToolsForMode`). Compact supersedes slim: the slim intersection is
   skipped. `disabledTools`, the model's `excludedTools` and the feature gates still apply afterwards.
3. Compact definitions in `src/core/prompts/tools/native-tools/compact/`, selected in `build-tools.ts` only
   under compact. Order: tools every mode has first, then edit, then command, so the ask array is a prefix of
   the architect array, which is a prefix of the code array (helps llama.cpp reuse its KV cache across a mode
   switch when the system prompt matches).
4. `convertToolsForOpenAI(tools, profile?)` in `base-provider.ts`: when `isCompactProfile(profile)`, every function
   tool is sent with its original schema and `strict: false`. The ten call sites in the handlers that use it
   pass `this.options`; nothing else changes in those files.
5. Dispatch of `edit` (approved by the coordinator, an unowned file): `edit` is an opt-in tool of the edit group,
   so `rejectInvalidToolUse` (`src/core/assistant-message/steps/toolUseGuards.ts`) adds it to `includedTools`
   under compact, through a helper exported from `filter-tools-for-mode.ts`. A mode without the edit group still
   rejects it; the group's `fileRegex` still applies through `file_path`.
6. Tests: compact filter rules, a parser check for every compact schema's minimal arguments, a conversion test
   (optional fields stay optional), the guard test, and a live-path spec with snapshots of the compact arrays for
   every built-in mode in `src/core/prompts/__tests__/__snapshots__/compact-tools/` plus the size budget.

## Results

Measured by `src/core/prompts/__tests__/compact-tools.spec.ts` (snapshot `__snapshots__/compact-tools/sizes.json.snap`),
`JSON.stringify` of the tools array the SDK receives, web tools off. "Today" is the same fixture without the flag:
one MCP server with a tool and a resource, code index live, so it is a little above the 33.5k quoted elsewhere.

| Mode         | Today: tools, chars as sent | Compact: tools, chars before / after conversion | Compact with web tools |
| ------------ | --------------------------- | ----------------------------------------------- | ---------------------- |
| code, debug  | 19, 36,632                  | 9, 4,264 / 4,399                                | 5,039                  |
| architect    | 17, 30,875                  | 8, 3,860 / 3,980                                | 4,620                  |
| ask          | 15, 27,147                  | 6, 2,681 / 2,771                                | 3,411                  |
| orchestrator | 8, 13,515                   | 3, 1,187 / 1,232                                | 1,232                  |

Ownership change: the coordinator assigned `src/core/assistant-message/steps/toolUseGuards.ts` (dispatch of the
compact `edit`) to workstream B.

## Out of scope, reported instead

- `xai.ts` and `responses-api/request.ts` build strict schemas on their own (not through
  `convertToolsForOpenAI`); they serve cloud models and stay strict under compact.
- For C: `TOOL_MINIMAL_EXAMPLES` (`native-tools/examples.ts`, used by `formatResponse.toolError`) still teaches the
  full shapes (`execute_command` with `cwd: null, timeout: null`, `ask_followup_question` with `{ text, mode }`
  objects). The compact schemas take `follow_up` as plain strings (the tool accepts both). A compact variant of
  the examples belongs with the compact error texts.
- For A: a prompt section that names tools should read the compact set from `COMPACT_TOOLSET_ALLOWLIST` /
  `applyCompactToolset` (`filter-tools-for-mode.ts`); under compact the edit verb is `edit`, not `apply_diff`.
