# Port Zoo #274 — configurable max output tokens for GLM / Z.ai models

- **Date:** 2026-06-03
- **Branch:** `feature/zoo-274-glm-max-output-tokens` (off `main`)
- **Upstream:** Zoo-Code PR #274 (commit `99c7ed1bb`), implements Zoo issue #161
- **Type:** provider feature · size M · risk low-medium

## §0 Credit

```
Co-authored-by: Armando Vaquera <263793884+proyectoauraorg@users.noreply.github.com>
Co-authored-by: edelauna <54631123+edelauna@users.noreply.github.com>
```

## §1 Goal

Models that advertise a configurable max output (`supportsMaxTokens`, e.g. Z.ai GLM)
but no reasoning budget get a standalone "Max Output Tokens" slider that persists
`modelMaxTokens`; the runtime honors that override (capped at the model ceiling)
and `export()` preserves it.

## §2 Fork-divergence decisions (verified — do NOT apply line-numbered patches blindly)

1. **Which models get `supportsMaxTokens`.** Zoo flagged `glm-5.1` + `glm-5-turbo`
   (the GLM-5 family entries whose `maxTokens === 131_072`), NOT `glm-5`
   (`maxTokens 16_384`). Our fork has **no `glm-5-turbo`**; the only entries with the
   131_072 ceiling are **`glm-5.1`** in `internationalZAiModels` AND `mainlandZAiModels`.
   → Flag **exactly those two `glm-5.1` entries**. Do not flag `glm-5`, `glm-4.7`, etc.

2. **`getModelMaxOutputTokens` ordering.** Our fork already bypasses the 20% clamp for
   zai (`isZaiProvider` → returns full `model.maxTokens`), which Zoo's tree does not have.
   The new override branch MUST be inserted **before** the `if (model.maxTokens)` block
   (i.e. before the zai bypass) so a user-set `modelMaxTokens` wins over the bypass.

3. **One UI test adapted.** Zoo's test _"should default the slider to the 20% clamp …"_
   expects `40000` because Zoo clamps zai to 20%. Our zai bypass returns the full
   `131072`, and the slider must reflect the runtime value, so this test asserts
   **`131072`** in our fork (with a comment explaining the Z.ai bypass). All other
   upstream tests port verbatim.

## §3 TDD — tests first (write, run, see RED)

### 3a. `packages/types/src/providers/zai.ts` is data; assert via `src/api/providers/__tests__/zai.spec.ts`

After the existing block near line 503 add (adapted — no `glm-5-turbo`):

```ts
it("should advertise supportsMaxTokens for configurable GLM models", () => {
	expect(internationalZAiModels["glm-5.1"].supportsMaxTokens).toBe(true)
	expect(mainlandZAiModels["glm-5.1"].supportsMaxTokens).toBe(true)
	// Models without a large configurable output budget should not advertise the flag.
	expect((internationalZAiModels["glm-5"] as { supportsMaxTokens?: boolean }).supportsMaxTokens).toBe(undefined)
	expect((internationalZAiModels["glm-4.7"] as { supportsMaxTokens?: boolean }).supportsMaxTokens).toBe(undefined)
})

it("should honor an explicit modelMaxTokens override instead of the 20% clamp", async () => {
	const handlerWithModel = new ZAiHandler({
		apiModelId: "glm-5.1",
		zaiApiKey: "test-zai-api-key",
		zaiApiLine: "international_coding",
		modelMaxTokens: 100_000,
	})
	mockCreate.mockImplementationOnce(() => ({
		[Symbol.asyncIterator]: () => ({
			async next() {
				return { done: true }
			},
		}),
	}))
	const messageGenerator = handlerWithModel.createMessage("system prompt", [])
	await messageGenerator.next()
	expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ model: "glm-5.1", max_tokens: 100_000 }))
})
```

NOTE: confirm `zaiApiLine: "international_coding"` matches our ZAiHandler options and that
`internationalZAiModels`/`mainlandZAiModels` are imported in this spec; adjust to our
imports if needed. If the override test depends on `getModelMaxOutputTokens`/handler wiring
our fork routes differently, keep only the assertion that `max_tokens` equals the override.

### 3b. `src/shared/__tests__/api.spec.ts` — add the two override tests verbatim from upstream

(`honor the user's modelMaxTokens override …` → 64_000; `cap … at the model's own maxTokens
ceiling` → 32_000). Both use `apiProvider: "zai"`.

### 3c. `src/core/config/__tests__/ProviderSettingsManager.spec.ts` — add upstream's `vi.mock("../../../api")`

block (real `@roo-code/types` model info) and the two `export()` tests (GLM keeps
`modelMaxTokens`, drops `modelMaxThinkingTokens`; anthropic drops both). Port verbatim.

