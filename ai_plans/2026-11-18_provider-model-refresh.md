# Provider model/cost refresh - 2026-11-18

Branch `feat/provider-model-refresh-2026-11-18` (from `origin/main` 6a5b8901f). Delta on top
of the 2026-11-13 refresh (`ai_plans/2026-11-13_provider-model-refresh.md`), plus the gaps
that refresh left behind. Catalogs live in `packages/types/src/providers/`.

Conventions applied (unchanged from 2026-11-13): a model the vendor no longer serves is
deleted; a model still served but with an announced shutdown gets `deprecated: true` and the
date plus replacement in its description (the picker hides it, pinned profiles keep working);
a retired id the vendor still resolves by redirecting gets the redirect target's info. Prices
are the standard rates; launch promotions are noted in descriptions only.

## Per-provider changes

### OpenAI native (`openai.ts`)

- Added `gpt-6.2-sol` ($2/$10, cached $0.10, write $2.50) and `gpt-6.2-astra` ($8/$40,
  cached $0.40, write $10): 1,050,000 context, 128K output, GPT-6 entry shape, reasoning
  required (the API rejects `none`), >272K whole-request surcharge 2x input/cache, 1.5x
  output. Sources: developers.openai.com model pages and pricing; prices cross-checked
  against OpenRouter `/api/v1/models`.
- Default `gpt-6.1-sol` -> `gpt-6.2-sol`.
- `deprecated: true` with shutdown date and replacement, per
  developers.openai.com/api/docs/deprecations: `gpt-5`, `gpt-5-mini`, `gpt-5-nano`, `o3`
  (2026-12-11); `gpt-4.1`, `gpt-4.1-mini`, `gpt-4o-mini` (2027-01-14); `gpt-5.1`,
  `gpt-5.4-nano` (2027-04-01). These notices predate the last refresh and were missed then.

### OpenAI Codex (`openai-codex.ts`)

- Added `gpt-6.2-sol` (500K Codex window, 100K reserve) and `gpt-6.2-astra` (272K Codex
  default window, new `SUBSCRIPTION_272K_MAX_OUTPUT_TOKENS` = 54,400, the repo's 20% reserve
  rule). Source: developers.openai.com/codex/models. Default -> `gpt-6.2-sol`.

### VS Code LM / Copilot (`vscode-llm.ts`, webview `useSelectedModel.ts`)

- GitHub retired GPT-5 mini on 2026-10-19 (supported-models retirement table), the only
  family the table held. GitHub publishes no per-family limits for current models, so the
  table and its webview lookup are removed; the settings show the sane defaults and the
  handler keeps reading live limits from the selected model.

### Anthropic routes

- No Claude release or retirement since 2026-11-13 (platform.claude.com release notes,
  deprecations, pricing; Vertex/Bedrock id tables; OpenRouter). No default changes.
- OpenRouter: `anthropic/claude-haiku-5.5` joined the prompt-caching and reasoning-budget
  sets and the fetcher's Claude 5 id map (OpenRouter lists cache prices and `reasoning` for
  it); it previously got neither cache breakpoints nor the adaptive-thinking flags.

### Gemini / Vertex (`gemini.ts`, `vertex.ts`, `src/api/transform/reasoning.ts`)

- Standard-price convention applied to every promo model: `gemini-4-argon` $4/$20 (cache
  $0.20), `gemini-3.8-flash` and `gemini-3.6-flash` $1.50/$7.50 (cache $0.15). Launch prices
  stay in the descriptions.
- `cacheWritesPrice` removed from all Gemini entries: the value was the hourly cache storage
  price, Gemini usage reports no write tokens and the handlers never read it; only
  ModelInfoView displayed it as a per-token write price.
- `gemini-4-hydrogen`: default effort `high` (vendor default) and the `xhigh` thinking
  level, which `GEMINI_THINKING_LEVELS` now passes through (lowercase on the wire).
- Added `gemini-3.1-flash-lite` (GA, $0.25/$1.50, cache $0.025).
- Vertex-only records for models Vertex still serves after their Gemini API removal:
  `gemini-3.7-flash` (retires 2027-01-28) and `gemini-3.5-flash` ($1.50/$9.00, retires
  2027-05-19 or later). Default `gemini-4-carbon` unchanged.

