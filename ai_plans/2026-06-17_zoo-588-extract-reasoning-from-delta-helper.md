# Port plan — Zoo PR #588 → `feature/zoo-588-extract-reasoning-from-delta-helper`

> **For the executor (read first).** Do the steps in order. Do not improvise or
> refactor beyond what is written (YAGNI). Every code block is already adapted to
> this repo. This repo is **Tumble Code**: never introduce the strings "Roo" or
> "Zoo" in user-facing text or test names.

---

## 0. Context

- **Upstream:** Zoo PR #588 — "use extractReasoningFromDelta helper for reasoning
  streams" (commit `6daa153ac`, merged 2026-06-15).
- **What it does:** Replaces the duplicated inline `reasoning_content` extraction
  block in each OpenAI-compatible streaming provider with the shared
  `extractReasoningFromDelta(delta)` helper. The helper prefers
  `delta.reasoning_content` (DeepSeek-R1 / QwQ style) and **falls back to
  `delta.reasoning`** (OpenRouter style) — so each provider gains the
  router-style fallback for free. Adds streaming coverage for the new paths.
- **Why we want it:** removes copy-pasted logic, gives every provider the
  `reasoning` fallback, and centralizes one well-tested helper. Low risk —
  behavior-preserving for the existing `reasoning_content` path.

