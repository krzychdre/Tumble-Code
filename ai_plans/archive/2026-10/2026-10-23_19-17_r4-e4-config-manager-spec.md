# R4 E4: one `isConfigured` table and no duplicate describes in `config-manager.spec.ts`

- **Status:** done
- **Related plans:** `ai_plans/2026-10-23_17-20_maintenance-audit-round-4.md` (item E4)

## Touched files

- `src/services/code-index/__tests__/config-manager.spec.ts`

## Problem

The spec had two `describe("loadConfiguration")`, two `describe("isConfigured")` and `getConfig` tested twice. The
second `loadConfiguration` block repeated "load from globalState and secrets" and "enabling the feature requires a
restart" (already under `doesConfigChangeRequireRestart`); the second `getConfig` test asserted a subset of the
one under "getter properties"; the second `isConfigured` block repeated the OpenAI, Ollama and missing-Qdrant-URL
cases. The `currentModelDimension` tests were nested inside the second `isConfigured` block although they test
another getter.

## Change

- `isConfigured` is one `it.each` keyed by provider with every distinct case: openai with/without key, openai
  without Qdrant URL, ollama with base URL, openai-compatible complete / without base URL / without key, gemini
  with/without key.
- The second `loadConfiguration`, the second `getConfig` and the second `isConfigured` blocks are deleted.
- `currentModelDimension` is a top-level describe of the suite.
- 1999 lines before, 1785 after; 72 tests, all green.

## Tests

- `./node_modules/.bin/vitest run services/code-index/__tests__/config-manager.spec.ts --maxWorkers=2`: 72 passed.
- Mutation checks (each restored afterwards):
    - drop `!!this.qdrantUrl &&` in `isConfigured()`: "openai without a Qdrant URL" red.
    - Ollama descriptor `isConfigured` returns false: "ollama with a base URL" red (plus two restart tests).
    - Gemini descriptor `isConfigured` returns true: "gemini without a key" red.
    - openai-compatible needs only the key (in `read` and `isConfigured`): "without a base URL" red; needs only the
      base URL: "without a key" red.
    - `getConfig()` returns a wrong `embedderProvider`: "getter properties > getConfig" red.

## Notes

- The openai-compatible descriptor checks base URL and key twice (in `read` and in `isConfigured`), so a mutation of
  either one alone stays green. That duplication is in production code and outside this test-only change.
- `doesConfigChangeRequireRestart` rule 1 ("became enabled and configured") is also reached through the embedder
  key comparison further down, so removing rule 1 alone keeps the suite green. Not changed here.
