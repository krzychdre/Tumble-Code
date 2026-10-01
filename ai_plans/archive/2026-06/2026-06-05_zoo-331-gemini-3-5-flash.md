# Port Zoo PR #331 — Gemini 3.5 Flash support

- **Zoo PR:** #331 — `feat(gemini): Gemini 3.5 Flash Support`
- **Zoo commit:** `905b84015`
- **Merged:** 2026-06-03
- **Our branch:** `feature/zoo-331-gemini-3-5-flash` (off `main`)
- **Category:** provider/model · Size **S** · Risk **low**

## 0. Credit (carry into the commit)

Original authors: **Jean Bispo, edelauna**. The commit message MUST end with:

```
Co-authored-by: Jean Bispo <1jeanbispo@gmail.com>
Co-authored-by: edelauna <54631123+edelauna@users.noreply.github.com>
```

## 1. Goal (one sentence)

Register the `gemini-3.5-flash` model in both the Gemini and Vertex model maps so
users can select it, with its verified pricing/capabilities, and keep the
existing "unknown model id" test valid.

## 2. Why this is wanted / vs. our current code

- `packages/types/src/providers/gemini.ts` currently has `gemini-3.1-pro-preview`
  (default), `-customtools`, `gemini-3-pro-preview`, `gemini-3-flash-preview`,
  and the 2.5 family — but **no `gemini-3.5-flash`**.
- `packages/types/src/providers/vertex.ts` mirrors the same gap.
- No clash with our divergence: model-map entries carry no Roo/Tumble branding,
  no TTS/router/cloud coupling. Pure additive data.

## 3. Scope cuts (YAGNI)

- **Only** the two model-map entries + the one test rename. Nothing else in the
  upstream PR touches anything else.
- Do **NOT** change `geminiDefaultModelId` / `vertexDefaultModelId` — the default
  stays `gemini-3.1-pro-preview` / `claude-sonnet-4-5@20250929`.
- Do **NOT** add `supportsTemperature` / `defaultTemperature` or any field the
  upstream author did not include. Port the verified entry verbatim — do not
  invent capability flags (no asserting unverified model behavior).
- No i18n, no settings-UI, no provider-handler changes — none are required; the
  model maps drive the dropdowns automatically.

## 4. Removed-feature landmines

- None. Do **NOT** re-add Roo/Tumble branding, TTS, router, or cloud upsell —
  this PR touches none of them.

## 5. TDD — red first

### 5a. Add the failing test (proves the model is missing)

File: `src/api/providers/__tests__/gemini.spec.ts`.

The spec currently imports only `geminiDefaultModelId` from `@roo-code/types`
(line 15). Add `geminiModels` to that import:

**Before (line 15):**

```ts
import { type ModelInfo, geminiDefaultModelId, ApiProviderError } from "@roo-code/types"
```

**After:**

```ts
import { type ModelInfo, geminiDefaultModelId, geminiModels, ApiProviderError } from "@roo-code/types"
```

Then add this test at the end of the `describe("getModel", …)` block (right
after the `"should not treat Object prototype keys as known models"` test, which
ends around line 207 with `})`):

```ts
it("registers gemini-3.5-flash with its verified pricing and no reasoning budget (#331)", () => {
	const handler = new GeminiHandler({
		apiModelId: "gemini-3.5-flash",
		geminiApiKey: "test-key",
	})
	const { id, info } = handler.getModel()

	expect(id).toBe("gemini-3.5-flash")
	expect(geminiModels).toHaveProperty("gemini-3.5-flash")
	expect(info.contextWindow).toBe(1_048_576)
	expect(info.maxTokens).toBe(65_536)
	expect(info.supportsImages).toBe(true)
	expect(info.supportsPromptCache).toBe(true)
	expect(info.supportsReasoningBudget).toBe(false)
	expect(info.inputPrice).toBe(1.5)
	expect(info.outputPrice).toBe(9)
	expect(info.cacheReadsPrice).toBe(0.15)
	expect(info.cacheWritesPrice).toBe(1.0)
})
```

**Run:**

