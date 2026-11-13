# Fix: literal `\u0142` codes still in Task Completed after #882

**Date:** 2026-10-14
**Branches:** `fix/decode-escaped-prose-tool-args` (this one), then two follow-ups
off main: history replay and webview display of stored messages.
**Status:** root cause proven from task data.

## What the user saw

Task `01a134d6` (the same task #882 used as evidence) still showed
`Dok\u0142adnie`, `kt\u00f3rym` in the Task Completed block at 19:08 on
2026-10-14, with a VSIX installed at 17:05 that no longer carries the escape
rule (grep of the installed `dist` finds no "encode that character as a JSON").

## Evidence

1. `ui_messages.json`: every `completion_result` of the task, before and after
   #882, holds only escapes (34 to 111 per message, zero raw Polish letters).
   Every plain `text` message of the same turns holds raw Polish letters and no
   escapes. The model writes Polish correctly in prose and escapes it only
   inside the `attempt_completion` argument.
2. `api_conversation_history.json`: the last `tool_use` input holds the literal
   `\u0142` after JSON parsing, so the model sent `\\u0142` on the wire.
3. The model's reasoning in the 19:08 turn no longer quotes any escape rule.
4. The history replayed to the model holds seven earlier `attempt_completion`
   calls written this way (from the #164 rule era). The model copies its own
   earlier tool calls: removing the rule from the prompt does not remove the
   examples from the history.

## Fix

- `decodeLiteralUnicodeEscapes` in `@tumble-code/core` (browser-safe): decodes
  `\uXXXX` runs for non-ASCII code points, surrogate pairs included; keeps
  ASCII escapes, lone surrogates, escaped backslashes and markdown code
  (fenced blocks and inline spans) as written.
- `decodeProseToolArgs` applies it to the arguments of the tools whose strings
  are prose for a person: `attempt_completion`, `ask_followup_question`,
  `update_todo_list`, `new_task`, `run_parallel_tasks`, `switch_mode`.
- `NativeToolCallParser` calls it on the final arguments and on streamed
  partials. The API history is built from `nativeArgs`, so new turns enter the
  history clean and stop feeding the pattern back.

## Follow-ups (parallel branches)

- History replay: decode the same tools' inputs when the request is built from
  stored history, so a task that already holds escaped calls stops teaching
  the pattern (copy only, stored history untouched).
- Webview: decode stored `completion_result` and follow-up text when rendering,
  so old tasks display real letters.

## Rejected alternative

Decoding every tool argument: `write_to_file`, `apply_diff` and
`execute_command` may carry `\u0142` on purpose (JS, Python, JSON source,
printf). #882 rejected the blanket decode for the same reason.
