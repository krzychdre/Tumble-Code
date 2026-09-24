# Zoo #1286 port: ignore blank or missing follow-up suggestion answers

**Status:** ported (one commit on wip/zoo-agent-c)
**Upstream:** Zoo-Code PR #1286, commit bb6e254c2, merged 2026-09-07 (authors eason liang, edelauna)
**Touched:** packages/types/src/followup.ts (+ new `__tests__/followup.spec.ts`), src/core/tools/AskFollowupQuestionTool.ts, src/core/auto-approval/index.ts, webview-ui/src/components/chat/FollowUpSuggest.tsx, ChatView.tsx, SubagentsPanel.tsx, and the specs for the tool, auto-approval and FollowUpSuggest

## Symptom

Weak models (GLM, Qwen, local Llamas) sometimes call `ask_followup_question` with suggestion
items whose text is empty, missing, not a string, or with plain strings instead of objects. The
webview then shows empty suggestion buttons; "Copy to input" on one pushes `undefined` into the
chat input and the text area crashes on `.trim()`. With follow-up auto-approval on, the timeout
answers the question with an empty (or `undefined`) reply.

## Root cause in our code

- `src/core/tools/AskFollowupQuestionTool.ts:68` mapped every item to `{ answer: s.text }`
  without checking it (a `null` item even threw), so malformed items reached the ask payload.
- `src/core/auto-approval/index.ts:113` (our "autonomous" branch) and `:139` (default branch)
  took `suggest[0]` blindly and answered with its `answer`, whatever it was.
- `webview-ui/src/components/chat/FollowUpSuggest.tsx:116` rendered every item;
  `ChatView.tsx` `handleSuggestionClickInRow` pushed `suggestion.answer` into the input;
  `SubagentsPanel.tsx` (our own child-task panel) rendered every item as a button.

## Fix

- `@roo-code/types`: `hasUsableAnswer()` (non-blank string answer, accepts unknown input) and
  `firstUsableSuggestion()`; `SuggestionItem.answer` is now optional (schema too), so every
  reader must guard it at compile time.
- The tool keeps plain-string items as answers and drops items without usable text, so new
  messages are clean for every client (webview and CLI).
- Both auto-approval branches use `firstUsableSuggestion()`. Default mode asks the user when no
  suggestion is usable; autonomous mode still proceeds, with `""` rather than a non-string.
- The webview filters unusable suggestions in FollowUpSuggest (no countdown when none remain) and
  SubagentsPanel, and ChatView ignores a click on one (defence in depth for old saved tasks).

## Tests

Failed before the fix: 4 new `checkAutoApproval.spec.ts` cases (default mode answered `""`/timed
out instead of skipping or asking; autonomous answered `""`/`7` instead of the first usable one),
the new `askFollowupQuestionTool.spec.ts` case (blank items kept, `null` item threw), and 2 new
`FollowUpSuggest.spec.tsx` cases (5 buttons instead of 1; a countdown and buttons with nothing
usable). After: auto-approval + tool specs 111/111, `src/components/chat` 444/444,
`packages/types` followup spec 5/5; tsc clean in src, webview-ui, packages/types and apps/cli;
eslint clean.

## Not ported

- ChatTextArea `normalizedInputValue` rewrite: with the guards above no path pushes a
  non-string into the input any more, so the large defensive rewrite is not needed.
- Zoo's ChatView and ChatTextArea mutation-coverage tests, CodeRabbit follow-ups.
- CLI (`apps/cli`, not in Zoo): new messages are already clean thanks to the tool-side filter;
  its own suggestion parsing (`ask-dispatcher.ts:298`, `useMessageHandlers.ts:551`) could adopt
  `hasUsableAnswer` for old saved tasks as a follow-up.