- **Adaptations vs. the raw upstream diff (IMPORTANT):**

    1. **Helper already exists here.** `src/api/providers/utils/extract-reasoning.ts`
       is already present in our fork (and already used by
       `base-openai-compatible-provider.ts` and `lite-llm.ts`). Its semantics match
       Zoo's (`reasoning_content` first, then `reasoning`). **Do NOT recreate it.**
       The port is purely: import it into each surviving provider and swap the
       inline block.
    2. **Two of Zoo's seven providers do not exist in our fork.** `git ls-files`
       shows no `src/api/providers/mimo.ts` and no `src/api/providers/opencode-go.ts`.
       **Skip both** — only port the 5 that exist: deepseek, openai, qwen-code,
       requesty, unbound.
    3. **`requesty.ts` already imports from `../transform/reasoning`** (touched by
       the #555 port). Add the `extract-reasoning` import as a separate line next to
       the other `./utils/` imports; do not disturb the reasoning import.
    4. **No `unbound.spec.ts` in our fork.** Zoo adds 3 streaming tests to it, but
       our fork has no unbound test file and no OpenAI mock harness for one.
       **Scope cut (YAGNI):** apply the `unbound.ts` production refactor, but do NOT
       create a brand-new test file just for these 3 tests. The helper itself is
       already covered by `utils/__tests__/extract-reasoning.spec.ts`, and the
       refactor is behavior-preserving. Document the cut here so it isn't mistaken
       for an omission.
    5. **Test name branding.** Zoo's unbound spec has an `it("identifies itself as
Zoo Code …")` anchor — irrelevant here since we skip that file. Do not
       introduce "Zoo Code" anywhere.

- **Original authors — credit them:**

    ```text
    Co-authored-by: dw <41457565+daewoongoh@users.noreply.github.com>
    Co-authored-by: Oh Daewoong <dw.oh@samsung.com>
    ```

## 1. Preconditions

- [ ] Branch `feature/zoo-588-extract-reasoning-from-delta-helper` created off the
      `feature/zoo-555-…` branch (stacked — files do not overlap with #555 except
      `requesty.ts`, which #555 already touched, so stacking avoids a conflict).
- [ ] `src/api/providers/utils/extract-reasoning.ts` exports
      `extractReasoningFromDelta` (verify; it already exists).
- [ ] `mimo.ts` / `opencode-go.ts` confirmed absent (`git ls-files`).

## 2. Source edits

Each surviving provider gets (a) one import line and (b) the inline block swapped
for the helper call. The replacement block is identical everywhere:

```ts
const reasoningText = extractReasoningFromDelta(delta)
if (reasoningText) {
    yield { type: "reasoning", text: reasoningText }
}
```

### Edit A — `src/api/providers/deepseek.ts`

- Import after `import { OpenAiHandler } from "./openai"`:
  `import { extractReasoningFromDelta } from "./utils/extract-reasoning"`
- Replace the `if ("reasoning_content" in delta …)` block (keep the two
  `// Handle reasoning_content …` comment lines above it).

### Edit B — `src/api/providers/openai.ts`

- Import after `import { handleOpenAIError } from "./utils/openai-error-handler"`:
  `import { extractReasoningFromDelta } from "./utils/extract-reasoning"`
- Replace the inline block immediately before
  `yield* this.processToolCalls(delta, finishReason, activeToolCallIds)`.

### Edit C — `src/api/providers/qwen-code.ts`

- Import after `import { BaseProvider } from "./base-provider"`:
  `import { extractReasoningFromDelta } from "./utils/extract-reasoning"`
- Replace the inline block before the
  `// Handle tool calls in stream …` comment.

### Edit D — `src/api/providers/requesty.ts`

- Import after `import { applyRouterToolPreferences } from "./utils/router-tool-preferences"`:
  `import { extractReasoningFromDelta } from "./utils/extract-reasoning"`
- Replace the `if (delta && "reasoning_content" in delta …)` block before the
  `// Handle native tool calls` comment.

### Edit E — `src/api/providers/unbound.ts`

- Import after `import { applyRouterToolPreferences } from "./utils/router-tool-preferences"`:
  `import { extractReasoningFromDelta } from "./utils/extract-reasoning"`
- Replace the `if (delta && "reasoning_content" in delta …)` block before the
  `// Handle native tool calls` comment.

## 3. Tests (port from upstream, adapt anchors)

Add the 3 streaming tests (`reasoning_content`, `reasoning` fallback, preference
when both present) to the providers that **have** a test file, inside the
`createMessage` describe block:

- `src/api/providers/__tests__/deepseek.spec.ts` — after the cache-tokens test,
  before `describe("processUsageMetrics", …)`.
- `src/api/providers/__tests__/openai.spec.ts` — after the "Test response" text
  test, before `it("should handle tool calls in streaming responses", …)`.
- `src/api/providers/__tests__/qwen-code-native-tools.spec.ts` — after the
  `call_qwen_test` test, before
  `it("should preserve thinking block handling alongside tool calls", …)`.
- `src/api/providers/__tests__/requesty.spec.ts` — after the streaming "API Error"
  test, before `describe("native tool support", …)`. Each test constructs
  `new RequestyHandler(mockOptions)` and uses the file-level `mockCreate`.

**Skipped:** `unbound.spec.ts` (does not exist here — see §0 adaptation 4).

## 4. Out of scope

- No new `unbound.spec.ts`. No `mimo` / `opencode-go` (absent). No change to the
  helper itself. No "Zoo"/"Roo" strings.

## 5. Verify

- `pnpm --filter tumble-code check-types` clean.
- `cd src && npx vitest run api/providers/__tests__/deepseek.spec.ts api/providers/__tests__/openai.spec.ts api/providers/__tests__/qwen-code-native-tools.spec.ts api/providers/__tests__/requesty.spec.ts` all green.
- `cd src && npx eslint` on the 5 providers + 4 specs clean.

## 6. Acceptance

- [ ] All 5 providers call `extractReasoningFromDelta`; no inline
      `reasoning_content` block remains in them.
- [ ] New reasoning tests pass in the 4 spec files; touched suites green.
- [ ] No "Roo"/"Zoo" user-facing strings introduced.

## 7. Record

```bash
node .claude/skills/zoo-port/scripts/zoo-prs.mjs record --pr 588 --status ported \
  --branch feature/zoo-588-extract-reasoning-from-delta-helper \
  --plan ai_plans/2026-06-17_zoo-588-extract-reasoning-from-delta-helper.md
```
