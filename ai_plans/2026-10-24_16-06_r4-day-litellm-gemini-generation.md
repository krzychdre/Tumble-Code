# R4 day wave: LiteLLM thought signatures for every Gemini generation from 2.5 on

**Status:** Done.

**Related plans:** `ai_plans/2026-10-23_17-20_maintenance-audit-round-4.md`,
`ai_plans/2026-10-24_16-02_r4-day-gemini-new-models.md` (found the gap).

## Touched files

- `src/api/providers/lite-llm.ts`, `src/api/providers/__tests__/lite-llm.spec.ts`

## Problem

`LiteLLMHandler.isGeminiModel` decides whether the handler injects the dummy thought signature into earlier tool
calls; Gemini 2.5 and later reject tool-call history without one. It matched only the literal strings `gemini-3`
and `gemini-2.5` (with a space or a provider prefix), so `gemini-4-argon`, served by Google since 2026-10-13, got
no signature through LiteLLM, and every later generation would have hit the same gap.

## Change

The check reads the version that follows a whole word `gemini` and a hyphen or space, and accepts 2.5 and later.
It covers bare ids, LiteLLM provider prefixes (`gemini/`, `vertex_ai/`, `openrouter/google/`) and model group names
(`Gemini 3 Pro`). It does not match `gemini-2.0-*`, `gemini-1.5-*`, ids without a version (`gemini-flash-latest`,
`gemini-embedding-001`), Gemma, or `gemini` inside a longer word.

No other place in `src/api` checks the Gemini generation: `sanitizeGeminiMessages` (`openai-format.ts`) applies to
every id containing `gemini`, OpenRouter checks the `google/gemini` prefix and exact 2.5 Pro ids, and
`model-params.ts` checks the 2.5 Pro model for its thinking-budget minimum. A shared helper would have one caller,
so the check stays a private method.

## Tests

`lite-llm.spec.ts`: one `it.each` over positive ids (2.5, 3, 3.8, 4, 10, prefixed, group names) and negatives
(2.0, 1.5, unversioned, embedding, Gemma, `notgemini-4`, GPT, Claude). Mutations, each turning cases red: minor
threshold 5 -> 0 (`gemini-2.0-flash`), dropping the word boundary (`notgemini-4`), accepting only major 3
(the 2.5, 4 and 10 cases).
