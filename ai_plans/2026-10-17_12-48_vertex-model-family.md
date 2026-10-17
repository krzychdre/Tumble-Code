# Vertex: pick the handler and the model info from one model family

**Status:** implemented on `refactor/vertex-model-family`, rebased onto main after #901, not pushed, not merged
**Related plans:** `ai_plans/2026-10-17_12-23_vertex-bedrock-default-model.md` (introduced the single
`vertexUnknownModelStandInId` this branch replaces), `ai_plans/2026-10-17_12-43_vertex-open-models.md` (#901,
dropped the open `-maas` models from the table, so the "open" family has no listed model any more)
**Touched:**

- `packages/types/src/provider-model-selection.ts` (new `VertexModelFamily`, `vertexModelFamily`, per-family
  catalog `vertexModelCatalog`; `isVertexClaudeModel` removed)
- `packages/types/src/providers/vertex.ts` (`vertexUnknownModelStandInId` replaced by
  `vertexUnknownClaudeModelStandInId` and `vertexUnknownGeminiModelStandInId`, nothing else)
- `packages/types/src/provider-models.ts` (the Vertex definition no longer names one stand-in)
- `src/api/runtime-provider-registry.ts` (handler and `resolveModel` choose by `vertexModelFamily`)
- `webview-ui/src/hooks/models/useSelectedModel.ts` (the Vertex special case in `settingsForSharedResolver` is
  gone: the shared resolver now resolves an unset id the same way)
- tests: new `packages/types/src/__tests__/vertex-model-family.spec.ts`, new
  `src/api/providers/__tests__/vertex-model-family-characterization.spec.ts`, and updates in
  `provider-model-resolution.spec.ts`, `vertex.spec.ts`, `runtime-provider-registry.spec.ts`,
  `provider-definitions.spec.ts`

## Problem

Vertex runs two handlers: `AnthropicVertexHandler` for Claude and `VertexHandler` (the Gemini handler in Vertex
mode) for everything else. Before this change the registry picked the handler with
`isVertexClaudeModel(options)` (`apiModelId?.startsWith("claude") ?? false`), while the model id and info came
from `resolveCatalogModel(apiModelId, vertex table)`. Two sources, three defects:

1. **No id or an empty id.** `isVertexClaudeModel` read the configured id, saw nothing and chose the Gemini
   handler; the catalog resolved the empty id to the default, `claude-opus-5`. So a Claude model id was sent
   to the Gemini API, which cannot serve it.
2. **One stand-in for every unknown id.** `vertexUnknownModelStandInId` (Claude Sonnet 4.5) sized both an
   unknown Claude id and an unknown Gemini id. On the Gemini handler that meant 40k output tokens, a 200k
   context, Claude prices and, with reasoning on, a thinking budget that Gemini 1.5 and 2.0 reject.
3. **Two sources can disagree.** The prefix decided the handler, the table decided the info; nothing tied them.

## Change

`vertexModelFamily(settings)` decides the family once, and everything else is derived from it:

1. Resolve the effective id: the configured id, or `vertexDefaultModelId` when none or `""` is set.
2. Read the family from the id's prefix: `claude` is `"claude"`, `gemini` is `"gemini"`, anything else is
   `"open"`. For a listed model the id is the table key (there are no Vertex aliases), so this is the family of
   the table entry; an unlisted id is judged by the same rule. No marker field was needed: every Claude key
   starts with `claude` and every Gemini key with `gemini` (a spec pins that the table now holds no "open" id).

Derived from the family:

- **Handler** (`runtime-provider-registry.ts`): `"claude"` builds `AnthropicVertexHandler`; `"gemini"` and
  `"open"` build `VertexHandler`, exactly as before for every non-empty id.
- **Unknown-id stand-in** (`vertexModelCatalog(family)` sets `unknownModelInfoId` on a copy of the Vertex
  definition; the generic `unknownModelInfoId` mechanism of `resolveCatalogModel` is unchanged and Bedrock still
  uses it as before).
- **Settings UI**: `resolveProviderModelSelection` uses the same family, so `useSelectedModel` no longer needs
  to substitute the default id for an unset Vertex id.

