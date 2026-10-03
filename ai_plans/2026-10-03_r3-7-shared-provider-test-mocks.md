# R3-7: shared provider test-mock helpers (2026-10-03)

Source of truth: `ai_plans/simplification_round3_audit_2026-10-02.md`, finding 7 ("Provider test
mock boilerplate - real but modest"). Branch: `chore/r3-7-shared-provider-test-mocks` off
`main` @ `1a457c7b5`.

## What the audit asked for

One `src/api/providers/__tests__/provider-test-helpers.ts` exporting the module-mock factory,
`mockCreate`, a default non-stream/stream implementation, and the per-SDK wrappers; migrate the
module-mock specs opportunistically. Verify-by-content: module-level
`const mockCreate = vi.fn()` in 14 files before, helper as the only definition site after.

## What was done

New helper module `src/api/providers/__tests__/provider-test-helpers.ts`:

- `openAiModuleMock(create, extraClientFields?)` - body of `vi.mock("openai", ...)`
  (`__esModule` + default constructor returning `{ chat: { completions: { create } } }`).
  `extraClientFields` covers qwen-code, whose handler reads `apiKey`/`baseURL` off the client.
- `anthropicModuleMock`, `anthropicVertexModuleMock`, `mistralModuleMock` - same for the
  Anthropic SDK, the Vertex SDK, and `@mistralai/mistralai` (chat.stream + chat.complete).
- `defaultOpenAiCreate` / `defaultAnthropicCreate` + the canonical response builders
  (`openAiCompletionResponse`, `openAiStreamResponse`, `anthropicMessageResponse`,
  `anthropicStreamResponse`) answering "Test response" with the 10/5/15 (OpenAI) resp.
  10/5 (Anthropic) usage triple, which ~16 specs cargo-culted identically.
- `TEST_RESPONSE_TEXT`, `OPENAI_TEST_USAGE`, `ANTHROPIC_TEST_USAGE` constants.

14 specs rewired to it (no assertion changes):

anthropic-protocol-characterization, anthropic, anthropic-vertex,
base-openai-compatible-provider, complete-prompt-usage, deepseek, lite-llm, lmstudio,
lmstudio-native-tools, minimax, mistral, openai, openai-cache-usage, openai-usage-tracking,
qwen-code-native-tools, qwen-code-token-refresh (16 files; deepseek and openai-usage-tracking
keep their bespoke default implementations, only the SDK module shell is shared).

## Placement decision (owner rule: test-only code must not leak into production exports)

The helper lives under `__tests__/`, which BOTH gates already treat as test scope:

- `scripts/find-test-only-exports.mjs` `TEST_PATH` matches `__tests__/` paths, so the helper's
  exports are never scanned as production exports - no allowlist entries needed.
- `knip.jsonc` ignores `**/__tests__/**`.
- Precedent: `src/services/tree-sitter/__tests__/helpers.ts`,
  `src/api/providers/fetchers/__tests__/fake-lmstudio-server.ts`,
  `src/integrations/terminal/__tests__/streamUtils/*`.

This is exactly the audit's proposed path; no `*ForTests` seam or allowlist churn required.

## The vitest hoisting constraint (why the recipe looks the way it does)

`vi.mock` factories are hoisted above every import, so a factory cannot touch a module-scope
`const mockCreate` (TDZ) and cannot statically import the helper. Every migrated spec follows
the same pattern:

```ts
const mockCreate = vi.hoisted(() => vi.fn())
vi.mock("openai", async () => {
	const { openAiModuleMock, defaultOpenAiCreate } = await import("./provider-test-helpers")
	return openAiModuleMock(mockCreate.mockImplementation(defaultOpenAiCreate))
})
```

Specs whose `beforeEach` calls `vi.clearAllMocks()` (which strips implementations) re-apply
their default implementation there (deepseek, openai-usage-tracking). minimax's inner
`let mockCreate = (Anthropic as any)().messages.create` indirection was dropped: the hoisted
module-scope `mockCreate` IS the function the mocked client returns.

## Deviations from the audit text

- deepseek, openai-usage-tracking, anthropic, mistral keep bespoke default implementations
  inline (cache-split usage, evolving-usage stream, cache-usage script, thinking-mode
  branches); only the duplicated SDK module-mock shell moved. The audit itself says "keep
  per-spec fixtures overridable" - bending these to the canonical shape would change what the
  specs assert.
- openrouter and openai-native-tools were NOT migrated: the audit explicitly classifies
  openrouter's per-test local `mockCreate` declarations as "a different, test-local pattern and
  not part of this finding"; openai-native-tools patches `handler.client` directly with a local
  mock (not a module mock at all).

## Verification (all from the branch, 2026-10-03)

- Module-level bare `const mockCreate = vi.fn()` in `src/api/providers/__tests__`: 14 files
  before -> 0 after (remaining hits are per-test locals in anthropic-vertex/openrouter, which
  the audit scopes out).
- `cd src && npx vitest run api/providers`: 90 files, 1946 passed, 1 skipped - same counts as
  the pre-change suite.
- `cd src && npx tsc --noEmit`: exit 0. `npx eslint api/providers/__tests__`: exit 0.
- `node scripts/find-test-only-exports.mjs --check`: exit 0, no findings, no stale allowlist.
- `pnpm knip`: only the two known pre-existing findings (zoo-prs.mjs twins) + the .css
  configuration hint.
- Net: 16 files touched, +225/-461 lines (236 deleted net, the duplicated scaffolding).
