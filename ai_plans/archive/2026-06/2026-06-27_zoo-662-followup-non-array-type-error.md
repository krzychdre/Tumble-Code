# Port Zoo PR #662 — ask_followup_question: report non-array follow_up as a type error

## §0 Credit & provenance

- Upstream: Zoo-Code-Org/Zoo-Code PR #662, commit `37008b7f6`, merged 2026-06-22. Fixes #511.
- Author: edelauna (Elliott de Launay).
- Commit trailer:
    ```
    Co-authored-by: Elliott de Launay <edelauna@gmail.com>
    ```

## §1 What & why (weak-model robustness)

When a weak model emits `follow_up` as a non-array (a keyed object / string / number,
common from incremental JSON parsing), the tool reported the misleading
"Missing value for required parameter 'follow_up'" — so the model kept retrying the
same malformed payload. The fix distinguishes:

- `follow_up` null/undefined → missing-parameter error (unchanged), vs
- `follow_up` present-but-not-an-array → a precise "must be an array" type error.

Directly aligns with our weak-model design work ([[feedback_design_for_weak_models]]).
Our fork was at the exact pre-PR state (`if (!follow_up || !Array.isArray(follow_up))`
collapsed both cases into the missing-param branch).

## §2 Edits

- `src/core/tools/AskFollowupQuestionTool.ts`:
    - add a `recordValidationError(message)` helper (increments mistake count, records
      tool error, `say("error", …)`, pushes `formatResponse.toolError(message)`).
    - split the validation: null/undefined → `recordMissingParamError`; non-array →
      `recordValidationError("The 'follow_up' parameter must be an array … Retry with
'follow_up' as a JSON array.")`.
    - interface comment documenting the runtime guard.
- `src/core/assistant-message/NativeToolCallParser.ts`: explanatory comment on the
  `ask_followup_question` case (it already forwards the raw present-but-non-array
  value so the tool can emit the precise error).
- `src/core/tools/__tests__/askFollowupQuestionTool.spec.ts`: strengthen the string
  case to assert the type-error message (not "Missing value"), and add an object case
  asserting `say("error", …)`, the pushed "must be an array" result, and that
  `task.ask` is NOT called with an invalid payload.

## §3 Verify (binary acceptance) — all ✓

- `npx vitest run core/tools/__tests__/askFollowupQuestionTool` → 36 pass.
- `pnpm --filter tumble-code check-types` passes.

## §4 Co-author — see §0.
