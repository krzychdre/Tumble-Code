# Port Zoo PR #567 — apply apiRequestTimeout consistently across providers

## §0 Credit & provenance

- Upstream: Zoo-Code-Org/Zoo-Code PR #567, commit `b747d56ba`, merged 2026-06-19.
- Authors: dw (Oh Daewoong), Naved Merchant.
- Commit trailers:
    ```
    Co-authored-by: Oh Daewoong <dw.oh@samsung.com>
    Co-authored-by: Naved  Merchant <naved.merchant@gmail.com>
    ```

## §1 What & why

Previously only `openai`/`lm-studio` and `BaseOpenAiCompatibleProvider` honored the
user's `apiRequestTimeout`. This wires it into **every** provider that builds an
OpenAI or Anthropic SDK client, via a single `timeoutMs` field on `BaseProvider`.

## §2 Edits

- `base-provider.ts`: add `protected readonly timeoutMs: number = getApiRequestTimeout()`.
- `timeout-config.ts`: refactor — `getApiRequestTimeout()` now returns `number`
  (never `undefined`), clamps to the valid 1–3600s range (out-of-range/NaN/non-number
  → 600s default), and `Math.round()`s the ms (avoids Anthropic SDK float-validation throw).
- `base-openai-compatible-provider.ts` + `openai.ts`: use `this.timeoutMs` instead of
  calling `getApiRequestTimeout()` directly; drop the now-unused import.
- Add `timeout: this.timeoutMs` to client construction in: `anthropic`, `minimax`,
  `anthropic-vertex` (3 sites), `openai-native`, `openai-codex`, `openrouter`,
  `router-provider` (covers `lite-llm`/`vercel-ai-gateway` via inheritance), `requesty`,
  `unbound`, `xai`, `qwen-code`.
- `src/package.json`: `tumble-code.apiRequestTimeout` → `type: integer`, `minimum: 1`.
- `package.nls*.json` (18 locales): updated description (drops the now-invalid
  "0 = no timeout", lists unsupported providers).

## §3 Divergence handled

- **Skipped Zoo-only providers** `zoo-gateway` and `opencode-go` — they don't exist here.
- Kept our `roo-code`-branded request headers (`originator`, X-Unbound-Metadata) — out of
  scope for this PR; only `timeout` was added.
- No changeset (our fork doesn't ship Zoo's changeset flow).

## §4 Tests

- Provider tests that mock `vscode` as `{}` (or via a global mock lacking
  `getConfiguration`) threw once `BaseProvider`'s field initializer started calling
  `getApiRequestTimeout()` at construction. Fixed by mocking `../utils/timeout-config`
  to return a constant `600_000` in the 8 affected specs (anthropic-vertex, lite-llm,
  openrouter, requesty, vercel-ai-gateway, vertex, vertex-credentials, vscode-lm).
- Added `timeout: 600_000` to the exact-args client-construction assertions in
  anthropic-vertex, openrouter, requesty (×2), vercel-ai-gateway.
- `timeout-config.spec.ts`: replaced the obsolete "0/negative → undefined" tests with
  out-of-range → default, plus min/max boundary and ms-rounding cases.

## §5 Verify (binary acceptance) — all ✓

- `pnpm --filter tumble-code check-types` passes.
- `npx vitest run api/providers/__tests__ api/providers/utils/__tests__/timeout-config`
  → 46 files, 904 pass, 1 skipped.

## §6 Co-authors — see §0.
