# r4 D5 batch 3: chat hooks without setState in effects

## Status

Done.

## Related plans

- `ai_plans/2026-10-23_17-20_maintenance-audit-round-4.md` (D5, `react-hooks/set-state-in-effect`)

## Touched files

- `webview-ui/src/components/chat/hooks/useAskButtons.ts`
- `webview-ui/src/components/chat/hooks/useChatComposer.ts`
- `webview-ui/src/components/chat/hooks/useChatHostMessages.ts`, `webview-ui/src/components/chat/ChatView.tsx`
- `webview-ui/src/hooks/useScrollLifecycle.ts`
- specs: `ChatView.ask-state-machine.spec.tsx`, `useScrollLifecycle.spec.ts`

## Problem

Seven `set-state-in-effect` findings in the hooks ChatView is built from.

## Change

- `useAskButtons`: a subtask that waits in `resume_task` after its `completion_result` shows "Start New Task" as
  a value derived in render (`isFinishedSubtaskResume`), so the `resume_task` branch of the state machine always
  sets Resume / Terminate and the follow-up effect is gone. An empty message list resets the buttons in render
  (previous-value state).
- `useChatComposer`: the retired-provider warning clears when the provider changes, the answered follow-up when
  the task changes, both in render.
- `useChatHostMessages`: a task switch ends condensing in render; a checkpoint warning is dropped in render while
  the chat is hidden or has no task. The `modifiedMessagesLength` option only fed the old effect and is gone.
- `useScrollLifecycle`: keeps its effect (the rule switch adds a targeted disable). The button must hide in the same step that
  moves the ref-held scroll phase; hidden in render, a Virtuoso `atBottomStateChange` that still sees the old
  phase shows it again (`ChatView.scroll-debug-repro.spec.tsx` goes red).

## Tests

New cases, green before and after: a task switch ends the condensing row; hiding the chat drops the checkpoint
warning for good; a reopened task does not inherit the answered follow-up; the retired-provider warning goes when
the provider changes; a task switch hides the scroll-to-bottom button. The existing state-machine table covers
the finished-subtask resume and the empty-list reset.

Mutation checks, each turned a spec red: each render-time reset removed, `isFinishedSubtaskResume` forced false,
the empty-list reset disabled, the scroll button reset removed.

## Notes

A checkpoint warning that arrives while the chat is hidden is dropped at once; before, it survived until the next
state push.
