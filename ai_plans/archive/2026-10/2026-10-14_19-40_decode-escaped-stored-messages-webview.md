# Fix: show real letters in stored prose messages (webview)

**Date:** 2026-10-14
**Branch:** `fix/decode-escaped-stored-messages-webview` (off main after #893)
**Base plan:** [2026-10-14_19-20_decode-escaped-prose-tool-args.md](2026-10-14_19-20_decode-escaped-prose-tool-args.md)
**Status:** done.

## What

#893 decodes literal `\uXXXX` text in prose tool arguments when the host
parses a NEW tool call. Messages stored before #893 are not rewritten, so
reopening an old task still shows `Dok\u0142adnie` instead of `Dokładnie`.

## Evidence

The base plan proves it from task `01a134d6`: its `ui_messages.json` holds 8
`completion_result` messages written entirely with escapes (the six
characters backslash, `u`, `0`, `1`, `4`, `2`), while plain `text` messages of
the same turns hold real letters. The webview renders `message.text` as is,
so these codes reach the screen on every reopen.

## Fix

One module, `webview-ui/src/components/chat/rows/decodeStoredProse.ts`, with
two functions built on `decodeLiteralUnicodeEscapes` from
`@tumble-code/core/browser` (non-ASCII escapes only, markdown code kept as
written):

- `decodeStoredProse(message)`: decodes the text of `say: completion_result`,
  `say: subtask_result` and `ask: completion_result`, and the `question` and
  `suggest[].answer` of a finished `ask: followup` (parsed, decoded and
  serialised again, because in the JSON the backslash is itself escaped).
  Any other message, or one without `\u`, comes back as the same object.
- `decodeProseTool(tool)`: decodes `content` of `newTask`, `reason` of
  `switchMode` and `todos[].content` of `updateTodoList`. Other tools come
  back as the same object.

Decode points:

- `ChatRowContent` (ChatRow.tsx): decodes the message once before it picks a
  renderer, and the parsed tool payload. Every renderer, the markdown
  preview and the annotate button get the decoded text without their own call.
- `parseToolCached`: decodes the parsed payload, so the todo list header
  (`selectLatestTodos`), the previous todos of the todo diff
  (`computeRowMeta`) and the rows agree. Decoding only the rows would make the
  todo diff show every item as changed.
- `SubagentsPanel`: `tailEntryFor` and the suggestion buttons of a pending
  follow-up.

A clicked follow-up suggestion now sends the decoded answer, which is what
the user saw.

## Deliberately not decoded

- File content, diffs, search results and commands (`ask: command`, file
  tools, `say: tool`): an escape there may be intended code.
- Plain `say: text` and reasoning: the model writes real letters there (base
  plan evidence 1).
- `user_edit_todos`: written by the user, not the model.
- The stored files themselves: the fix is display only; the history replay
  to the model is a separate branch.
- Follow-up auto-approval (`firstUsableSuggestion` in the ask hooks) reads
  the raw stored text; it only fires for a live pending question, which #893
  already decodes on the host.

## Tests

- `rows/__tests__/decodeStoredProse.spec.ts`: pure function cases, identity
  when nothing changes, file payload untouched.
- `__tests__/ChatRow.stored-escapes.spec.tsx`: completion (say and ask),
  code span kept, follow-up question and answers, new subtask, command row
  untouched. Five of six fail without the fix.
- `__tests__/SubagentsPanel.spec.tsx`: a stored completion and question in a
  subagent transcript.