### Chosen stand-ins

| Family           | Stand-in                     | Why                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claude`         | `claude-sonnet-4-5@20250929` | Unchanged. It lists no effort levels (`supportsReasoningEffort` absent) and accepts temperature, so a newer Claude we know nothing about gets no `output_config.effort` and keeps its temperature. Opus 5 (the default) would send an effort and drop temperature.                                                                                                                            |
| `gemini`, `open` | `gemini-2.0-flash-001`       | It has no `supportsReasoningBudget`, `requiredReasoningBudget`, `supportsReasoningEffort` or `reasoningEffort`. In `getGeminiReasoning` (`src/api/transform/reasoning.ts`) a thinking budget needs a budget model and a thinking level needs an effort, so with this record the handler sends no `thinkingConfig`; `maxTokens` 8192 fits Gemini 1.5 and 2.0. "open" runs on the same handler. |

Known limitation, not changed here: `getGeminiReasoning` also turns an explicit `reasoningEffort` left in the
profile into a `thinkingLevel` for any model without an effort list. That already holds for the listed Gemini
1.5 and 2.0 ids (it was pinned in the temporary characterization snapshot), so the stand-in cannot do better than them.

## Can an empty `apiModelId` be saved for Vertex?

- The schema accepts it: `apiModelId: z.string().optional()` (`packages/types/src/provider-config/shared.ts`).
  Neither `ContextProxy.setProviderSettings` nor `ProviderSettingsManager` turns `""` into `undefined`.
- The settings form does not write it: `ModelPicker.onSelect` returns early for an empty id, and its mount
  effect writes the default id when none is selected; `ApiOptions` syncs `apiModelId` only when the selected
  id is non-empty. The CLI always fills the model (`defaultModelFor` in `apps/cli/src/lib/utils/provider-config.ts`).
- An unset id (`undefined`) is reachable: any profile saved without passing through the form (an imported or
  hand-edited profile, an older profile). It hit defect 1 just like `""`.

Either way the runtime now resolves the default before it picks the handler, so both always agree.

## Behaviour changes (intended)

- No id or `""`: `AnthropicVertexHandler` with `claude-opus-5` (was `VertexHandler` with the Claude id).
- Unknown Gemini id and unknown or saved open-model id: Gemini 2.0 Flash info (was Claude Sonnet 4.5 info).
  Saved `-maas` ids still build `VertexHandler`; their requests fail as before (#901).
- Unknown Claude id: unchanged.
- Every listed id: byte-identical (see Tests).

## Tests

- Characterization: `vertex-model-family-characterization.spec.ts` snapshots, for every `vertexModels` key and
  two settings variants (plain; 1M on with reasoning effort high), the handler class, `getModel()`, the
  registry's `resolveModel` and the settings-side resolution. Generated on main before the refactor; the
  refactored code matched it byte for byte. After the rebase onto #901 the entries of the 8 deleted ids were
  pruned (they were obsolete, the remaining 76 matched unchanged). The 6,199-line snapshot was then deleted
  before merging: it pinned every price and limit of the table, so every later model or price change would
  have rewritten thousands of snapshot lines. The spec now checks the rule instead: for every table key the
  family's handler runs it, under its own id (a `:thinking` variant under its base id), with its own record's
  price and context window, and the registry and the settings UI resolve the same id.
- Regression for defect 1: `runtime-provider-registry.spec.ts` and `provider-definitions.spec.ts` (no id and
  `""` build `AnthropicVertexHandler`, and its `getModel()` equals `resolveModel`).
- Regression for defect 2: `vertex-model-family.spec.ts`, `provider-definitions.spec.ts`, `vertex.spec.ts`
  (unknown Gemini id gets 8192 output tokens, a 1M context and no thinking config even with reasoning on).
- Ran: `packages/types` (all), the Vertex, Anthropic Vertex, registry, provider-definitions, portable-resolution
  and gemini-wire specs in `src`, `webview-ui` model hook specs, CLI context-window, run and provider-config
  tests; `tsc --noEmit` in `packages/types`, `src`, `webview-ui`.
