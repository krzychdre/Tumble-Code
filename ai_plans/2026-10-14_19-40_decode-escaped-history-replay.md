# Fix: decode escaped prose tool calls when replaying task history

**Date:** 2026-10-14
**Branch:** `fix/decode-escaped-history-replay`
**Base:** [2026-10-14_19-20_decode-escaped-prose-tool-args.md](2026-10-14_19-20_decode-escaped-prose-tool-args.md) (#893)
**Status:** done.

## What

#893 decodes literal `\uXXXX` codes in the arguments of prose tools
(`attempt_completion`, `ask_followup_question`, `update_todo_list`, `new_task`,
`run_parallel_tasks`, `switch_mode`) when a tool call is parsed, so new calls
enter the API history clean. A task saved before #893 still holds the old
escaped calls in `api_conversation_history.json`, and those are replayed to the
model on every request.

## Evidence

See the base plan, point 4: task `01a134d6` replays seven earlier
`attempt_completion` calls with `ł` text, and the model copies its own
earlier tool calls. Removing the escape rule from the prompt (#882) did not
stop it, because the examples stayed in the history. #893 stops new examples
from being added; this change stops the old ones from being sent.

## Fix

- `decodeProseToolUsesInHistory(messages)` in
  `src/core/assistant-message/decodeProseToolArgs.ts`: for every assistant
  message, runs `decodeProseToolArgs` on the `input` of each `tool_use` block.
  Only the prose tools are touched; `write_to_file`, `apply_diff`,
  `execute_command` and the rest keep their input verbatim. User messages and
  tool results are never touched.
- `ApiRequestBuilder.buildCleanConversationHistory` applies it right after
  microcompaction, so it covers every request built from stored history (this
  method has a single caller, `TaskApiLoop`).
- No alias resolution: `TOOL_ALIASES` holds no alias for a prose tool, so the
  stored `name` is already the canonical one.

## Why copy only

Same contract as microcompaction: the stored history stays as written and only
the request gets the decoded form. The helper copies the array, the message and
the block it changes, and returns the very same array (same message objects)
when nothing needs decoding, which is the common case for tasks started after
#893. Spec: `ApiRequestBuilder.prose-tool-decode.spec.ts` checks the decoded
`attempt_completion`, the verbatim `write_to_file` content and user text, and
that the stored messages are not mutated; `decodeProseToolArgs.spec.ts` checks
the same-reference path.

## Prompt cache note

For an old task, the first request after this change sends a different prefix
(the decoded calls), so that one request misses the provider's prompt cache.
The decoding is deterministic and depends only on the stored history, so every
later request sends the same decoded prefix and the cache is stable again.
Tasks without escaped calls send exactly the same bytes as before.
