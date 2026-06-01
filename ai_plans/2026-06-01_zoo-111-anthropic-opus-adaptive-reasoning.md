# Zoo PR #111 — Anthropic Opus 4.7 fails when reasoning is enabled

- **Upstream:** Zoo-Code #111, squash `d2fb21e07`, merged 2026-05-15 07:54, author Roomote/roomote[bot].
- **Branch:** `feature/zoo-111-anthropic-opus-adaptive-reasoning` (off `main`).
- **Credit:** `Co-authored-by: Roomote <roomote@roocode.com>`.

## Problem

On the **direct Anthropic** provider path, newer Opus models reject the
`thinking: { type: "enabled", budget_tokens: N }` payload when reasoning is enabled —
the request fails. These models instead expect a simple adaptive on/off
`thinking: { type: "adaptive" }`. Our `src/api/providers/anthropic.ts` only ever derived
`reasoning` via the budget path (`getModel().reasoning`), so enabling reasoning on
`claude-opus-4-7` blows up.

## Fix (1:1 port — scope verified against upstream evidence)

1. **`packages/types/src/providers/anthropic.ts`** — add `supportsReasoningBinary: true`
   to the `claude-opus-4-7` entry (keep `supportsReasoningBudget: true` so token-cap /
   stored max-token handling is unchanged). Upstream applies the binary flag to **only**
   `claude-opus-4-7` — _not_ opus-4-6 — and our model list is structurally identical, so
   this is a clean 1:1 mapping. (This overrides the triage report's "apply to opus-4-6/
   newer" suggestion, which predates our having an opus-4-7 entry; the upstream diff is
   the authority on scope.)

2. **`src/api/transform/reasoning.ts`** — add
   `AnthropicProviderReasoningParams = AnthropicReasoningParams | { type: "adaptive" }`
   and `getAnthropicProviderReasoning()`: returns `{ type: "adaptive" }` when
   `model.supportsReasoningBinary && settings.enableReasoningEffort`, else falls back to
   the existing `getAnthropicReasoning()` budget path.

3. **`src/api/providers/anthropic.ts`** — destructure `info` + `reasoningBudget` from
   `getModel()` and compute `thinking` via `getAnthropicProviderReasoning(...)` instead of
   the precomputed `reasoning`. Relax the request typing (`requestParams as
Anthropic.Messages.MessageCreateParamsStreaming`) so the adaptive shape is accepted,
   and add `thinking` to the `default:` branch's request as well.

4. **Specs** (TDD): `reasoning.spec.ts` (+adaptive/budget/disabled cases + type check),
   `anthropic.spec.ts` (+provider-path cases), `api.spec.ts` (+binary-flag cases).

## Skipped (aimock infra — deliberately absent from our fork)

- `apps/vscode-e2e/fixtures/claude-opus-4-7.json` — aimock replay recording.
- `apps/vscode-e2e/src/suite/anthropic-opus-4-7.test.ts` — modifies a file we don't have;
  fully gated on `AIMOCK_URL`/`AIMOCK_RECORD` fixture replay.

Consistent with the aimock-skip pattern from #72 and #95.

## Verification

- TDD: `reasoning.spec.ts`, `anthropic.spec.ts` (src), `api.spec.ts` (src) all green.
- Build gate: `pnpm install:vsix -y --editor=code` must be green before push.
