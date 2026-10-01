# Port plan — Zoo PR #160 → `feature/zoo-160-glm-output-context`

## §0 Context & credit

- **Upstream:** Zoo-Code PR #160 `[Fix] GLM models reserve too much output context by default`
  (commit `cff97db1e`, merged 2026-05-17).
- **Author:** roomote[bot] + `Co-authored-by: Roomote`. Both are bot / AI-assistant
  — **no human remains, so no `Co-authored-by:` trailer** on our commit.
- **Why this is portable (redo of an earlier wrong `skip`):** I had recorded #160
  as "already present", but that was wrong. Our fork is in the _pre-fix_ state:
  `src/shared/api.ts` still carries the `isZaiProvider` bypass and
  `src/api/providers/zai.ts` still uses `info.maxTokens` directly. The user
  marked the report `[x] PORT` — correctly.

## §1 What it does

A Z.ai bypass had been added to `getModelMaxOutputTokens` so GLM models returned
their full hand-curated `maxTokens` (e.g. glm-5.1 = 131_072 on a 200k context)
instead of the default 20%-of-context clamp. That over-reserves output budget.
#160 **removes the bypass** so GLM defaults to the 20% clamp (40_000 for glm-5.1),
and rewires `ZAiHandler` to compute `max_tokens` through `getModelMaxOutputTokens`
(which applies the clamp) rather than reading `info.maxTokens` raw.

## §1a Coexistence with our divergence (PR #76, commit f25cb4fb7)

Our fork added a configurable max-output slider for GLM (`supportsMaxTokens` +
`modelMaxTokens`). This stays intact:

- `zai.ts` keeps `this.options.modelMaxTokens || getModelMaxOutputTokens(...)`.
  When the user sets the slider, the `||` short-circuits to the slider value.
- When the slider is unset, it falls through to `getModelMaxOutputTokens`, whose
  `supportsMaxTokens` branch requires `modelMaxTokens > 0` (false here), so it
  reaches the 20% clamp → 40_000. Our #76 tests (slider = 100_000) stay green.

## §2 Scope cuts (YAGNI) / landmines

- Upstream also edited `apps/vscode-e2e/.../zai.test.ts` for `glm-5-turbo`
  (40_551). **We have no `glm-5-turbo`** — only `glm-4.5` and `glm-5.1`. Port only
  the glm-5.1 assertion update; do not invent a glm-5-turbo case.
- The e2e suite is aimock-gated and not wired into our `runTest.ts`, so it does
  not run in gates. Update its assertion for honesty only — do NOT adopt aimock
  (see [[project_zoo_aimock_family_not_ported]]).
- No TTS / router / cloud / Roo-branding involvement.

## §3 Edits (TDD: tests red first, then production)

### Step 1 — make tests expect the new behavior (RED)

**`src/shared/__tests__/api.spec.ts`** (~line 315): rename test and flip expectation

- title `"should bypass 20% cap for Z.ai provider and use exact configured max tokens"`
  → `"should still clamp Z.ai models to 20% of context window by default"`
- update the comment; `expect(result).toBe(131_072)` → `expect(result).toBe(40_000)`

**`src/api/providers/__tests__/zai.spec.ts`** (inside `describe("GLM-4.7 Thinking Mode"...)`,
before the first `it`): add

```ts
it("should cap GLM-5.1 max_tokens to 20% of context window by default", async () => {
	const handlerWithModel = new ZAiHandler({
		apiModelId: "glm-5.1",
		zaiApiKey: "test-zai-api-key",
		zaiApiLine: "international_coding",
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
	expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ model: "glm-5.1", max_tokens: 40_000 }))
})
```

Run → expect RED (current code returns 131_072):
`cd src && npx vitest run shared/__tests__/api.spec.ts api/providers/__tests__/zai.spec.ts`

### Step 2 — production change (GREEN)

**`src/shared/api.ts`** — delete the Z.ai bypass; keep only the GPT-5 exception:

```ts
if (model.maxTokens) {
	const isGpt5Model = modelId.toLowerCase().includes("gpt-5")
	// GPT-5 models bypass the 20% cap and use their full configured max tokens
	if (isGpt5Model) {
		return model.maxTokens
	}
	return Math.min(model.maxTokens, Math.ceil(model.contextWindow * 0.2))
}
```

(remove the `isZaiProvider` const and its multi-line comment block)

**`src/api/providers/zai.ts`** — import + use `getModelMaxOutputTokens`:

- import: `import { type ApiHandlerOptions, getModelMaxOutputTokens, shouldUseReasoningEffort } from "../../shared/api"`
- replace the `max_tokens` assignment:

```ts
const max_tokens =
	this.options.modelMaxTokens ||
	(getModelMaxOutputTokens({
		modelId: model,
		model: info,
		settings: this.options,
		format: "openai",
	}) ??
		undefined)
```

### Step 3 — e2e honesty update (not gated)

**`apps/vscode-e2e/src/suite/providers/zai.test.ts`** (~line 206): comment + assertion
`131_072` → `40_000` for glm-5.1 (mirror upstream wording about the restored clamp).

## §4 Verification (binary acceptance)

- Step 1 run → RED on both new/updated assertions.
- After Step 2 → those tests GREEN.
- `cd src && npx vitest run shared/__tests__/api.spec.ts api/providers/__tests__/zai.spec.ts` → all pass
  (incl. the #76 slider test still expecting 100_000).
- root `pnpm check-types` → 13/13
- `cd src && pnpm lint` → exit 0
