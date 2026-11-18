# Subagent context window gauge in the transcript header

Status: done on branch feat/subagent-header-context, not merged
Related plans: 2026-11-18_11-15_subagent-transcript-autoscroll.md, 2026-11-18_11-50_subagent-header-full-prompt.md
Touched:

- `packages/types/src/subagent.ts`
- `src/core/webview/BackgroundTaskRunner.ts`
- `src/core/webview/__tests__/BackgroundTaskRunner.spec.ts`
- `webview-ui/src/components/chat/SubagentTranscriptView.tsx`
- `webview-ui/src/components/chat/__tests__/SubagentTranscriptView.spec.tsx`
- `.changeset/subagent-header-context.md`

## Problem

At the parent commit the transcript header showed mode, profile,
cumulative tokens, cost and status (lines 345-356), but no context figure. The
chat header draws its gauge from the open profile's model: `TaskHeader.tsx`
lines 114-130 read `apiConfiguration` and `useSelectedModel(apiConfiguration)`,
and lines 263-267 pass the result to `ContextWindowProgress`. A subagent can run
on a different pinned profile, and `BackgroundTaskRunner.register` (lines
202-216) stored only `apiConfigName`, so the webview had no model numbers for the
child. `packages/types/src/subagent.ts` lines 44-48 carried `tokensIn`,
`tokensOut` and `totalCost` only.

## Fix

- `subagentSummarySchema` gains optional `contextWindow` and `maxOutputTokens`.
- `BackgroundTaskRunner.createBackgroundTask` reads `task.api.getModel()` and passes `contextWindow: model.info.contextWindow` and `maxOutputTokens: getModelMaxOutputTokens({ modelId: model.id, model: model.info, settings: apiConfiguration })` into `register`, where `apiConfiguration` is the pinned profile resolved above (line 197).
- The view computes
  `const { contextTokens } = useMemo(() => consolidateTokenUsage(messages), [messages])`,
  the last request's `tokensIn + tokensOut` (`tokensIn` already includes cached tokens), and renders
  `ContextWindowProgress` when `summary.contextWindow` exists, else the bare
  `formatLargeNumber(contextTokens)` under the `chat:tokenProgress.contextUsed`
  tooltip. The block renders only when `contextTokens > 0`.

## Tests

`SubagentTranscriptView.spec.tsx`: `it.each` "shows the context size of the last
request in the header", two cases (window known, window unknown). The transcript
is the subtask message plus two `api_req_started` payloads (10_000/500 and
40_000/2_000); the header must read `42.0`, the last request only, and in the
known case also `200.0`; the unknown case must have no `progressbar`.

Mutation checks: forcing the unknown-window branch failed the gauge case on
`200.0`; computing the context from only the first two messages (10_500) failed
on `42.0`.

`BackgroundTaskRunner.spec.ts`: "registers a subagent in the panel before
start(), with the mode-pinned profile and its model". The pinned profile sets
`modelMaxTokens: 12_000` and the test asserts `contextWindow: 200_000` and
`maxOutputTokens: 12_000` on the registered summary. The fake model has
`info.maxTokens: 32_000`, so 12_000 can only come from the pinned profile;
reading the wrong profile fails the assertion.

## Notes

- History-opened subagents and summaries written before this change have no
  `contextWindow`; the header shows only the token count with a tooltip.
- Queued placeholders (`SubagentRegistry.registerQueued`) lack the numbers until
  `register` replaces them.
- The window is captured once, at registration; a later model or profile switch
  inside the child does not update the gauge.
- The CLI is unchanged; the two fields are optional, so its summaries parse as
  before.