### 3d. `webview-ui/src/components/settings/__tests__/ThinkingBudget.spec.tsx` — add upstream's

`describe("configurable max output tokens (supportsMaxTokens)")` block, but change the
default-value test to our zai bypass:

```ts
it("should default the slider to the model's full max output (Z.ai bypass) when modelMaxTokens is unset", () => {
    render(<ThinkingBudget {...defaultProps} apiConfiguration={glmApiConfiguration} modelInfo={glmModelInfo} />)
    // Our fork bypasses the 20% clamp for zai, so the runtime default is the full ceiling (131072).
    const slider = screen.getByTestId("max-output-tokens").querySelector("input[type='range']")!
    expect(slider).toHaveValue("131072")
})
```

All other UI tests port verbatim. Confirm `fireEvent`, `ModelInfo`, `defaultProps` are
already imported/defined in the spec.

Run RED:

- `cd src && npx vitest run providers/__tests__/zai.spec.ts shared/__tests__/api.spec.ts core/config/__tests__/ProviderSettingsManager.spec.ts`
- `cd webview-ui && npx vitest run src/components/settings/__tests__/ThinkingBudget.spec.tsx`

## §4 Production changes (make GREEN)

1. **`packages/types/src/model.ts`** — add to `modelInfoSchema`, immediately before
   `supportsReasoningBudget` (currently line 84):

```ts
// Capability flag to indicate whether the model exposes a user-configurable max output
// tokens control in settings. When set, the settings UI surfaces a slider that persists
// `modelMaxTokens`; when the user leaves it unset, the default output clamp is used.
supportsMaxTokens: z.boolean().optional(),
```

2. **`packages/types/src/providers/zai.ts`** — add `supportsMaxTokens: true,` to the
   `"glm-5.1"` entry in `internationalZAiModels` AND in `mainlandZAiModels` (place beside
   `supportsPromptCache: true,`). Two entries only.

3. **`src/shared/api.ts`** — in `getModelMaxOutputTokens`, insert BEFORE the
   `// If model has explicit maxTokens, clamp it to 20% …` block (before `if (model.maxTokens)`):

```ts
// Models that expose a configurable max-output slider (e.g. Z.ai GLM) honor the user's
// explicit override instead of the default 20% context-window clamp, capped at the model's
// own ceiling. This keeps the runtime budget consistent with the value sent to the provider.
if (model.supportsMaxTokens && settings?.modelMaxTokens != null && settings.modelMaxTokens > 0) {
	return model.maxTokens ? Math.min(settings.modelMaxTokens, model.maxTokens) : settings.modelMaxTokens
}
```

4. **`src/core/config/ProviderSettingsManager.ts`** — replace the
   `if (!supportsReasoningBudget) { delete both }` block (~line 565) with:

```ts
// modelMaxThinkingTokens only applies to reasoning budgets, but modelMaxTokens
// also caps output on models that expose a configurable max (e.g. GLM), so keep
// it whenever the model supports either feature.
const supportsMaxTokens = supportsReasoningBudget || modelInfo.supportsMaxTokens

if (!supportsReasoningBudget) {
	delete configs[name].modelMaxThinkingTokens
}

if (!supportsMaxTokens) {
	delete configs[name].modelMaxTokens
}
```

5. **`webview-ui/src/components/settings/ThinkingBudget.tsx`** — apply upstream's refactor
   verbatim (our file matches Zoo's baseline line-for-line):
    - import `getModelMaxOutputTokens` from `@roo/api`,
    - add `isMaxTokensConfigurable`, `defaultMaxOutputTokens`, `standaloneMaxOutputTokens`,
    - extract `renderMaxTokensSlider`, add `maxOutputTokensControl`,
    - surface it in the binary-reasoning branch, reuse the helper in the reasoning-budget
      branch, prepend it in the reasoning-effort branch, and return it in the final `else`
      (was `null`).

## §5 Gates / acceptance (binary)

- `cd src && npx vitest run providers/__tests__/zai.spec.ts shared/__tests__/api.spec.ts core/config/__tests__/ProviderSettingsManager.spec.ts` → all pass.
- `cd webview-ui && npx vitest run src/components/settings/__tests__/ThinkingBudget.spec.tsx` → all pass.
- `pnpm lint` and `pnpm check-types` (turbo, whole repo) → clean.
- No Roo/Zoo branding, no removed-feature (TTS/router/cloud) touched.

## §6 Scope cuts (YAGNI)

- Only `glm-5.1` (×2) gets the flag — do not invent a `glm-5-turbo` we don't ship.
- Do not remove or alter our existing `isZaiProvider` bypass; the new override branch
  layers on top of it.
