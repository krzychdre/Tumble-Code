# Fix: duplicate streamed tool approval cards - Implementation Plan

**Date:** 2026-05-20
**Author:** Grandmaster (with user collaboration)
**Status:** Implemented (committed to branch only - not pushed, no PR)
**Branch:** `fix/read-file-duplicate-path-entries`
**Commits:** `b139a130b` - dedup discriminator (Sections 3-6); `dd091bff` - race elimination (Section 7)
**Related:** `ai_plans/2026-05-15_21-16_fix-duplicate-execute-command-cards.md`

## 1. Objective

One streamed tool invocation produced two approval cards (first reported for
`read_file`). Eliminate the phantom card at its source for every `ask:"tool"`
tool - without hiding a legitimate second invocation of the same target.

## 2. Proven Origin

From real persisted task `019e4189`: the model emits ONE `read_file` tool_use;
Roo persists TWO `ask:"tool"` cards. Every askApproval tool streams in two
phases - `handlePartial` emits a placeholder card, `requestApproval` emits the
complete card. The placeholder->complete reconciliation in `TaskAskSay.ask`
could fail, stranding the placeholder while the complete card was appended as a
separate second card. Two independent causes were found, each fixed:

- **(a) text-based dedup miss** - the `2026-05-15` finalized-duplicate dedup
  only reused a tail card when `text === text`; for any tool whose placeholder
  and complete payloads diverge in text it missed. Fixed in Sections 3-6.
- **(b) tail-adjacency-bound reconciliation** - reconciliation only matched a
  placeholder still at `clineMessages.at(-1)`, so an intervening `say`
  displaced and orphaned it. Fixed in Section 7.

## 3. Discriminator: native tool-call id

Content-based discriminators fail (a divergent placeholder can be content-less
or content-ful; `tool+path` collapses distinct invocations). The only
invocation-precise signal is the native `tool_use.id`, already on the `block`
passed to both `handlePartial` and `execute`.

Tools stamp the id onto their `ask:"tool"` payloads as `toolCallId`. The dedup
in `TaskAskSay.ask` merges a placeholder into the new complete card iff both
carry the SAME `toolCallId`; when ids are absent it falls back to exact-text.
(Section 7 extends this lookup from the tail to a bounded recent window, so an
intervening `say` cannot defeat it.)
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

| Action | File Path                                               | Brief Purpose                                                         |
| ------ | ------------------------------------------------------- | --------------------------------------------------------------------- |
| NEW    | `src/core/task/toolAskIdentity.ts`                      | `getToolCallId` / `isSameToolInvocation` / `findToolAskIndexByCallId` |
| NEW    | `src/core/task/__tests__/toolAskIdentity.spec.ts`       | Helper unit tests                                                     |
| MOD    | `src/core/task/TaskAskSay.ts`                           | Identity-driven placeholder transition + dedup fallback               |
| MOD    | `packages/types/src/vscode-extension-host.ts`           | Optional `toolCallId` on `ClineSayTool`                               |
| MOD    | `src/core/assistant-message/presentAssistantMessage.ts` | Pass `toolCallId` into every `ask:"tool"` tool's callbacks            |
| MOD    | `src/core/tools/*.ts` (15 tools)                        | Stamp `toolCallId` on placeholder + complete payloads                 |
| MOD    | `src/services/skills/skillInvocation.ts`                | `buildSkillApprovalMessage` accepts `toolCallId`                      |
| MOD    | `src/core/task/__tests__/ask-finalized-dedup.spec.ts`   | Cases a/b/c/d + per-tool + race-elimination tests                     |
| MOD    | `src/core/tools/__tests__/readFileTool.spec.ts`         | Case (d) multi-range read+concatenate                                 |

## 6. Verification Standards

- [x] All four required cases pass (placeholder->complete = ONE; two
      invocations = TWO; multi-range = one card, both ranges concatenated).
- [x] Per-newly-adopted-tool tests: `new_task`, `write_to_file`, diff-family,
      `list_files` - placeholder->race-finalize->complete = ONE card; two
      distinct invocations = TWO cards.
- [x] `codebase_search` no-regression test stays ONE card.
- [x] Race-elimination tests: placeholder transitions in place when a `say`
      intervened; two distinct invocations stay two cards.
- [x] Regression: 640 passed / 4 skipped across 45 task + tool +
      assistant-message + skills suites; webview 31/31; 0 failures.
- [x] `tsc --noEmit` clean for `src`, `packages/types`, `webview-ui`.
- [x] No stranded approvals: transition branch reuses the message and
      resolves the ask promise (execute_command dedup test).

## 7. Race Elimination (deeper fix on the same branch)

### Proven race mechanism

The `TaskAskSay.ask` placeholder->complete reconciliation was
**tail-adjacency-bound**. A tool streams in two phases:

- `handlePartial` -> `ask("tool", placeholder, partial=true)` adds a
  `partial:true` `ask:"tool"` clineMessage (`TaskAskSay.ts` new-partial
  branch, requires the tail).
- `execute`/`requestApproval` -> `ask("tool", complete, false)` was only
  reconciled when the placeholder was still `clineMessages.at(-1)`
  (`isUpdatingPreviousPartial` / tail `isAlreadyFinalizedDuplicate`).

Between those two calls, an intervening `say` displaces the placeholder
from the tail. Concrete path: for `write_to_file` / `apply_diff` / `edit` /
`apply_patch` / `new_task`, `presentAssistantMessage` calls
`checkpointSaveAndMark(cline)` immediately before `*.handle` ->
`checkpointSave` appends a `checkpoint_saved` `say`. A streamed text block
(`presentAssistantMessage.ts:295` `say("text", ...)`) does the same. With
the placeholder no longer at the tail, the complete `ask(..., false)` fell
through to the "new and complete message" branch and appended a second
card, orphaning the placeholder.

### Fix

`TaskAskSay.ask` now locates the `ask:"tool"` placeholder by its native
`toolCallId` **anywhere in a bounded recent window** of `clineMessages`
(`findToolAskIndexByCallId`, 50-message lookback) and transitions it in
place - one `ts`, one message - for both the streaming-update
(`partial:true`) and complete (`partial:false`) calls. The handoff is now
identity-driven, not adjacency-driven, so an intervening `say` cannot
orphan the placeholder. Partial-streaming UX is unchanged: partial cards
still render live; only _who_ finalizes and _by what key_ changed.

The tail-based `toolCallId` dedup is retained as defense-in-depth: it still
covers the no-id fallback path (exact-text) and is not dead code.
