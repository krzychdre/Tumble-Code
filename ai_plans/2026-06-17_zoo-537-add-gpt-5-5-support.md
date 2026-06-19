# Port plan — Zoo PR #537 → `feature/zoo-537-add-gpt-5-5-support`

> **For the executor (read first).** Do the steps **in order**. Do **not**
> improvise, refactor beyond what is written, or add anything not listed
> (YAGNI). Every code block below is **already adapted to this repo** — paste it
> as-is unless a step says otherwise. If any precondition is false or a step
> doesn't behave as described, **STOP and report** — do not guess. This repo is
> **Tumble Code**: never introduce the strings "Roo" or "Zoo" in user-facing
> text. Placeholders are written as `{{like this}}` — replace every one.

---

## 0. Context (read once, write no code)

- **Upstream:** Zoo PR #537 — "feat: add gpt-5.5 support" (commit `97ee48a7f`).
- **What it does, one paragraph:** Adds the `gpt-5.5` model definition to the OpenAI native model registry (`packages/types/src/providers/openai.ts`) with associated test coverage in `src/api/providers/__tests__/openai-native.spec.ts`. The model supports 1.05M context window, image inputs, prompt caching, verbosity control, reasoning effort (including "none"), and long-context pricing tiers (flex and priority).
- **Why we want it, with evidence in OUR code:** Our `openAiNativeModels` registry at `packages/types/src/providers/openai.ts:8-591` currently lists models from gpt-5.1-codex-max through gpt-4.x and older o-series, but gpt-5.5 is missing. When users select gpt-5.5 as their API model ID, the handler would fall back to the default model or fail. This port keeps our model list in sync with upstream.
- **What we deliberately leave out (YAGNI):** Nothing — this is a straightforward model definition addition. No UI, branding, or routing changes.
- **Original author(s) — credit them.** Slava and edelauna. When you create the port commit (only if asked), include these trailers, one per line, at the end of the commit message:

    ```text
    Co-authored-by: Slava <slava.deb@gmail.com>
    Co-authored-by: edelauna <54631123+edelauna@users.noreply.github.com>
    ```

## 1. Preconditions — verify before touching anything

- [ ] Current branch is `feature/zoo-537-add-gpt-5-5-support`, created off `main`.
- [ ] These files exist (the edits below depend on them):
    - `packages/types/src/providers/openai.ts`
    - `src/api/providers/__tests__/openai-native.spec.ts`
- [ ] The code we will change still looks like this (quote it; if it differs,
      STOP — the plan is stale):

In `packages/types/src/providers/openai.ts`, lines 24-27 (the closing of gpt-5.1-codex-max and start of gpt-5.4):

```ts
			description:
				"GPT-5.1 Codex Max: Our most intelligent coding model optimized for long-horizon, agentic coding tasks",
	},
	"gpt-5.4": {
```

In `src/api/providers/__tests__/openai-native.spec.ts`, around line 264-267 (after the gpt-5.4 getModel test, before gpt-5.4-mini):

```ts
			expect(modelInfo.info.reasoningEffort).toBe("none")
		})

		it("should return GPT-5.4 Mini model info when selected", () => {
```

## 2. Write the failing test FIRST (TDD)

- **File:** `src/api/providers/__tests__/openai-native.spec.ts` (existing).
- Add two tests: one for `getModel` (model info) and one for streaming (Responses API).

### Test 2A — getModel for gpt-5.5

Insert after line 265 (after the gpt-5.4 getModel test closing `})`):

```ts
it("should return GPT-5.5 model info when selected", () => {
	const gpt55Handler = new OpenAiNativeHandler({
		...mockOptions,
		apiModelId: "gpt-5.5",
	})

	const modelInfo = gpt55Handler.getModel()
	expect(modelInfo.id).toBe("gpt-5.5")
	expect(modelInfo.info.maxTokens).toBe(128000)
	expect(modelInfo.info.contextWindow).toBe(1_050_000)
	expect(modelInfo.info.supportsVerbosity).toBe(true)
	expect(modelInfo.info.supportsReasoningEffort).toEqual(["none", "low", "medium", "high", "xhigh"])
	expect(modelInfo.info.reasoningEffort).toBe("medium")
})
```

### Test 2B — Responses API streaming for gpt-5.5

Insert in the "GPT-5 models" describe block, after the gpt-5.4 streaming test (after its closing `})`):

