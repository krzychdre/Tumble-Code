# Composer re-rendered on every streamed token only to rebuild the prompt history

**Status:** done on `perf/webview-composer-prompts`
**Related:** security audit 2026-11-06, finding WO-3
**Touched:** `webview-ui/src/components/chat/hooks/usePromptHistory.ts`, `webview-ui/src/components/chat/ChatTextArea.tsx`

## Problem

`ChatTextArea` selected the whole `clineMessages` (`useExtensionSelector((s) => s.clineMessages)`), used only by
`usePromptHistory` to list the task's `user_feedback` prompts. The host sends a new array on every streamed
token, so the textarea, mention menu, toolbars and highlight layer re-rendered per token.

The element itself is stable across tokens: in the compiled `ChatView` (React Compiler, same options as
`vite.config.ts`) `<ChatTextArea>` is cached on composer state and callbacks that depend on `isStreaming`,
`sendingDisabled` and the input, not on the messages, so the subscription was the only per-token trigger.

## Fix

`useTaskPrompts()` selects the prompts themselves (`taskPromptsOf(s.clineMessages)`) with an equality that
compares the strings, so a token that leaves the prompts unchanged returns the previous snapshot and the
composer does not re-render. `usePromptHistory` takes `taskPrompts` (undefined when no task is open) instead
of the messages. The selector still walks the messages per store commit, which is cheap next to a render.

## Tests

`usePromptHistory.spec.ts`: `useTaskPrompts` under the real `ExtensionStateContextProvider` does not
re-render on two streamed-token state pushes and re-renders once on a new prompt. Mutation: without the
equality the case is red. The existing history cases run through `taskPromptsOf`.
`ChatTextArea.lockApiConfig.spec.tsx`: the mocked state gains `clineMessages: []`, the real store's default.
