# Provider model/cost refresh — 2026-11-13

Branch `feat/provider-model-refresh-2026-11` (from `origin/main`). All catalogs live in
`packages/types/src/providers/`, wired via `provider-models.ts`; the extension, CLI and
webview consume them through `@tumble-code/types`. No per-provider logic changed except
where a handler matched models by id pattern (Bedrock adaptive thinking, OpenRouter
Claude-5 id map) or carried a stale fallback price (DeepSeek fetcher).

Research date 2026-11-13. Sources fetched during implementation: platform.claude.com
(pricing, models overview, model deprecations, Claude on Google Cloud), OpenRouter
`/api/v1/models`, QwenLM/qwen-code `docs/users/configuration/model-providers.md`,
docs.z.ai pricing, docs.bigmodel.cn pricing (CNY list, converted at 7.0 CNY/USD as the
repo already does), docs.x.ai model list, platform.minimax.io pricing.

## Per-provider changes

### Anthropic (`claude.ts`, `anthropic.ts`)

- Added `claude-fable-5-2` (1M context, 128K output, $8/$40, 5m cache write $10, 1h
  write $16, cache read $0.20; always-on adaptive thinking, default effort high). Same
  record shape as Fable 5.1; the 1h write price has no catalog field and is noted in a
  comment.
- Added the Mythos family — `claude-mythos-5-2` ($8/$40, write $10, read $0.20),
  `claude-mythos-5-1` ($10/$50, write $12.50, read $0.25), `claude-mythos-5`
  ($10/$50, write $12.50, read $1.00). Each mirrors its Fable counterpart's
  specifications and pricing; descriptions state the models are available only to
  organizations verified through Anthropic's verification programs.
- Default `claude-opus-5` → `claude-opus-5-5`. No price changes on existing models.

### OpenAI native (`openai.ts`)

- Added `gpt-6.1-sol` ($2/$10, cached $0.10, write $2.50; >272K long-context $4/$15)
  and `gpt-6.1-terra` ($1/$5, cached $0.05, write $1.25; long-context $2/$7.50), in
  the GPT-6 entry shape (apply_patch tool set, no verbosity field, temperature off).
- `gpt-6-astra` was already in the table, so nothing to add there.
- Marked `gpt-5.2` and `gpt-5.3-codex` deprecated (they live in the native table, not
  the Codex table).
- Default `gpt-5.6-sol` → `gpt-6.1-sol`.

### OpenAI Codex (`openai-codex.ts`)

- Added `gpt-6.1-sol`, `gpt-6.1-terra`, `gpt-6-astra` (reasoning required, `none`
  rejected), `gpt-6-luna`. `gpt-6.1-sol` runs on the 500k subscription window in Codex
  with a 100k response reserve (new `SUBSCRIPTION_500K_MAX_OUTPUT_TOKENS`); the others
  keep the 200k window / 40k reserve.
- Removed Codex-retired ids: `gpt-5.5` (2026-10-14), `gpt-5.4` and `gpt-5.4-mini`
  (2026-08-31), `gpt-5.3-codex-spark` (2026-09-14). The GPT-5.6 trio stays.
- Default `gpt-5.6-sol` → `gpt-6.1-sol`.

### Gemini (`gemini.ts`)

- Added `gemini-4-carbon` (1M context, 64K output, standard $4/$20, cache $0.20; the
  $2/$10 launch price runs through 2026-11-30 and is noted in the description — the
  standard price is recorded so estimates never come in under the charge) and
  `gemini-4-hydrogen` (1M context, 64K output, $1.50/$7.50, cache $0.075).
- Removed `gemini-3.5-flash` and `gemini-3.7-flash` (removed from the Gemini API). The
  Vertex table's `gemini-3.5-flash` entry went with it, since Vertex derives from the
  same record.
- Marked `gemini-2.5-pro` and `gemini-2.5-flash` deprecated with routing notes
  (requests routed away from 2026-12-01). The `-latest` aliases are unchanged.
- Default `gemini-3.1-pro-preview` → `gemini-4-carbon`.

### Vertex (`vertex.ts`)

- Added `claude-fable-5-2`, `claude-mythos-5-2/5-1/5` and `claude-opus-4-1@20250805`
  (retired on the Claude API but still served by Vertex's Google-managed endpoint;
  priced/limited like Opus 4).
- Added `gemini-4-carbon` and `gemini-4-hydrogen` — the Gemini side of the Vertex
  table lists models explicitly, so the additions are wired by hand, not inherited.
- Default → `claude-opus-5-5`.

### Bedrock (`bedrock.ts` types, `src/api/providers/bedrock.ts`)

