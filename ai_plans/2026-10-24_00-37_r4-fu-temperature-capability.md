# R4 follow-up: no temperature control for Claude on Anthropic and Vertex

**Status:** Done.

**Related plans:** `ai_plans/2026-10-23_17-20_maintenance-audit-round-4.md` (section "Follow-ups found during
execution"), `ai_plans/2026-10-23_20-02_r4-a4a-anthropic-sdk.md` (the SDK move that dropped `temperature`).

## Touched files

- `packages/types/src/providers/claude.ts`: `withoutTemperature(info)`.
- `packages/types/src/providers/anthropic.ts`, `packages/types/src/providers/vertex.ts`: every Claude entry goes
  through `withoutTemperature`.
- Specs: `packages/types/src/__tests__/claude-model-tables.spec.ts` (+ fixture `claude-model-tables.json`),
  `packages/types/src/__tests__/vertex-model-family.spec.ts`,
  `webview-ui/src/components/settings/__tests__/ApiOptions.spec.tsx`, `src/api/providers/__tests__/anthropic.spec.ts`,
  `src/api/providers/__tests__/anthropic-vertex.spec.ts`, `src/api/transform/__tests__/model-params.spec.ts`.

## Problem

The Anthropic and Vertex SDKs send Anthropic API version 2026-10-21, which rejects `temperature` for every model,
so the Anthropic and Anthropic Vertex handlers send none. The settings still showed the temperature slider for
most Claude models there, and moving it changed nothing. MiniMax (Anthropic SDK, own endpoint) and Bedrock (AWS
SDK) still send `temperature`.

## Change

The model info is the one source the settings and the request parameters both read: the slider is shown when
`supportsTemperature !== false` (`ApiOptions.tsx`), and `getModelParams` drops the temperature for an Anthropic
format model with `supportsTemperature: false`. Every Claude entry of the Anthropic and Vertex tables now carries
`supportsTemperature: false` through one helper, `withoutTemperature`. The shared `claudeModels` records stay
platform neutral, so Bedrock keeps the slider; MiniMax has its own table and keeps it too. An unknown Claude id
gets its info from these tables (the Anthropic guess and the Vertex Claude stand-in), so it hides the slider as
well. The CLI has no temperature setting, so nothing changes there.

## Tests

- `claude-model-tables.spec.ts`: through `resolveProviderModelSelection`, every Anthropic id, an unknown and a
  proxied Claude id on Anthropic, and every Vertex Claude id and an unknown one take no temperature; a Vertex Gemini
  model, a Bedrock Claude model and every MiniMax model do. The frozen fixture gains `supportsTemperature: false`
  on the 12 Anthropic and Vertex entries that lacked it.
- `ApiOptions.spec.tsx`: the slider is hidden for a model whose info says `supportsTemperature: false`.
- Removed: the `temperature` asserts on the Anthropic and Vertex handlers' `getModel()` (no request reads that
  value any more; `anthropic-sdk-wire.spec.ts` pins that no request carries it) and the one in the model-params
  case about budget versus effort (the hybrid 1.0 rule keeps its own cases there).
- Mutations: an Anthropic entry (`claude-sonnet-4-6`) or a Vertex entry (`claude-sonnet-4-5@20250929`) without
  `withoutTemperature` turns the new case and the fixture case red; `ApiOptions` showing the slider
  unconditionally turns the new webview case red.
