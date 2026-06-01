# Zoo PR #233 — Omit temperature for OpenAI-Compatible models that don't support it

- **Upstream:** Zoo-Code #233 (squash of #215), commit `513f47d59`, merged 2026-05-21 22:13:38Z, author Armando Vaquera.
- **Branch:** `feature/zoo-233-openai-omit-temperature` (off `main`).
- **Credit:** `Co-authored-by: Armando Vaquera <proyectoaura.org@gmail.com>`.

## Problem

Some OpenAI-Compatible models (e.g. `claude-opus-4-7`) reject requests with a 400
because `temperature` is deprecated/unsupported. The OpenAI-Compatible provider was
always sending `temperature`. Other providers (openai-native, gemini, lite-llm,
vercel-ai-gateway) already honor the model's `supportsTemperature` flag — the
OpenAI-Compatible handler did not.

## Fix (product — `src/api/providers/openai.ts`)

In the streaming `requestOptions`, gate the `temperature` field on
`modelInfo.supportsTemperature !== false`, spreading it conditionally:

```ts
...(modelInfo.supportsTemperature !== false && {
	temperature: this.options.modelTemperature ?? (deepseekReasoner ? DEEP_SEEK_DEFAULT_TEMPERATURE : 0),
}),
```

`supportsTemperature === false` omits the field; `undefined` (the default) keeps
sending it, preserving behavior for all other models. `modelInfo` is already in scope
(`const { info: modelInfo, reasoning } = this.getModel()`).

## Tests (`src/api/providers/__tests__/openai.spec.ts`)

- Import `DEEP_SEEK_DEFAULT_TEMPERATURE` from `@roo-code/types`.
- Add 4 tests after the `reasoning_effort` test:
    1. omits `temperature` when `openAiCustomModelInfo.supportsTemperature === false`;
    2. includes `temperature` by default when the flag is unset;
    3. uses the configured `modelTemperature` (0.5) when the flag is not false;
    4. defaults to `DEEP_SEEK_DEFAULT_TEMPERATURE` for `deepseek-reasoner`.

## Scope

No aimock parts. Both files apply cleanly: our fork's streaming `requestOptions`
temperature line and the spec's anchors (`openAiModelInfoSaneDefaults` import, the
`reasoning_effort).toBeUndefined()` test, and `should include max_tokens when
includeMaxTokens is true`) match the upstream pre-image.

## Verification

- `npx vitest run api/providers/__tests__/openai.spec.ts` (from `src/`).
- Build gate: `pnpm install:vsix -y --editor=code` must be green before push.
