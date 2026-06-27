# Port Zoo PR #619 — enhance apply_diff prompt for weaker models (Gemini)

## §0 Credit & provenance

- Upstream: Zoo-Code-Org/Zoo-Code PR #619, merged 2026-06-24.
- Author: Andrew Schmeder.
- Commit trailer:
    ```
    Co-authored-by: Andrew Schmeder <149117631+awschmeder@users.noreply.github.com>
    ```

## §1 What & why (weak-model robustness)

Improves the `apply_diff` native-tool parameter description to raise weak-model
(Gemini, etc.) success rates:

- `:start_line:` reworded from "is required" → "strongly recommended" (matches our
  diff strategy, which already tolerates a missing start line).
- Adds a CRITICAL section spelling out exact `:start_line:[integer]` syntax (no
  `:220` / `:start_line=220` shorthands), the 100% whitespace-exact match rule, and
  the `-------` separator placement.

Our `apply_diff.ts` matched Zoo's pre-PR exactly; clean port. Aligns with
[[feedback_design_for_weak_models]].

## §2 Edits

- `src/core/prompts/tools/native-tools/apply_diff.ts`: update `DIFF_PARAMETER_DESCRIPTION`.
- Skipped Zoo's changeset file (our fork doesn't use that flow).

## §3 Verify (binary acceptance) — all ✓

- No snapshot/spec asserts the old wording.
- `pnpm --filter tumble-code check-types` passes.
