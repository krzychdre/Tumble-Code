# Port plan — Zoo PR #449 → `feature/zoo-449-litellm-reasoning-streaming`

> **For the executor (read first).** Do the steps **in order**. Do **not**
> improvise, refactor beyond what is written, or add anything not listed
> (YAGNI). Every code block below is **already adapted to this repo** — paste it
> as-is unless a step says otherwise. If any precondition is false or a step
> doesn't behave as described, **STOP and report** — do not guess. This repo is
> **Tumble Code**: never introduce the strings "Roo" or "Zoo" in user-facing
> text.

---

## 0. Context (read once, write no code)

- **Upstream:** Zoo PR #449 — "feat(litellm): handle reasoning_content and reasoning fields in streaming" (commit `c4531d45b`).
- **What it does, one paragraph:** `LiteLLMHandler.createMessage` never reads the
  `reasoning_content` / `reasoning` fields from the streaming delta, so reasoning
  output from DeepSeek-R1, QwQ, and other reasoning models routed through LiteLLM
  is silently dropped. This PR (a) extracts the reasoning-field logic into a
  shared `extractReasoningFromDelta` helper, (b) wires it into `lite-llm.ts`, and
  (c) replaces the existing inline `for-of/break` block in
  `base-openai-compatible-provider.ts` with the same helper. The helper also fixes
  two bugs in the old inline logic: (1) the old `for…break` short-circuited the
  moment the `reasoning_content` KEY existed, so a delta with
  `reasoning_content: null` + a populated `reasoning` field dropped the thinking
  output instead of falling back; (2) the old `.trim()` guard discarded
  whitespace-only chunks (a lone `" "` or `"\n\n"`), collapsing word/paragraph
  boundaries once chunks are concatenated downstream. The helper picks the first
  field that is a **non-empty string** (length-based, not trim-based).