```bash
cd src && npx vitest run api/providers/__tests__/gemini.spec.ts -t "gemini-3.5-flash"
```

**Expect RED:** the new `#331` test fails — `id` resolves to `geminiDefaultModelId`
(unknown id falls back) and `geminiModels` has no `gemini-3.5-flash` property, so
`toHaveProperty` and the pricing assertions fail.

### 5b. Fix the now-stale "unknown id" test

The existing test at lines 177–195 uses `"gemini-3.5-flash"` as its **unknown**
model id and asserts pricing is `undefined`. Once 3.5-flash is a real entry that
premise is false, so retarget it to a still-nonexistent id (matches upstream).

**Before (lines 179 and 184):**

```ts
				apiModelId: "gemini-3.5-flash",
```

```ts
expect(modelInfo.id).toBe("gemini-3.5-flash")
```

**After:**

```ts
				apiModelId: "gemini-9.9-nonexistent",
```

```ts
expect(modelInfo.id).toBe("gemini-9.9-nonexistent")
```

(Two single-line replacements inside the `#227` test; leave its assertions intact.)

## 6. Implementation — make it green

### 6a. `packages/types/src/providers/gemini.ts`

Insert the new entry as the **first** key inside `export const geminiModels = {`
(immediately after the opening line `export const geminiModels = {`, before
`"gemini-3.1-pro-preview": {`):

```ts
	"gemini-3.5-flash": {
		maxTokens: 65_536,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoningEffort: ["minimal", "low", "medium", "high"],
		reasoningEffort: "medium",
		inputPrice: 1.5,
		outputPrice: 9,
		cacheReadsPrice: 0.15,
		cacheWritesPrice: 1.0,
		supportsReasoningBudget: false,
	},
```

### 6b. `packages/types/src/providers/vertex.ts`

Insert the **identical** entry as the first key inside
`export const vertexModels = {` (before `"gemini-3.1-pro-preview": {`):

```ts
	"gemini-3.5-flash": {
		maxTokens: 65_536,
		contextWindow: 1_048_576,
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoningEffort: ["minimal", "low", "medium", "high"],
		reasoningEffort: "medium",
		inputPrice: 1.5,
		outputPrice: 9,
		cacheReadsPrice: 0.15,
		cacheWritesPrice: 1.0,
		supportsReasoningBudget: false,
	},
```

> DRY note: the entry is intentionally identical in both files because the two
> maps are independent literal sources of truth in this codebase (vertex mirrors
> gemini for these models — see the existing `gemini-3.1-pro-preview` duplication).
> There is no shared constant to reuse; do not invent one for a single model.

## 7. Verify (binary acceptance criteria)

Run, in order, and require each to pass:

```bash
# 1. the new + retargeted tests
cd src && npx vitest run api/providers/__tests__/gemini.spec.ts
# 2. types compile (the model maps are typed against ModelInfo)
cd packages/types && npx tsc --noEmit
# 3. lint the touched files
cd /home/krzych/Projekty/QUB-IT/Roo-Code && npx eslint packages/types/src/providers/gemini.ts packages/types/src/providers/vertex.ts src/api/providers/__tests__/gemini.spec.ts
```

**Acceptance:**

- `gemini.spec.ts` suite is fully green, including the new `#331` test and the
  retargeted `#227` test.
- `tsc --noEmit` reports no errors (the new entry satisfies `ModelInfo`).
- ESLint clean on the three touched files.

## 8. Commit (only after green)

Branch `feature/zoo-331-gemini-3-5-flash`. Commit message:

```
feat(gemini): add Gemini 3.5 Flash model support

Port of Zoo-Code PR #331. Registers gemini-3.5-flash in the Gemini and
Vertex model maps with its verified pricing and no reasoning-budget support;
retargets the unknown-model-id test to a still-nonexistent id.

Co-authored-by: Jean Bispo <1jeanbispo@gmail.com>
Co-authored-by: edelauna <54631123+edelauna@users.noreply.github.com>
```

Then `git push -u origin feature/zoo-331-gemini-3-5-flash`.
