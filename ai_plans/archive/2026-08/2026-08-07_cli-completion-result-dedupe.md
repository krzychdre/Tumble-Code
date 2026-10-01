# CLI: dedupe completion_result repeating the streamed answer

**Date:** 2026-08-07
**Branch:** `fix/17-cli-completion-result-dedupe` (stacked on `fix/16-cli-spinner-droplet`)
**Status:** implemented

## Problem

The final assistant reply renders twice — two identical `●` bullet rows with
the same text.

## Root cause (proven from the task's ui_messages.json)

Task `019fddd6-af19-7751-963d-0e3b97dd1254`
(`~/.vscode-mock/global-storage/tasks/`):

```text
1786133400647  say text               | Hi. What do you need help with…
1786133402532  say completion_result  | Hi. What do you need help with…   (byte-identical, verified)
1786133402656  ask completion_result  | (empty)
```

GLM repeats its whole answer inside `attempt_completion.result` (weak-model
pattern), so core emits `say:text` and then `say:completion_result` with
byte-identical text. In the CLI both route through `handleSayMessage`'s
generic path as assistant bullets. The existing `lastAssistantText` dedupe
only guarded `say === "text"`, so the cross-kind duplicate passed through.
(The `ask completion_result` carries empty text and renders nothing — it is
not the second copy.)

## Fix

`useMessageHandlers.handleSayMessage`: treat `text` and `completion_result`
as the same "assistant answer" class for the `lastAssistantText` dedupe —
skip a complete message whose text exactly matches the last rendered answer
regardless of which kind came first, and record the marker for both kinds.
Distinct texts and cross-turn repeats (reset at `user_feedback`) are
unaffected.

## Verification

- New tests in `useMessageHandlers.test.tsx`: text→completion_result
  collapse (the proven sequence), reverse order, and a differing
  completion_result must still render.
- `pnpm check-types`, `pnpm lint`, `pnpm test` in `apps/cli`.
- Manual: "cześć" against GLM — a single `●` reply row.