- Added `anthropic.claude-fable-5-2` and the Mythos trio with the cache-point fields;
  all four joined `BEDROCK_GLOBAL_INFERENCE_MODEL_IDS` (the Mythos overview documents
  them through the `global.` inference profile).
- The Bedrock handler's `isAdaptiveThinkingModel` now also matches `mythos-5`, so it
  sends the Fable-style adaptive-thinking contract instead of temperature.
- Default → `anthropic.claude-opus-5-5`. Nova entries and
  `anthropic.claude-opus-4-20250514-v1:0` untouched.

### xAI (`xai.ts`)

- Added `grok-4.7` (500K context, $2/$6 sub-200K and $4/$12 above, cached $0.50,
  reasoning effort via Responses API), `grok-build-0.1` (256K, $1/$2, cached $0.20).
- Replaced the plain `grok-4.20` with the dated ids the vendor serves:
  `grok-4.20-0309-reasoning`, `grok-4.20-0309-non-reasoning` and
  `grok-4.20-multi-agent-0309` (all 1M context, $1.25/$2.50, cached $0.20; ≥200K
  whole-request surcharge doubles every rate, per the decoded docs.x.ai price list).
- Default `grok-4.6` → `grok-4.7`. All older models kept untouched.

### DeepSeek (`src/api/providers/fetchers/deepseek.ts`)

- Catalogs were already current. The unknown-model fallback now prices at the current
  flash rates $0.30/$1.20 with cache-hit $0.006 (was the V3-era $0.28/$0.42/$0.028).

### Z.ai (`zai.ts`)

- Added `glm-5.3-flash` ($0.15/$0.50, cached $0.03), `glm-5.3-flashx` ($0.37/$1.25,
  cached $0.075) and `glm-5.3-flashx-legal` (same price, legal-specialized) to the
  international table; 1M context, 128K output, multimodal per the docs.
- `glm-5-turbo` and `glm-5v-turbo` moved out of the international table into a
  mainland-only record set (`mainlandOnlyZAiModels`) that the mainland table derives
  from exactly like the international entries.
- Mainland overrides updated to the current bigmodel.cn CNY list (÷7.0):
  glm-4.7-flashx ¥0.5/¥3/¥0.1 → $0.07/$0.43/$0.014; glm-4.5-air ¥0.8/¥2/¥0.16 →
  $0.11/$0.29/$0.023; glm-4.5v ¥2/¥6 → output $0.86; glm-4.6v ¥1/¥3/¥0.2 →
  $0.14/$0.43/$0.029; new glm-5.3-flash ¥0.8/¥2.8/¥0.23 → $0.11/$0.40/$0.033 and
  glm-5.3-flashx(-legal) ¥2/¥7/¥0.57 → $0.29/$1.00/$0.081.
- Default `glm-5.3` (international and mainland) unchanged.

### Mistral (`mistral.ts`)

- Added `mistral-large-4` (1M context, $0.7/$2.1).
- Marked `mistral-large-latest` (Large 3) and `mistral-medium-latest` (Medium 3.5)
  deprecated (2026-10-31, retiring 2027-04-30). The repo has no latest-aliasing
  mechanism; the versions live in the descriptions.
- Removed `zai-glm-5-2` (retired 2026-10-31). Added `zai-glm-5-3` ($1.4/$4.4),
  `zai-glm-5-3-flash` ($0.15/$0.5) and `deepseek-v4-1-flash-1017` ($0.3/$1.2, public
  preview).
- The platform's cached-input prices ($0.07 / $0.14 / $0.03 / $0.007) are not
  recorded: the Mistral handler reports no cache usage and every entry in the table
  deliberately keeps `supportsPromptCache: false` with no cache fields (noted in the
  file header). Default `codestral-latest` unchanged.

### MiniMax (`minimax.ts`)

- Added `MiniMax-M3` (multimodal, 1M context; ≤512K input $0.30/$1.20 with cache read
  $0.06, >512K doubles every rate including cache reads) and `MiniMax-M3.1-Flash`
  (multimodal, 1M context, $0.15/$0.60, cache read $0.015, thinking depth
  low→max, default max). The pricing page publishes no cache-write price and no max
  output limit, so the M2 family's conservative 16K reserve is kept and no
  cacheWritesPrice is recorded.
- Default `MiniMax-M2.7` → `MiniMax-M3`. The M2 family stays (retirement unverified).

### Moonshot (`moonshot.ts`)

- Added `kimi-k3.1-pro` (1M context, vision + tools + reasoning effort, $2/$10,
  cached input $0.20, 5m cache write $2, 1h write $4) and `kimi-k3.1-pro-highspeed`
  ($4/$20, cached $0.20, writes $4/$8). The 1h write prices have no catalog field and
  are noted in comments; the same applies to kimi-k3's $6 1h write, which is why it
  was not added.
