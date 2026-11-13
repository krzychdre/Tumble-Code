# Z.ai mainland model table derived from the international one

Status: done (branch `refactor/zai-mainland-table-derived`), simplification round 2 item C6.

## Touched files

- `packages/types/src/providers/zai.ts`
- `packages/types/src/__tests__/zai-mainland-models.spec.ts` (new)
- `packages/types/src/__tests__/__fixtures__/zai-mainland-models.json` (new)
- `.changeset/zai-mainland-table-derived.md`

## Problem

`packages/types/src/providers/zai.ts` held two hand-written tables: `internationalZAiModels` (lines 29-310 on
origin/main) and `mainlandZAiModels` (lines 312-580). A field-by-field comparison (tsx script over both objects)
showed that the 19 mainland entries are the international entries with only these fields changed:

- `inputPrice`, `outputPrice`, `cacheReadsPrice` (CNY list price converted at 7.0), on 17 of 19 models
  (`glm-4.5-flash` and `glm-4.6v-flash` are free on both lines and identical);
- `contextWindow` 204,800 instead of 200,000 on `glm-4.6`, `glm-4.7`, `glm-5-turbo`, `glm-5.1`,
  `glm-4.7-flash`, `glm-4.7-flashx`, `glm-5v-turbo`.

Descriptions, `maxTokens`, capability flags, reasoning settings and `cacheWritesPrice` were identical, and the key
order inside every entry was the same. The mainland list has no `glm-4-32b-0414-128k`, and lists `glm-4.6v` after
`glm-4.7-flashx` (the international list has it after `glm-4.5v`). Every new model had to be pasted twice
(see the GLM-5.1, 5.2 and 5.3 plans), which is how drift starts.

## Fix

`mainlandZAiOverrides` lists, in mainland order, each mainland model id and only the fields that differ.
`mainlandZAiModels` is built from it: `{ ...internationalZAiModels[id], ...override }`, so a fresh object per
entry (nothing shared with or mutated in the international table) with the international key order. The exported
names stay: `MainlandZAiModelId` is now the key set of the override table, and the mapped type of
`mainlandZAiModels` keeps the literal field types (international entry minus the overridden keys, plus the
override), so typed accesses like `mainlandZAiModels["glm-5.3"].reasoningEffort` still type-check. The override
table `satisfies Partial<Record<InternationalZAiModelId, ...>>`, so a mainland id that is not an international
model, or an override of any other field, is a compile error.

## Tests

- New `zai-mainland-models.spec.ts`: `toStrictEqual` against a JSON fixture dumped from the origin/main
  `mainlandZAiModels` before the change, plus key order and a no-aliasing check. Verified it fails when one
  override price is changed.
- The international table was checked byte-equal (JSON) before and after.
- Consumers green: types `zai-api-line`, `provider-model-resolution`, `provider-models`; src `zai.spec`,
  `zai-model-limits.spec`, `portable-model-resolution.spec`; webview `useSelectedModel*`; CLI `context-window`.
- `tsc --noEmit` in packages/types and src.

## Notes

The fixture is kept as the spec's frozen copy: a deliberate mainland price change now means editing the override
and the fixture together, which is the intended friction for a price table.