```ts
it("should handle GPT-5.5 model with Responses API", async () => {
	const mockFetch = vitest.fn().mockResolvedValue({
		ok: true,
		body: new ReadableStream({
			start(controller) {
				controller.enqueue(
					new TextEncoder().encode(
						'data: {"type":"response.output_item.added","item":{"type":"text","text":"GPT-5.5 reply"}}\n\n',
					),
				)
				controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"))
				controller.close()
			},
		}),
	})
	global.fetch = mockFetch as any

	mockResponsesCreate.mockRejectedValue(new Error("SDK not available"))

	handler = new OpenAiNativeHandler({
		...mockOptions,
		apiModelId: "gpt-5.5",
	})

	const stream = handler.createMessage(systemPrompt, messages)
	const chunks: any[] = []
	for await (const chunk of stream) {
		chunks.push(chunk)
	}

	expect(mockFetch).toHaveBeenCalledWith(
		"https://api.openai.com/v1/responses",
		expect.objectContaining({
			body: expect.any(String),
		}),
	)
	const body = (mockFetch.mock.calls[0][1] as any).body as string
	const parsedBody = JSON.parse(body)
	expect(parsedBody.model).toBe("gpt-5.5")
	expect(parsedBody.max_output_tokens).toBe(128000)
	expect(parsedBody.temperature).toBeUndefined()
	expect(parsedBody.include).toEqual(["reasoning.encrypted_content"])
	expect(parsedBody.reasoning?.effort).toBe("medium")
	expect(parsedBody.text?.verbosity).toBe("medium")

	const textChunks = chunks.filter((chunk) => chunk.type === "text")
	expect(textChunks).toHaveLength(1)
	expect(textChunks[0].text).toBe("GPT-5.5 reply")
})
```

- **Run:** `cd src && npx vitest run api/providers/__tests__/openai-native.spec.ts`
- **Expect it to FAIL** because `"gpt-5.5"` is not a key in `openAiNativeModels`, so `getModel()` will return the default model or an undefined info, causing assertion failures.
- If it **passes already**, STOP — the model is likely already present; report back.

## 3. Implement — minimal change to make the test pass

### Edit 1 — `packages/types/src/providers/openai.ts`

Replace (lines 24-27):

```ts
			description:
				"GPT-5.1 Codex Max: Our most intelligent coding model optimized for long-horizon, agentic coding tasks",
	},
	"gpt-5.4": {
```

With:

```ts
			description:
				"GPT-5.1 Codex Max: Our most intelligent coding model optimized for long-horizon, agentic coding tasks",
	},
	"gpt-5.5": {
		maxTokens: 128000,
		contextWindow: 1_050_000,
		includedTools: ["apply_patch"],
		excludedTools: ["apply_diff", "write_to_file"],
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoningEffort: ["none", "low", "medium", "high", "xhigh"],
		reasoningEffort: "medium",
		inputPrice: 5.0,
		outputPrice: 30.0,
		cacheReadsPrice: 0.5,
		longContextPricing: {
			thresholdTokens: 272_000,
			inputPriceMultiplier: 2,
			outputPriceMultiplier: 1.5,
			appliesToServiceTiers: ["default", "flex"],
		},
		supportsVerbosity: true,
		supportsTemperature: false,
		tiers: [
			{ name: "flex", contextWindow: 1_050_000, inputPrice: 2.5, outputPrice: 15.0, cacheReadsPrice: 0.25 },
			{ name: "priority", contextWindow: 1_050_000, inputPrice: 12.5, outputPrice: 75.0, cacheReadsPrice: 1.25 },
		],
		description: "GPT-5.5: A new class of intelligence for coding and professional work",
	},
	"gpt-5.4": {
```

## 4. Out of scope — do NOT do these

- Do **not** re-add or re-wire: **TTS**, the **router / cloud provider**, **cloud upsell** UI, or **Roo/Zoo branding** — all removed from this fork on purpose.
- Do **not** rename internal ids (those stay `Roo-Code`); only user-facing strings are "Tumble".
- Do **not** change the default model ID or touch any other model definitions.

## 5. Verify — paste real output, don't claim success without it

- `cd src && npx vitest run api/providers/__tests__/openai-native.spec.ts` → all tests pass.
- `pnpm --filter @roo-code/types check-types` (or equivalent) → clean.
- `cd src && npx tsc --noEmit -p tsconfig.json` (or equivalent) → clean.

## 6. Acceptance criteria (binary — all must hold)

- [ ] The §2 tests pass; the surrounding suite is green.
- [ ] Only `packages/types/src/providers/openai.ts` and `src/api/providers/__tests__/openai-native.spec.ts` changed (`git status` confirms).
- [ ] No new "Roo" or "Zoo" user-facing strings introduced.
- [ ] No removed feature (TTS / router / cloud) was reintroduced.

## 7. Record in the ledger

The SKILL's `port` stage (step 3) already records this PR as `ported` once the
plan file exists. If — and only if — that has not been done yet, run it now
(re-running is a harmless idempotent upsert, so when in doubt run it once):

```bash
node .claude/skills/zoo-port/scripts/zoo-prs.mjs record \
  --pr 537 --status ported \
  --branch feature/zoo-537-add-gpt-5-5-support \
  --plan ai_plans/2026-06-17_zoo-537-add-gpt-5-5-support.md
```

When you commit (only if asked), append the `Co-authored-by:` trailer(s) from §0
to the commit message. Then summarize what landed and let the user review.