- Marked the K2 entries (`kimi-k2.6`, `kimi-k2.7-code`, `kimi-k2.7-code-highspeed`)
  deprecated (closed to new users 2026-10-31, retiring end of 2026-12). The
  `kimi-k2.6` stand-in for unknown ids stays while the model is served.
- Default `kimi-k3` → `kimi-k3.1-pro`.

### Qwen Code (`qwen-code.ts`)

- Set the current Coding Plan models per the QwenLM/qwen-code docs: `qwen3.5-plus`
  (vendor default), `qwen3.6-plus`, `qwen3.7-plus`, `qwen3-coder-next`,
  `qwen3-max-2026-01-23`, `glm-5`, `glm-4.7`, `kimi-k2.5` (vision), `MiniMax-M2.5`;
  `qwen3-coder-plus` kept (still current). All stay subscription-priced at zero; the
  docs list no per-model limits, so the shared 1M/64K plan limits apply.
- `qwen3-coder-flash` marked deprecated (not in the current plan set; no verified
  retirement, so it is not removed). Default → `qwen3.5-plus`.

### OpenRouter (`openrouter.ts` types, `src/api/providers/fetchers/openrouter.ts`)

- `anthropic/claude-opus-5.5` is listed on OpenRouter at $4/$20 (write $5, read
  $0.20), matching the Anthropic table, so `openRouterDefaultModelId` and the
  pre-fetch default info moved to it.
- `anthropic/claude-fable-5.2` is listed ($8/$40), so it joined the prompt-caching
  and reasoning-budget capability sets and the fetcher's `claude5AnthropicIds` map.
  No Mythos ids are on OpenRouter, so none were added there.

## Test updates

- `packages/types`: `claude-model-tables.spec.ts` (+ regenerated
  `claude-model-tables.json` fixture) — new limit rows, Opus 4.1 moved from
  "retired everywhere" to "retired on the Claude API" (Vertex still serves it, so
  `RETIRED_CLAUDE_ID` dropped the opus-4.1 alternative), rows may now omit a Bedrock
  id. `provider-default-model.spec.ts` pins the `gpt-6.1-sol` default literal.
  `zai-mainland-models.spec.ts` fixture regenerated. `openai-codex.spec.ts` and
  `deepseek-models.spec.ts` pass against the new tables.
- `src/api`: `anthropic.spec.ts` covers Fable 5.2 and Mythos 5.2 adaptive thinking;
  `bedrock.spec.ts` default-model comments updated; `openai-codex.spec.ts` pins the
  new Codex catalog, the 500k Sol window and Astra's required reasoning;
  `responses-api-characterization.spec.ts` uses current Codex models (snapshots
  regenerated); `gemini.spec.ts` no longer references the removed 3.5 Flash;
  `zai-model-limits.spec.ts` pins the new flash entries and drops the turbo ids from
  the international expectations; `fetchers/deepseek.spec.ts` pins the new fallback
  prices; `fetchers/openrouter.spec.ts` covers `anthropic/claude-fable-5.2`;
  `cost-call-sites.characterization.spec.ts` unchanged (its prices are frozen in the
  fixture).

## Deviations from the research brief

- Mythos 5 cache read is **$1.00**, not $0.25 (platform.claude.com pricing page);
  Mythos 5.1 is $0.25. The fetched prices are recorded.
- GLM-4.7-FlashX mainland is **¥0.5/¥3/¥0.1 → $0.07/$0.43/$0.014**, not
  $0.07/$0.40 with $0.10 cache (the bigmodel.cn list decodes that way; $0.40 would
  be the GLM-5.3-Flash output price).
- GLM-4.5-Air mainland reads as the **¥0.8/¥2 base tier** (cache hit ¥0.16), i.e.
  $0.11/$0.29/$0.023.
- Gemini 4 Carbon records the standard $4/$20 with the promo noted, per the brief.
- The webview `provider-forms.model-rules.spec.tsx` case label "default
  claude-opus-5" is now stale wording only; the assertion still holds with the new
  default and the file belongs to the other agent's territory (webview goldens), so
  it was left alone.

## Verification

- `packages/types`: 49 files / 789 tests pass; `tsc --noEmit` clean.
- `src/api`: 140 files / 2420 tests pass (full-directory run also confirmed the only
  failures anywhere in `src` are the pre-existing worktree-environment ones —
  tree-sitter/dist-asset specs need built wasm, ShadowCheckpointService specs fail
  on a clean tree in this worktree too).
- `pnpm knip` exits 0. ESLint clean on all changed files; Prettier applied.