### xAI (`xai.ts`)

- The seven text models retired on 2026-05-15 still resolve but are served and billed as the
  redirect target (docs.x.ai/developers/migration/may-15-retirement): `grok-4-1-fast-*`,
  `grok-4-fast-*`, `grok-4-0709` and `grok-3` now share `grok43Info` ($1.25/$2.50, 1M),
  `grok-code-fast-1` shares `grokBuild01Info` ($1/$2, 256K); all flagged deprecated. The
  `grok-4.3` and `grok-build-0.1` entries use the same constants.
- Verified: `grok-build-0.1` does carry the >=200K whole-request surcharge. Default
  `grok-4.7` unchanged.

### Mistral (`mistral.ts`)

- `zai-glm-5-3-flash` and `deepseek-v4-1-flash-1017` accept images; the DeepSeek entry's
  max output is Mistral's 128K, not DeepSeek's own 384K. Verified: `zai-glm-5-3` is
  $1.4/$4.4 on Mistral (the hypothesis that it was inherited from GLM 5.2 is refuted).

### MiniMax (`minimax.ts`)

- The M2 family (M2, M2.1, M2.5, M2.7, their highspeed variants, M2-Stable) was retired on
  2026-11-18 and requests no longer work (platform.minimax.io/docs/faq/models): deleted.
  Tests that used them now use `MiniMax-M3` / `MiniMax-M3.1-Flash`; the frozen
  `cost-call-sites` model became `minimaxM3` (write price = input price, so only the cached
  rows changed). Qwen Code's `MiniMax-M2.5` is a different provider and stays.

### Z.ai mainland (`zai.ts`)

- `glm-4.6v-flashx`: CNY 1.5 output and 0.03 cache hit -> $0.21 and $0.004 (7.0 CNY/USD).

### Bedrock non-Anthropic entries (`bedrock.ts`)

Checked against the AWS Price List API (us-east-1 on-demand) and the Bedrock model cards and
lifecycle page.

- Deleted (EOL 2026-07-07 passed): Llama 3.2 90B/11B/3B/1B, Llama 3.1 405B.
- Deprecated (Legacy, EOL 2027-03-30): `deepseek.r1-v1:0`, Llama 3.3 70B, Llama 3.1 70B/8B,
  Llama 3 70B/8B, `moonshot.kimi-k2-thinking`, `minimax.minimax-m2`,
  `qwen.qwen3-coder-480b-a35b-v1:0`; limits corrected from the model cards.
- Prices: gpt-oss-20b $0.07/$0.30 and gpt-oss-120b $0.15/$0.60 (were $0.50/$1.50 and
  $2/$6); qwen3-next input $0.14. Nova Pro/Lite/Micro/2 Lite: cache writes are not billed,
  and the cache-point config follows AWS's prompt-caching table (system and messages, 4
  points, 1K minimum).
- Added successors: `deepseek.v3.2`, `minimax.minimax-m2.5`, `qwen.qwen3-coder-next`.
- `deepseek.r1-v1:0` left `BEDROCK_SERVICE_TIER_MODEL_IDS` (the price list has no
  Priority/Flex SKU for it); `deepseek.v3.2` and `minimax.minimax-m2.5` joined it.

### Unchanged after checking

DeepSeek, Moonshot, Qwen Code, Z.ai international, LiteLLM default.

## Left open on purpose

- `grok-3-mini`: the model page returns 404 but xAI published no retirement notice.
- Mistral Large 4 accepts `reasoning_effort`; the Mistral handler does not send it (a
  feature, not a catalog fix).
- Bedrock: Kimi K3 (no published max output), Nova 2 Pro (no model card), Llama 4 (already
  Legacy), Titan Text and the latency-optimized variants (no lifecycle entry to cite).
- Bedrock still serves Claude Opus 4.1 via `us.` until 2027-01-08; not added.

## Verification

- `pnpm check-types`, `pnpm lint`, `pnpm knip`: all pass.
- vitest: packages/types 789, packages/core 548, src/api 2428, src specs outside api that
  name a changed id 1423, webview-ui models + settings 871, apps/cli 1742. All pass.
