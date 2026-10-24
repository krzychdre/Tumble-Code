# r4 D5 batch 2: chat components without setState in effects

## Status

Done.

## Related plans

- `ai_plans/2026-10-23_17-20_maintenance-audit-round-4.md` (D5, `react-hooks/set-state-in-effect`)

## Touched files

- `webview-ui/src/components/chat/ChatView.tsx`
- `webview-ui/src/components/chat/FollowUpSuggest.tsx`
- `webview-ui/src/components/chat/McpExecution.tsx`
- `webview-ui/src/components/chat/SubagentTranscriptView.tsx`
- `webview-ui/src/components/chat/UpdateTodoListToolBlock.tsx`
- their specs

## Problem

Six `set-state-in-effect` findings in the chat components: effects copied props into state, or reset state, one
render after the change.

## Change

- `ChatView`: expanded rows reset in render when the task changes (previous-value state); clearing the
  ever-visible cache (a mutable set, not state) stays in an effect.
- `FollowUpSuggest`: the countdown start value is computed in render and reset in render whenever an input of the
  countdown changes (counting or not, suggestions, timeout, cancel callback). The interval effect keeps only the
  timer and its cleanup.
- `McpExecution`: arguments, server and tool names follow the props in render; the response from the ask replaces
  the streamed text when the ask's response string changes (before, any new `useMcpServer` object did).
- `SubagentTranscriptView`: switching `taskId` clears the transcript in render; the effect keeps the
  subscribe/unsubscribe messages.
- `UpdateTodoListToolBlock`: leaves edit mode in render when it becomes read-only, and restarts its edit copy when
  the parent passes new todos (previous-value state).

## Tests

New cases, green before and after: ChatView forgets expanded rows when another task opens; FollowUpSuggest starts
over on a new timeout and on new suggestions; McpExecution shows the latest server, tool, arguments and response;
SubagentTranscriptView drops the old transcript and resubscribes on a switch; UpdateTodoListToolBlock leaves edit
mode for good and replaces local edits with new todos.

Mutation checks, each turned a spec red: every render-time reset or copy removed one at a time, and each of the
FollowUpSuggest restart conditions dropped.

`src/components/chat` specs (70 files) pass; tsc; React Compiler bailouts unchanged (2).
