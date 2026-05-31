# Zoo PR #149 — Dedupe Responses API streamed tool calls

- **Upstream:** Zoo-Code #149, commit `ec204f960`, merged 2026-05-18 15:05, authors Roomote, Elliott de Launay.
- **Branch:** `feature/zoo-149-responses-api-dedupe-tool-calls` (off `main`).
- **Credit:** `Co-authored-by: Roomote <roomote@roocode.com>`, `Co-authored-by: Elliott de Launay <edelauna@gmail.com>`.

## What upstream #149 contains

Two independent slices:

1. **Product fix** (portable) — `src/api/transform/responses-api-stream.ts` + its unit spec
   `src/api/transform/__tests__/responses-api-stream.spec.ts`. Fixes double-execution of
   Responses API function calls: when a tool call is streamed via
   `response.function_call_arguments.delta` events AND then re-announced via
   `response.output_item.done`, the stream previously yielded both the streamed partials
   _and_ a final `tool_call`, executing the tool twice.
2. **xAI/Z.AI e2e coverage** (skipped) — `apps/vscode-e2e/src/suite/providers/xai.test.ts`
   (new, 695 lines), `zai.test.ts` changes, `apps/vscode-e2e/AGENTS.md`,
   `apps/vscode-e2e/fixtures/.gitignore`. These are gated on `process.env.AIMOCK_URL` /
   `AIMOCK_RECORD` — the `@copilotkit/aimock` replay harness our fork deliberately omits
   (see #53/#92 skips). Not portable.

## Port scope: product fix only

`responses-api-stream.ts` (our pre-image matches upstream exactly):

1. Declare `const streamedCallIds = new Set<string>()` at the top of
   `processResponsesApiStream`.
2. In the `response.function_call_arguments.delta` branch, tighten the guard to also
   require a non-empty `name` (`typeof name === "string" && name.length > 0`) and record
   `streamedCallIds.add(callId)` before yielding the `tool_call_partial`.
3. In the `response.output_item.done` branch, wrap the `tool_call` yield in
   `if (!streamedCallIds.has(callId))` — skip the final emit when the call was already
   streamed as deltas (NativeToolCallParser finalizes it from the partials).

Net behaviour:

- Streamed-delta tool calls → only partials emitted; the trailing `output_item.done` is
  suppressed (no duplicate execution).
- Delta omitting the name (can't be parsed as a partial) → no partial recorded, so
  `output_item.done` still falls back to emitting the full `tool_call`.

## Approach (TDD-first)

1. Append two tests to `responses-api-stream.spec.ts`: "should not yield duplicate
   tool_call when arguments were streamed as deltas" and "should fall back to
   output_item.done when delta omits the tool name". — RED (2 failing).
2. Apply the three product edits above. — GREEN.

## Skipped (aimock, documented)

`apps/vscode-e2e/src/suite/providers/xai.test.ts`, `.../zai.test.ts`,
`apps/vscode-e2e/AGENTS.md`, `apps/vscode-e2e/fixtures/.gitignore` — aimock replay e2e,
no aimock infra in our fork.

## Verification

- `npx vitest run api/transform/__tests__/responses-api-stream.spec.ts` → 28/28
  (2 new + 26 existing), no regressions.
- Build gate: `pnpm install:vsix -y --editor=code` must be green before push.
