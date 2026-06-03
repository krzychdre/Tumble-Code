# Port plan — Zoo PR #49 → `feature/zoo-49-anthropic-opus-4-7`

> **For the executor (read first).** Do the steps **in order**. Do **not**
> improvise, refactor beyond what is written, or add anything not listed
> (YAGNI). Every code block below is **already adapted to this repo** — paste it
> as-is unless a step says otherwise. If any precondition is false or a step
> doesn't behave as described, **STOP and report** — do not guess. This repo is
> **Tumble Code**: never introduce the strings "Roo" or "Zoo" in user-facing
> text. (Internal symbol names like `RooCodeEventName` stay as-is — they are
> internal ids, not user-facing.)

---

## 0. Context (read once, write no code)

- **Upstream:** Zoo PR #49 — "[Fix] Claude Opus 4.7 is missing from the Anthropic
  provider" (merge commit `5eb7d6fec`).
- **What it does, one paragraph:** Registers the `claude-opus-4-7` model on the
  **Anthropic** provider (it was already on Vertex). It adds the model definition
  to the Anthropic model registry, wires the id into the two model-id `switch`
  statements in the Anthropic handler that gate prompt-cache `cache_control` and
  the `prompt-caching-2024-07-31` beta header, and adds a generic guard so that
  any Anthropic-format model whose `supportsTemperature` is `false` has its
  `temperature` omitted from the request. opus-4-7 has a **native 1M context
  window**, so — unlike Sonnet 4.x / Opus 4.6 — it does **not** use the
  `context-1m-2025-08-07` beta flag.
