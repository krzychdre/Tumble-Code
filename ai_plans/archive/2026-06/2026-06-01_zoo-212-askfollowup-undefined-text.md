# Zoo PR #212 — AskFollowupQuestionTool: guard undefined text + comprehensive tests

- **Upstream:** Zoo-Code #212, commit `dacc2d432`, merged 2026-05-27 (commit 13:31:03Z — third of the 05-27 group by `%cI`, after #213 and #239), author Armando Vaquera.
- **Branch:** `feature/zoo-212-askfollowup-undefined-text` (off `main`).
- **Credit:** `Co-authored-by: Armando Vaquera <263793884+proyectoauraorg@users.noreply.github.com>`

## Problem

In `AskFollowupQuestionTool.execute()`, when `task.ask("followup", …)` resolved with
no `text`, the `say("user_feedback", text ?? "")` masked it but the
`pushToolResult(...<user_message>\n${text}\n...)` interpolated the raw `text`, emitting
the literal string `undefined` into the tool result / user_message the model sees.

## Fix (`src/core/tools/AskFollowupQuestionTool.ts`)

Bind `const safeText = text ?? ""` once and use it for BOTH the `say` and the
`pushToolResult` interpolation, so an undefined reply produces an empty
`<user_message>` rather than the literal `undefined`.

## Tests (`src/core/tools/__tests__/askFollowupQuestionTool.spec.ts`)

Replace the existing suite with the upstream comprehensive version (35 tests): covers
`execute()` happy paths, missing-param handling, the undefined-text guard (asserts the
pushed result does NOT contain `"undefined"`), `handlePartial()` streaming, error paths,
and `NativeToolCallParser` streaming integration for `ask_followup_question`
(`startStreamingToolCall` / `processStreamingChunk` / `finalizeStreamingToolCall`).

## Fork compatibility (verified)

- Fork `AskFollowupQuestionTool.ts` (the `say`/`pushToolResult` lines) matches the
  upstream parent verbatim; fix applied identically.
- Fork test file was byte-identical to the upstream parent, so the upstream post-change
  spec drops in cleanly (extracted via `git show`).
- All test imports resolve in the fork: `AskFollowupQuestionTool` + `askFollowupQuestionTool`
  singleton, `formatResponse`, and `NativeToolCallParser` with all five static streaming
  methods (`clearAllStreamingToolCalls`, `clearRawChunkState`, `startStreamingToolCall`,
  `processStreamingChunk`, `finalizeStreamingToolCall`).

## Scope / skip

No changeset (fork port workflow omits them). Product (1-line semantics) + tests.

## Verification

- `npx vitest run core/tools/__tests__/askFollowupQuestionTool.spec.ts` (from `src/`) — 35 pass.
- Build gate: `pnpm install:vsix -y --editor=code` must be green before push.
