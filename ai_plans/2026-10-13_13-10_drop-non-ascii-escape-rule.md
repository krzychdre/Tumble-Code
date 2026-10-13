# Fix: literal `\u0142` codes in Task Completed and in written files

**Date:** 2026-10-13
**Branch:** `fix/drop-non-ascii-escape-rule` (off `main` @ 694104277)
**Status:** root cause proven from task data, rule removed.

## What the user saw

The Task Completed block of task `01a134d6` (profile `GLM-5.3-NVFP4-MAX`,
orchestrator mode) showed `wy\u0142\u0105cznie`, `zamarzni\u0119ta`,
`pakiet\u00f3w` instead of the Polish letters, and `\"entitlements\"` with a
visible backslash.

## Evidence

1. `api_conversation_history.json`, last assistant turn: the
   `attempt_completion` tool_use input holds the string
   `wy\u0142\u0105cznie` AFTER JSON parsing. The model sent `\\u0142` on the
   wire: it escaped the backslash of the escape.
2. The model's own reasoning, three times in that task, quotes the TOOL USE
   rule from #164 ("encode that character as a JSON \uXXXX escape") and plans
   to obey it for Polish text in `new_task`, `update_todo_list` and
   `attempt_completion`.
3. Scan of every stored task since 2026-09-21 (rule shipped that day):
   114 tool arguments carry a literal `\uXXXX` for a non-ASCII code point.
   All sampled ones are ordinary prose double-escaped by the model, not code
   that needs escapes. 40 of them went to disk through `write_to_file` and
   `apply_diff`, 49 into shell commands. Per tool: execute_command 49,
   write_to_file 25, apply_diff 15, attempt_completion 10, new_task 8,
   update_todo_list 6, ask_followup_question 1. Mostly GLM-5.3-Flash-NVFP4
   (100), then GLM-5.3-NVFP4-MAX (9).
4. The bug #164 guarded against is gone: in the same period about 1500 tool
   calls carried raw Polish letters intact, and a scan for diacritic-stripped
   Polish words found no real damage. The `GLM-5.3-Flash` remote profile that
   had the lossy tool-args channel no longer appears in the data.
5. No client code ever decoded literal escapes, and #811 (HTML entities) did
   not touch this path. The display is faithful to what the model sent.

## Fix

Delete the escape paragraph from `getSharedToolUseSection`
([tool-use.ts](../src/core/prompts/sections/tool-use.ts)). The guard test now
asserts the rule is absent. 18 prompt snapshots lose the paragraph (pure
deletions plus two length/hash fingerprints).

The prefix-stability floor drops from 8000 to 7400. The measured worst pair
(any mode vs orchestrator) was 8109 before the change, not the 8196 in the
test's log (later head edits had drifted it unnoticed), and is 7630 after it
(8109 - 479, the paragraph with its blank line).

## Rejected alternative

Decoding literal `\uXXXX` in tool arguments on the client would corrupt
content that holds such escapes on purpose (JS/Python/JSON source written
with `write_to_file`). Removing the instruction removes the cause instead.

## Residuals

- Files already written with literal escapes (40 tool calls) stay as they are.
- If a backend starts losing non-ASCII bytes in the tool-args channel again,
  the evidence pattern is in `ai_plans/archive/2026-09/2026-09-10_tool-args-non-ascii-loss.md`;
  a per-profile fix belongs at the transport, not in the shared prompt.
