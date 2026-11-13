# Zoo #842 port: Anthropic provider honors a custom model id

**Status:** ported, one commit.
**Upstream:** Zoo-Code PR #842, commit `13c803b7d`, merged 2026-07-09, authors Konstantin Krastev and Naved Merchant.
**Touched:** `src/api/providers/anthropic.ts`, `src/api/providers/__tests__/anthropic.spec.ts`.

## Symptom

With the Anthropic provider, any model id that is not a key of `anthropicModels` (a dated snapshot
such as `claude-sonnet-4-5-20250929`, an undated alias such as `claude-haiku-4-5`, a model id of a
proxy behind a custom base URL, or a model id typed into `cli-settings.json`) was silently replaced
by the default model `claude-opus-5`. The request went to the API as Opus 5, so the user talked to
(and paid for) a model they did not choose.

## Root cause in our code

`src/api/providers/anthropic.ts:315` (before the fix):
`let id = modelId && modelId in anthropicModels ? modelId : anthropicDefaultModelId`. Every unknown
id became the default id. The `in` operator also matched inherited keys, so `toString` resolved
`info` to a function.

## Fix

`getModel()` now resolves in three branches, mirroring our Gemini fix (Zoo #317, commit `41632a116`):

1. `Object.hasOwn(anthropicModels, id)`: known model, unchanged behavior.
2. Any other non-empty id is sent to the API as typed. Its model info comes from
   `guessAnthropicModelInfo`: the longest known id (or its undated alias, the id without the
   `-YYYYMMDD` suffix) contained in the custom id, compared case-insensitively. That keeps the
   right limits, thinking capabilities and pricing for snapshots, aliases and prefixed proxy ids.
   When nothing matches, it uses the default model's limits and capabilities with pricing, tiers
   and long-context pricing removed, so cost is not billed at the rates of another model (the
   same choice the Gemini fix made).
3. No id: the default model, unchanged.

Prompt caching: `createMessage` picks the cached path from `info.supportsPromptCache`. Every known
model and the default fallback have it set, so custom ids keep cache breakpoints and the
`prompt-caching` beta header. That is the same request shape as before the fix (which always sent
the default model), minus the wrong model id. Anthropic-compatible endpoints accept `cache_control`.

## Tests

New cases in `anthropic.spec.ts`; all six failed before the fix (five received `claude-opus-5`
or its info, the `toString` case received a function):

- `createMessage` sends `claude-sonnet-4-5-20250929` as-is, with the system cache breakpoint and the
  prompt-caching beta header;
- `Anthropic/Claude-Sonnet-4-5-20250929` keeps its id and gets `claude-sonnet-4-5` info;
- `claude-haiku-4-5` gets `claude-haiku-4-5-20251001` info;
- `claude-opus-5-5-20261001` gets Opus 5.5 info, not Opus 5 (longest match wins);
- `my-proxy-model` keeps its id, gets the default limits, prompt caching, no pricing;
- `toString` resolves to an object, not a function.

`anthropic.spec.ts` + `runtime-provider-registry.spec.ts`: 78 passed. `tsc --noEmit`, eslint and
prettier are clean.

## Not ported

- Zoo's changeset file (our changesets are handled separately by the lead).
- Zoo keeps the default pricing for unmatched ids; we drop it, as our Gemini port did.

## Follow-up (not done here)

The 1M-context beta (`anthropicBeta1MContext`) still keys on exact ids, so a dated custom id such as
`claude-sonnet-4-5-20250929` does not get it.
