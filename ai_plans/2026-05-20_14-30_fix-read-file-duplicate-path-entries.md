# Fix: duplicate streamed tool approval cards - Implementation Plan

**Date:** 2026-05-20
**Author:** Grandmaster (with user collaboration)
**Status:** Implemented
**Branch:** `fix/read-file-duplicate-path-entries`
**Related:** `ai_plans/2026-05-15_21-16_fix-duplicate-execute-command-cards.md`

## 1. Objective

One streamed tool invocation produced two approval cards (first reported for
`read_file`). Eliminate the phantom card at its source for every `ask:"tool"`
tool - without hiding a legitimate second invocation of the same target.

## 2. Proven Origin

From real persisted task `019e4189`: the model emits ONE `read_file` tool_use;
Roo persists TWO `ask:"tool"` cards. Every askApproval tool streams in two
phases - `handlePartial` emits a placeholder card, `requestApproval` emits the
complete card. A streaming race finalizes the placeholder before the complete
`ask(..., false)`. The `2026-05-15` finalized-duplicate dedup only reused a
finalized tail when `text === text`; for any tool whose placeholder and
complete payloads diverge in text, it missed - producing a duplicate card.

## 3. Discriminator: native tool-call id

Content-based discriminators fail (a divergent placeholder can be content-less
or content-ful; `tool+path` collapses distinct invocations). The only
invocation-precise signal is the native `tool_use.id`, already on the `block`
passed to both `handlePartial` and `execute`.

Tools stamp the id onto their `ask:"tool"` payloads as `toolCallId`. The dedup
in `TaskAskSay.ask` merges a finalized tail into the new complete card iff both
carry the SAME `toolCallId`; when ids are absent it falls back to exact-text.
The placeholder and complete card of one invocation share the id; two
invocations never do - so two genuine invocations always stay two cards.

## 4. Coverage - the whole `ask:"tool"` class

Every tool that overrides `handlePartial` now stamps `toolCallId` on its
placeholder and complete payloads: `read_file`, `search_files`, `list_files`,
`apply_diff`, `apply_patch`, `edit` / `search_and_replace`, `edit_file`,
`search_replace`, `new_task`, `write_to_file`, `run_slash_command`, `skill`,
`switch_mode`, `update_todo_list`, `codebase_search`. `presentAssistantMessage`
passes the native id into each adopting tool's callbacks.

Single-call multi-range remains a native-schema gap (only the legacy
`files[].lineRanges` format reads + concatenates multiple ranges); the
`readFileTool` test proves that path works. Not changed here.

## 5. File Changes

| Action | File Path                                               | Brief Purpose                                                 |
| ------ | ------------------------------------------------------- | ------------------------------------------------------------- |
| NEW    | `src/core/task/toolAskIdentity.ts`                      | `getToolCallId` / `isSameToolInvocation`                      |
| NEW    | `src/core/task/__tests__/toolAskIdentity.spec.ts`       | Helper unit tests                                             |
| MOD    | `src/core/task/TaskAskSay.ts`                           | Dedup uses `toolCallId` for `ask:"tool"`, exact-text fallback |
| MOD    | `packages/types/src/vscode-extension-host.ts`           | Optional `toolCallId` on `ClineSayTool`                       |
| MOD    | `src/core/assistant-message/presentAssistantMessage.ts` | Pass `toolCallId` into every `ask:"tool"` tool's callbacks    |
| MOD    | `src/core/tools/*.ts` (15 tools)                        | Stamp `toolCallId` on placeholder + complete payloads         |
| MOD    | `src/services/skills/skillInvocation.ts`                | `buildSkillApprovalMessage` accepts `toolCallId`              |
| MOD    | `src/core/task/__tests__/ask-finalized-dedup.spec.ts`   | Cases a/b/c/d + per-tool collapse/distinct tests              |
| MOD    | `src/core/tools/__tests__/readFileTool.spec.ts`         | Case (d) multi-range read+concatenate                         |

## 6. Verification Standards

- [x] All four required cases pass (placeholder->complete = ONE; two
      invocations = TWO; multi-range = one card, both ranges concatenated).
- [x] Per-newly-adopted-tool tests: `new_task`, `write_to_file`, diff-family,
      `list_files` - placeholder->race-finalize->complete = ONE card; two
      distinct invocations = TWO cards.
- [x] `codebase_search` no-regression test stays ONE card.
- [x] Regression: 630 passed / 4 skipped across 45 task + tool +
      assistant-message + skills suites; webview 31/31; 0 failures.
- [x] `tsc --noEmit` clean for `src`, `packages/types`, `webview-ui`.
- [x] No stranded approvals: dedup branch reuses the message and resolves
      the ask promise (execute_command dedup test).
