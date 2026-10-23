# R4 follow-up: direct spec of ApiRequestBuilder.describeRequestParams

**Status:** Done.

**Related plans:** `ai_plans/2026-10-23_17-20_maintenance-audit-round-4.md` (section "Follow-ups found during
execution").

## Touched files

- `src/core/task/__tests__/ApiRequestBuilder.describe-request-params.spec.ts` (new)

## Problem

`describeRequestParams` builds the request parameters that the cloud error reports and the LLM exchange recorder
show. No spec called it directly, so a wrong field there (a protocol, a disabled effort still reported) would
only show up in a report.

## Change

A spec of our mapping from the task's profile and model to that record:

- the full record for a profile with temperature, effort and tools;
- without tools no `toolChoice` or `parallelToolCalls`, a `null` temperature reported as unset, an effort reported
  as unset when the profile disables reasoning effort;
- the protocol reads the model id (Claude on Vertex is `anthropic`, Gemini on Vertex `openai`);
- the compact profile reports `parallelToolCalls: false`.

The retired-provider branch of the protocol lookup has no observable effect (no retired provider speaks the
Anthropic protocol), so it has no case.

## Tests (mutation checks)

Each of these turns one case red: `modelTemperature ?? 0`; reporting `reasoningEffort` without the
`enableReasoningEffort === false` check; `getApiProtocol` without the model id; the tool fields without the
`hasTools` condition; `parallelToolCalls: true` instead of `resolveParallelToolCalls`.