- **Why we want it, with evidence in OUR code:** [lite-llm.ts:230-242](src/api/providers/lite-llm.ts#L230-L242)
  — our `createMessage` loop yields `delta.content` and `delta.tool_calls` but has
  no branch for `reasoning_content` / `reasoning`, so reasoning is dropped today.
  And [base-openai-compatible-provider.ts:151-161](src/api/providers/base-openai-compatible-provider.ts#L151-L161)
  still has the exact old `for (const key of ["reasoning_content","reasoning"])`
  block with both bugs.
- **What we deliberately leave out (YAGNI):** nothing — all 6 files port directly;
  our before-state matches upstream's before-state exactly.
- **Original author(s) — credit them.** Oh Daewoong (commit author `daewoong` =
  GitHub `daewoongoh`, same person). When you create the port commit, include this
  trailer at the end of the commit message (drop the `Claude Opus 4.7` AI-assistant
  trailer per fork policy):

    ```text
    Co-authored-by: Oh Daewoong <dw.oh@samsung.com>
    ```

## 1. Preconditions — verify before touching anything

- [ ] Current branch is `feature/zoo-449-litellm-reasoning-streaming`, created off `main`.
- [ ] These files exist:
    - `src/api/providers/lite-llm.ts`
    - `src/api/providers/base-openai-compatible-provider.ts`
    - `src/api/providers/__tests__/lite-llm.spec.ts`
    - `src/api/providers/__tests__/base-openai-compatible-provider.spec.ts`
- [ ] These files do NOT yet exist (you will create them):
    - `src/api/providers/utils/extract-reasoning.ts`
    - `src/api/providers/utils/__tests__/extract-reasoning.spec.ts`
- [ ] In `base-openai-compatible-provider.ts` the reasoning block still looks
      EXACTLY like this (if it differs, STOP — the plan is stale):

```ts
			if (delta) {
				for (const key of ["reasoning_content", "reasoning"] as const) {
					if (key in delta) {
						const reasoning_content = ((delta as any)[key] as string | undefined) || ""
						if (reasoning_content?.trim()) {
							yield { type: "reasoning", text: reasoning_content }
						}
						break
					}
				}
			}
```

## 2. Write the failing test FIRST (TDD)

- **File:** `src/api/providers/utils/__tests__/extract-reasoning.spec.ts` (create it).
- Add exactly this test:

```ts
// npx vitest run api/providers/utils/__tests__/extract-reasoning.spec.ts

import { extractReasoningFromDelta } from "../extract-reasoning"

describe("extractReasoningFromDelta", () => {
	it("returns reasoning_content when present and non-blank", () => {
		expect(extractReasoningFromDelta({ reasoning_content: "thinking..." })).toBe("thinking...")
	})

	it("returns reasoning when reasoning_content is missing", () => {
		expect(extractReasoningFromDelta({ reasoning: "analyzing" })).toBe("analyzing")
	})

	it("prefers reasoning_content over reasoning when both are non-blank", () => {
		expect(
			extractReasoningFromDelta({
				reasoning_content: "from_content",
				reasoning: "from_reasoning",
			}),
		).toBe("from_content")
	})

	it("falls back to reasoning when reasoning_content is null on the same delta", () => {
		expect(
			extractReasoningFromDelta({
				reasoning_content: null,
				reasoning: "fallback",
			}),
		).toBe("fallback")
	})

	it("falls back to reasoning when reasoning_content is empty string", () => {
		expect(
			extractReasoningFromDelta({
				reasoning_content: "",
				reasoning: "fallback",
			}),
		).toBe("fallback")
	})

	it("preserves whitespace-only payloads so streamed chunks keep word and paragraph boundaries", () => {
		expect(extractReasoningFromDelta({ reasoning_content: " " })).toBe(" ")
		expect(extractReasoningFromDelta({ reasoning: "\n\n" })).toBe("\n\n")
	})

	it("falls back to reasoning when reasoning_content is an empty string but does not skip whitespace", () => {
		expect(
			extractReasoningFromDelta({
				reasoning_content: "",
				reasoning: "\n\n",
			}),
		).toBe("\n\n")
	})

	it("returns undefined when neither field is present", () => {
		expect(extractReasoningFromDelta({ content: "hi" })).toBeUndefined()
	})

	it("returns undefined for nullish input", () => {
		expect(extractReasoningFromDelta(null)).toBeUndefined()
		expect(extractReasoningFromDelta(undefined)).toBeUndefined()
	})
})
```

- **Run:** `cd src && npx vitest run api/providers/utils/__tests__/extract-reasoning.spec.ts`
- **Expect it to FAIL** with a module-not-found / import error (the helper file
  `../extract-reasoning` does not exist yet).

## 3. Implement — minimal change to make the test pass

Make only these edits. Each is explicit; do not touch anything else.

### Edit 1 — CREATE `src/api/providers/utils/extract-reasoning.ts`

Full contents of the new file:

```ts
/**
 * Extracts reasoning text from a streaming delta object.
 *
 * Prefers `reasoning_content` (DeepSeek-R1 / QwQ style) and falls back to
 * `reasoning` (OpenRouter style). Whitespace-only payloads (e.g. a lone " "
 * or "\n\n" between paragraphs) are preserved so streamed reasoning keeps
 * word and paragraph boundaries once chunks are concatenated downstream.
 *
 * The fallback only fires when the current field is missing, non-string,
 * or an empty string — a delta with `reasoning_content: null` and a
 * populated `reasoning` still resolves to the populated field.
 */
export function extractReasoningFromDelta(delta: unknown): string | undefined {
	if (!delta) return undefined

	const d = delta as { reasoning_content?: unknown; reasoning?: unknown }

	if (typeof d.reasoning_content === "string" && d.reasoning_content.length > 0) {
		return d.reasoning_content
	}
	if (typeof d.reasoning === "string" && d.reasoning.length > 0) {
		return d.reasoning
	}
	return undefined
}
```

Now re-run the §2 test — it must PASS (9 tests green).

### Edit 2 — `src/api/providers/lite-llm.ts`

After the import of `RouterProvider`, add the helper import. Replace:

```ts
import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { RouterProvider } from "./router-provider"
```

With:

```ts
import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { RouterProvider } from "./router-provider"
import { extractReasoningFromDelta } from "./utils/extract-reasoning"
```

Then, inside the `for await (const chunk of completion)` streaming loop, add a
reasoning branch right after the `delta?.content` block. Replace:

```ts
				if (delta?.content) {
					yield { type: "text", text: delta.content }
				}

				// Handle tool calls in stream - emit partial chunks for NativeToolCallParser
				if (delta?.tool_calls) {
```

With:

```ts
				if (delta?.content) {
					yield { type: "text", text: delta.content }
				}

				const reasoningText = extractReasoningFromDelta(delta)
				if (reasoningText) {
					yield { type: "reasoning", text: reasoningText }
				}

				// Handle tool calls in stream - emit partial chunks for NativeToolCallParser
				if (delta?.tool_calls) {
```

### Edit 3 — `src/api/providers/base-openai-compatible-provider.ts`

Add the helper import. Replace:

```ts
import { getApiRequestTimeout } from "./utils/timeout-config"
```

With:

```ts
import { getApiRequestTimeout } from "./utils/timeout-config"
import { extractReasoningFromDelta } from "./utils/extract-reasoning"
```

Then replace the inline reasoning block (quoted in §1) entirely. Replace:

```ts
			if (delta) {
				for (const key of ["reasoning_content", "reasoning"] as const) {
					if (key in delta) {
						const reasoning_content = ((delta as any)[key] as string | undefined) || ""
						if (reasoning_content?.trim()) {
							yield { type: "reasoning", text: reasoning_content }
						}
						break
					}
				}
			}
```

With:

```ts
			const reasoningText = extractReasoningFromDelta(delta)
			if (reasoningText) {
				yield { type: "reasoning", text: reasoningText }
			}
```

### Edit 4 — `src/api/providers/__tests__/lite-llm.spec.ts`

Insert a new `describe("reasoning field handling", …)` block **immediately
before** the existing `describe("tool ID normalization", …)` block (it currently
starts at roughly line 722). Find this line:

```ts
	describe("tool ID normalization", () => {
```

Insert the following block right before it (keep the existing `tool ID
normalization` describe intact after it):

```ts
describe("reasoning field handling", () => {
	it("should yield reasoning chunks from reasoning_content delta", async () => {
		const mockStream = {
			async *[Symbol.asyncIterator]() {
				yield {
					choices: [{ delta: { reasoning_content: "Let me think..." } }],
					usage: null,
				}
				yield {
					choices: [{ delta: { content: "The answer is 42." } }],
					usage: { prompt_tokens: 20, completion_tokens: 10 },
				}
			},
		}

		mockCreate.mockReturnValue({
			withResponse: vi.fn().mockResolvedValue({ data: mockStream }),
		})

		const generator = handler.createMessage("system", [{ role: "user", content: "What is the answer?" }])
		const results = []
		for await (const chunk of generator) {
			results.push(chunk)
		}

		const reasoningChunk = results.find((c) => c.type === "reasoning")
		expect(reasoningChunk).toBeDefined()
		expect(reasoningChunk).toMatchObject({ type: "reasoning", text: "Let me think..." })

		const textChunk = results.find((c) => c.type === "text")
		expect(textChunk).toMatchObject({ type: "text", text: "The answer is 42." })
	})

	it("should yield reasoning chunks from reasoning delta field", async () => {
		const mockStream = {
			async *[Symbol.asyncIterator]() {
				yield {
					choices: [{ delta: { reasoning: "Analyzing the problem..." } }],
					usage: null,
				}
				yield {
					choices: [{ delta: { content: "Done." } }],
					usage: { prompt_tokens: 10, completion_tokens: 5 },
				}
			},
		}

		mockCreate.mockReturnValue({
			withResponse: vi.fn().mockResolvedValue({ data: mockStream }),
		})

		const generator = handler.createMessage("system", [{ role: "user", content: "Solve this." }])
		const results = []
		for await (const chunk of generator) {
			results.push(chunk)
		}

		const reasoningChunk = results.find((c) => c.type === "reasoning")
		expect(reasoningChunk).toBeDefined()
		expect(reasoningChunk).toMatchObject({ type: "reasoning", text: "Analyzing the problem..." })
	})

	it("should prefer reasoning_content over reasoning when both are present", async () => {
		const mockStream = {
			async *[Symbol.asyncIterator]() {
				yield {
					choices: [{ delta: { reasoning_content: "from_reasoning_content", reasoning: "from_reasoning" } }],
					usage: { prompt_tokens: 5, completion_tokens: 5 },
				}
			},
		}

		mockCreate.mockReturnValue({
			withResponse: vi.fn().mockResolvedValue({ data: mockStream }),
		})

		const generator = handler.createMessage("system", [{ role: "user", content: "Test." }])
		const results = []
		for await (const chunk of generator) {
			results.push(chunk)
		}

		const reasoningChunks = results.filter((c) => c.type === "reasoning")
		expect(reasoningChunks).toHaveLength(1)
		expect(reasoningChunks[0]).toMatchObject({ type: "reasoning", text: "from_reasoning_content" })
	})

	it("should not yield reasoning chunk when reasoning field is present but falsy", async () => {
		const mockStream = {
			async *[Symbol.asyncIterator]() {
				yield {
					choices: [{ delta: { reasoning_content: undefined } }],
					usage: null,
				}
				yield {
					choices: [{ delta: { reasoning: "" } }],
					usage: null,
				}
				yield {
					choices: [{ delta: { content: "Hello" } }],
					usage: { prompt_tokens: 5, completion_tokens: 5 },
				}
			},
		}

		mockCreate.mockReturnValue({
			withResponse: vi.fn().mockResolvedValue({ data: mockStream }),
		})

		const generator = handler.createMessage("system", [{ role: "user", content: "Hi" }])
		const results = []
		for await (const chunk of generator) {
			results.push(chunk)
		}

		const reasoningChunks = results.filter((c) => c.type === "reasoning")
		expect(reasoningChunks).toHaveLength(0)
	})

	it("should preserve whitespace-only reasoning chunks so streamed boundaries survive concatenation", async () => {
		const mockStream = {
			async *[Symbol.asyncIterator]() {
				yield {
					choices: [{ delta: { reasoning_content: "Let's" } }],
					usage: null,
				}
				yield {
					choices: [{ delta: { reasoning_content: " " } }],
					usage: null,
				}
				yield {
					choices: [{ delta: { reasoning_content: "think" } }],
					usage: null,
				}
				yield {
					choices: [{ delta: { reasoning_content: "\n\n" } }],
					usage: null,
				}
				yield {
					choices: [{ delta: { reasoning_content: "next" } }],
					usage: null,
				}
				yield {
					choices: [{ delta: { content: "Hello" } }],
					usage: { prompt_tokens: 5, completion_tokens: 5 },
				}
			},
		}

		mockCreate.mockReturnValue({
			withResponse: vi.fn().mockResolvedValue({ data: mockStream }),
		})

		const generator = handler.createMessage("system", [{ role: "user", content: "Hi" }])
		const results = []
		for await (const chunk of generator) {
			results.push(chunk)
		}

		const reasoningChunks = results.filter((c) => c.type === "reasoning")
		expect(reasoningChunks.map((c) => (c as { text: string }).text).join("")).toBe("Let's think\n\nnext")
	})

	it("should fall back to reasoning when reasoning_content is null on the same delta", async () => {
		const mockStream = {
			async *[Symbol.asyncIterator]() {
				yield {
					choices: [{ delta: { reasoning_content: null, reasoning: "fallback thinking" } }],
					usage: null,
				}
				yield {
					choices: [{ delta: { content: "Answer." } }],
					usage: { prompt_tokens: 5, completion_tokens: 5 },
				}
			},
		}

		mockCreate.mockReturnValue({
			withResponse: vi.fn().mockResolvedValue({ data: mockStream }),
		})

		const generator = handler.createMessage("system", [{ role: "user", content: "Test." }])
		const results = []
		for await (const chunk of generator) {
			results.push(chunk)
		}

		const reasoningChunks = results.filter((c) => c.type === "reasoning")
		expect(reasoningChunks).toHaveLength(1)
		expect(reasoningChunks[0]).toMatchObject({ type: "reasoning", text: "fallback thinking" })
	})
})
```

### Edit 5 — `src/api/providers/__tests__/base-openai-compatible-provider.spec.ts`

Two existing tests change because whitespace-only reasoning is now preserved.

**5a.** Replace this test title line:

```ts
		it("should filter out whitespace-only reasoning_content", async () => {
```

With:

```ts
		it("should preserve whitespace-only reasoning_content so streamed boundaries survive concatenation", async () => {
```

**5b.** In that same test, replace the assertion block:

```ts
// Should only have the regular content, not the whitespace-only reasoning
expect(chunks).toEqual([{ type: "text", text: "Regular content" }])
```

With:

```ts
expect(chunks).toEqual([
	{ type: "reasoning", text: "\n" },
	{ type: "reasoning", text: "   " },
	{ type: "reasoning", text: "\t\n  " },
	{ type: "text", text: "Regular content" },
])
```

**5c.** In the `"should yield non-empty reasoning_content"` test, replace the
assertion block:

```ts
// Should only yield the non-empty reasoning content
expect(chunks).toEqual([
	{ type: "reasoning", text: "Thinking step 1" },
	{ type: "reasoning", text: "Thinking step 2" },
])
```

With:

```ts
expect(chunks).toEqual([
	{ type: "reasoning", text: "Thinking step 1" },
	{ type: "reasoning", text: "\n" },
	{ type: "reasoning", text: "Thinking step 2" },
])
```

> Note: there is a third test in that describe block, `"should handle
reasoning_content with leading/trailing whitespace"` — leave it untouched; with
> the new helper a `"  content with spaces  "` payload (length > 0) still flows
> through verbatim, which is what it already asserts.

## 4. Out of scope — do NOT do these

- Do not change any other provider, or the `TagMatcher`/`think`-tag handling.
- Do **not** re-add or re-wire: **TTS**, the **router / cloud provider**, **cloud
  upsell** UI, or **Roo/Zoo branding**.
- Do **not** rename internal ids (those stay `Roo-Code`).

## 5. Verify — paste real output, don't claim success without it

Run from the repo root:

- `cd src && npx vitest run api/providers/utils/__tests__/extract-reasoning.spec.ts` → 9 pass.
- `cd src && npx vitest run api/providers/__tests__/lite-llm.spec.ts` → all pass (incl. 6 new reasoning tests).
- `cd src && npx vitest run api/providers/__tests__/base-openai-compatible-provider.spec.ts` → all pass.
- `cd src && pnpm check-types` → clean.

## 6. Acceptance criteria (binary — all must hold)

- [ ] The §2 helper test (9 cases) passes.
- [ ] `lite-llm.spec.ts` reasoning block (6 cases) passes; rest of suite green.
- [ ] `base-openai-compatible-provider.spec.ts` updated 2 tests pass; rest green.
- [ ] Only these 6 files changed (`git status` confirms): the 2 new util files,
      `lite-llm.ts`, `base-openai-compatible-provider.ts`, and the 2 spec files.
- [ ] `pnpm check-types` clean.
- [ ] No new "Roo" or "Zoo" user-facing strings; no removed feature reintroduced.

## 7. Record in the ledger

Already recorded by the orchestrator after the plan file is written. The commit
(done by the orchestrator) will carry:

```text
Co-authored-by: Oh Daewoong <dw.oh@samsung.com>
```

> **Cross-port note for later:** PR #588 ("extractReasoningFromDelta helper") in
> the same port batch concerns this very helper. Since #449 introduces it here,
> #588 may already be satisfied or only need a small follow-up — re-diff #588
> against this branch/main when its turn comes.