- **Why we want it, with evidence in OUR code:**
    - Our Anthropic registry stops at opus-4-6: [packages/types/src/providers/anthropic.ts:73](../packages/types/src/providers/anthropic.ts#L73)
      has `"claude-opus-4-6"` then jumps to `"claude-opus-4-5-20251101"`
      ([:94](../packages/types/src/providers/anthropic.ts#L94)). No `claude-opus-4-7`
      key exists, so selecting it on the Anthropic provider falls back to the default
      model.
    - The Anthropic handler's two `switch (modelId)` blocks list opus-4-6 but not
      opus-4-7: [src/api/providers/anthropic.ts:87](../src/api/providers/anthropic.ts#L87)
      and [:153](../src/api/providers/anthropic.ts#L153). Without the case, opus-4-7
      would fall to the `default:` branch ([:183](../src/api/providers/anthropic.ts#L183))
      and lose prompt-cache `cache_control` + the prompt-caching beta header.
    - The model-params Anthropic branch has **no** `supportsTemperature` guard:
      [src/api/transform/model-params.ts:150-155](../src/api/transform/model-params.ts#L150-L155)
      returns params unchanged. opus-4-7 rejects `temperature`, so we must omit it.
    - Our Vertex opus-4-7 (added separately from upstream Roo #12135) is missing the
      flag: [packages/types/src/providers/vertex.ts:377-397](../packages/types/src/providers/vertex.ts#L377-L397)
      has `supportsReasoningBudget: true` but no `supportsTemperature: false`.
- **What we deliberately leave out (YAGNI):**
    - The entire `apps/vscode-e2e/` change set (AGENTS.md docs, `fixtures/.gitignore`,
      `fixtures/claude-opus-4-7.json`, `runTest.ts` aimock anthropic wiring,
      `suite/anthropic-opus-4-7.test.ts`, `suite/index.ts`). It is e2e harness
      plumbing tied to aimock record/replay; the unit tests in §2 give us the same
      correctness guarantee at far lower risk.
    - **Bedrock.** Zoo #49 did **not** touch `bedrock.ts`; opus-4-7/4-8 on Bedrock is
      a later PR (#386) and will be ported in chronological order, not here.
    - `src/api/providers/fetchers/openrouter.ts:263` (an OpenRouter maxTokens
      fallback hardcoded to opus-4-6) — untouched upstream, leave it.
- **Original author(s) — credit them.** **T** `<taltas@users.noreply.github.com>`.
  When you create the port commit (only if asked), end the message with:

    ```text
    Co-authored-by: T <taltas@users.noreply.github.com>
    ```

## 1. Preconditions — verify before touching anything

- [ ] Current branch is `feature/zoo-49-anthropic-opus-4-7`, created off `main`.
- [ ] These files exist:
    - `packages/types/src/providers/anthropic.ts`
    - `packages/types/src/providers/vertex.ts`
    - `src/api/providers/anthropic.ts`
    - `src/api/transform/model-params.ts`
    - `src/api/providers/__tests__/anthropic.spec.ts`
    - `src/api/transform/__tests__/model-params.spec.ts`
- [ ] `claude-opus-4-7` is **absent** from the Anthropic registry. Run:
      `grep -n 'claude-opus-4-7' packages/types/src/providers/anthropic.ts` →
      **expect no output.** If it prints a line, STOP (already ported).
- [ ] The four edit sites still look exactly as quoted in §3. If any differs,
      STOP — the plan is stale.

## 2. Write the failing tests FIRST (TDD)

Three unit tests across two files. Add them, run, watch them fail, then implement §3.

### 2a — `src/api/transform/__tests__/model-params.spec.ts`

Insert this test **after** the `it("should prefer settings temperature over model defaultTemperature", …)` block (it ends with `expect(result.temperature).toBe(0.3)` then `})`) and **before** `it("should use model maxTokens when available", …)`:

```ts
it("should omit temperature for anthropic models that do not support it", () => {
	const result = getModelParams({
		...anthropicParams,
		settings: { modelTemperature: 0.7 },
		model: { ...baseModel, supportsTemperature: false },
		defaultTemperature: 0.5,
	})

	expect(result.temperature).toBeUndefined()
})
```

### 2b — `src/api/providers/__tests__/anthropic.spec.ts`

**Test 1** — insert **after** the `it("should include 1M context beta header for Claude Sonnet 4.6 when enabled", …)` block (it ends with `…toContain("context-1m-2025-08-07")` then `})` at line 211) and **before** the `})` that closes that `describe`:

```ts
it("should not require the 1M context beta header for Claude Opus 4.7", async () => {
	const opus47Handler = new AnthropicHandler({
		apiKey: "test-api-key",
		apiModelId: "claude-opus-4-7",
		anthropicBeta1MContext: true,
	})

	const stream = opus47Handler.createMessage(systemPrompt, [
		{
			role: "user",
			content: [{ type: "text" as const, text: "Hello" }],
		},
	])

	for await (const _chunk of stream) {
		// Consume stream
	}

	const requestBody = mockCreate.mock.calls[mockCreate.mock.calls.length - 1]?.[0]
	const requestOptions = mockCreate.mock.calls[mockCreate.mock.calls.length - 1]?.[1]
	expect(requestBody?.temperature).toBeUndefined()
	expect(requestOptions?.headers?.["anthropic-beta"]).toContain("prompt-caching-2024-07-31")
	expect(requestOptions?.headers?.["anthropic-beta"]).not.toContain("context-1m-2025-08-07")
})
```

**Test 2** — inside `describe("getModel", …)`, insert **after** the
`it("should handle Claude 4.6 Sonnet model correctly", …)` block (it ends with
`expect(model.info.supportsReasoningBudget).toBe(true)` then `})` at line 321) and
**before** `it("should enable 1M context for Claude 4.5 Sonnet when beta flag is set", …)`:

```ts
it("should handle Claude Opus 4.7 model correctly", () => {
	const handler = new AnthropicHandler({
		apiKey: "test-api-key",
		apiModelId: "claude-opus-4-7",
	})
	const model = handler.getModel()
	expect(model.id).toBe("claude-opus-4-7")
	expect(model.info.maxTokens).toBe(128000)
	expect(model.info.contextWindow).toBe(1000000)
	expect(model.info.supportsReasoningBudget).toBe(true)
	expect(model.info.supportsPromptCache).toBe(true)
})
```

- **Run:**
    - `cd src && npx vitest run api/transform/__tests__/model-params.spec.ts api/providers/__tests__/anthropic.spec.ts`
- **Expect them to FAIL:** test 2a fails because the guard isn't there yet
  (`temperature` will be `0.7`, not `undefined`); tests in 2b fail because
  `claude-opus-4-7` isn't in the registry/handler (`getModel()` falls back to the
  default model, so `model.id` ≠ `"claude-opus-4-7"` and the beta-header
  assertions don't hold).
- If they **pass already**, STOP — report back.

## 3. Implement — minimal change to make the tests pass

Make only these four edits.

### Edit 1 — `packages/types/src/providers/anthropic.ts`

Insert the new model **between** the end of the `"claude-opus-4-6"` block and the
start of `"claude-opus-4-5-20251101"`.

Replace:

```ts
	"claude-opus-4-5-20251101": {
		maxTokens: 32_000, // Overridden to 8k if `enableReasoningEffort` is false.
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 5.0, // $5 per million input tokens
```

With:

```ts
	"claude-opus-4-7": {
		maxTokens: 128_000, // Overridden to 8k if `enableReasoningEffort` is false.
		contextWindow: 1_000_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 5.0, // $5 per million input tokens
		outputPrice: 25.0, // $25 per million output tokens
		cacheWritesPrice: 6.25, // $6.25 per million tokens
		cacheReadsPrice: 0.5, // $0.50 per million tokens
		supportsReasoningBudget: true,
		supportsTemperature: false,
	},
	"claude-opus-4-5-20251101": {
		maxTokens: 32_000, // Overridden to 8k if `enableReasoningEffort` is false.
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 5.0, // $5 per million input tokens
```

### Edit 2 — `packages/types/src/providers/vertex.ts`

In the **`"claude-opus-4-7"`** block (around line 377), add `supportsTemperature: false`
directly after `supportsReasoningBudget: true,` and before the tiers comment.

Replace:

```ts
		cacheReadsPrice: 0.5, // $0.50 per million tokens
		supportsReasoningBudget: true,
		// Tiered pricing for extended context (requires beta flag 'context-1m-2025-08-07')
		tiers: [
			{
				contextWindow: 1_000_000, // 1M tokens with beta flag
				inputPrice: 10.0, // $10 per million input tokens (>200K context)
				outputPrice: 37.5, // $37.50 per million output tokens (>200K context)
				cacheWritesPrice: 12.5, // $12.50 per million tokens (>200K context)
				cacheReadsPrice: 1.0, // $1.00 per million tokens (>200K context)
			},
		],
	},
	"claude-opus-4-5@20251101": {
```

With:

```ts
		cacheReadsPrice: 0.5, // $0.50 per million tokens
		supportsReasoningBudget: true,
		supportsTemperature: false,
		// Tiered pricing for extended context (requires beta flag 'context-1m-2025-08-07')
		tiers: [
			{
				contextWindow: 1_000_000, // 1M tokens with beta flag
				inputPrice: 10.0, // $10 per million input tokens (>200K context)
				outputPrice: 37.5, // $37.50 per million output tokens (>200K context)
				cacheWritesPrice: 12.5, // $12.50 per million tokens (>200K context)
				cacheReadsPrice: 1.0, // $1.00 per million tokens (>200K context)
			},
		],
	},
	"claude-opus-4-5@20251101": {
```

> NOTE: there are several `supportsReasoningBudget: true,` lines in this file. The
> unique anchor is the one immediately followed by the tiers block whose
> `inputPrice: 10.0` — that is the opus-4-7 entry. Match the whole quoted block so
> you edit the right one.

### Edit 3 — `src/api/providers/anthropic.ts`

Two `case "claude-opus-4-6":` lines need `case "claude-opus-4-7":` added right
after them. **Do NOT** add opus-4-7 to the two `… || modelId === "claude-opus-4-6") &&`
/ `… || id === "claude-opus-4-6") &&` beta-1M `if` conditions (lines ~72 and ~345)
— opus-4-7 has native 1M context and must not push the `context-1m-2025-08-07`
flag.

**Edit 3a** — the outer cache-control switch (around line 84). Replace:

```ts
			case "claude-sonnet-4-6":
			case "claude-sonnet-4-5":
			case "claude-sonnet-4-20250514":
			case "claude-opus-4-6":
			case "claude-opus-4-5-20251101":
			case "claude-opus-4-1-20250805":
			case "claude-opus-4-20250514":
			case "claude-3-7-sonnet-20250219":
			case "claude-3-5-sonnet-20241022":
			case "claude-3-5-haiku-20241022":
			case "claude-3-opus-20240229":
			case "claude-haiku-4-5-20251001":
			case "claude-3-haiku-20240307": {
```

With:

```ts
			case "claude-sonnet-4-6":
			case "claude-sonnet-4-5":
			case "claude-sonnet-4-20250514":
			case "claude-opus-4-6":
			case "claude-opus-4-7":
			case "claude-opus-4-5-20251101":
			case "claude-opus-4-1-20250805":
			case "claude-opus-4-20250514":
			case "claude-3-7-sonnet-20250219":
			case "claude-3-5-sonnet-20241022":
			case "claude-3-5-haiku-20241022":
			case "claude-3-opus-20240229":
			case "claude-haiku-4-5-20251001":
			case "claude-3-haiku-20240307": {
```

**Edit 3b** — the inner prompt-caching-beta switch (around line 150). Replace:

```ts
								case "claude-sonnet-4-6":
								case "claude-sonnet-4-5":
								case "claude-sonnet-4-20250514":
								case "claude-opus-4-6":
								case "claude-opus-4-5-20251101":
								case "claude-opus-4-1-20250805":
								case "claude-opus-4-20250514":
								case "claude-3-7-sonnet-20250219":
								case "claude-3-5-sonnet-20241022":
								case "claude-3-5-haiku-20241022":
								case "claude-3-opus-20240229":
								case "claude-haiku-4-5-20251001":
								case "claude-3-haiku-20240307":
									betas.push("prompt-caching-2024-07-31")
```

With:

```ts
								case "claude-sonnet-4-6":
								case "claude-sonnet-4-5":
								case "claude-sonnet-4-20250514":
								case "claude-opus-4-6":
								case "claude-opus-4-7":
								case "claude-opus-4-5-20251101":
								case "claude-opus-4-1-20250805":
								case "claude-opus-4-20250514":
								case "claude-3-7-sonnet-20250219":
								case "claude-3-5-sonnet-20241022":
								case "claude-3-5-haiku-20241022":
								case "claude-3-opus-20240229":
								case "claude-haiku-4-5-20251001":
								case "claude-3-haiku-20240307":
									betas.push("prompt-caching-2024-07-31")
```

### Edit 4 — `src/api/transform/model-params.ts`

Add the `supportsTemperature` guard at the top of the `format === "anthropic"`
branch (around line 150).

Replace:

```ts
	if (format === "anthropic") {
		return {
			format,
			...params,
			reasoning: getAnthropicReasoning({ model, reasoningBudget, reasoningEffort, settings }),
		}
	} else if (format === "openai") {
```

With:

```ts
	if (format === "anthropic") {
		if (model.supportsTemperature === false) {
			params.temperature = undefined
		}

		return {
			format,
			...params,
			reasoning: getAnthropicReasoning({ model, reasoningBudget, reasoningEffort, settings }),
		}
	} else if (format === "openai") {
```

## 4. Out of scope — do NOT do these

- The whole `apps/vscode-e2e/` change set from upstream (docs, fixtures, aimock
  wiring, the opus-4-7 e2e suite, `suite/index.ts`).
- Any `bedrock.ts` edit (that's #386, ported later in chronological order).
- The `openrouter.ts` opus-4-6 maxTokens fallback.
- Do **not** add opus-4-7 to the two `anthropicBeta1MContext` `if` conditions.
- Do **not** re-add or re-wire: **TTS**, the **router / cloud provider**, **cloud
  upsell** UI, or **Roo/Zoo** user-facing branding.
- Do **not** rename internal ids (those stay `Roo-Code`).

## 5. Verify — paste real output, don't claim success without it

- `cd src && npx vitest run api/transform/__tests__/model-params.spec.ts api/providers/__tests__/anthropic.spec.ts`
  → the three new tests pass and the rest of both suites stay green.
- `cd packages/types && npx tsc --noEmit` → clean (new model key typechecks).
- `cd src && npx tsc --noEmit` → clean.
- `grep -rn 'claude-opus-4-7' src/api/providers/anthropic.ts packages/types/src/providers/anthropic.ts`
  → shows the new case + model key (sanity that the edits landed).

## 6. Acceptance criteria (binary — all must hold)

- [ ] The three §2 tests pass; both touched suites are green.
- [ ] Only these files changed: `packages/types/src/providers/anthropic.ts`,
      `packages/types/src/providers/vertex.ts`, `src/api/providers/anthropic.ts`,
      `src/api/transform/model-params.ts`, `src/api/providers/__tests__/anthropic.spec.ts`,
      `src/api/transform/__tests__/model-params.spec.ts` (`git status` confirms).
- [ ] `claude-opus-4-7` is NOT present in the two beta-1M `if` conditions in
      `src/api/providers/anthropic.ts`.
- [ ] No new "Roo"/"Zoo" user-facing strings; no removed feature reintroduced.

## 7. Record in the ledger (after acceptance)

```bash
node .claude/skills/zoo-port/scripts/zoo-prs.mjs record \
  --pr 49 --status ported \
  --branch feature/zoo-49-anthropic-opus-4-7 \
  --plan ai_plans/2026-05-31_zoo-49-anthropic-opus-4-7.md
```

When you commit (only if asked), append the `Co-authored-by:` trailer from §0.
Then summarize what landed and let the user review.
