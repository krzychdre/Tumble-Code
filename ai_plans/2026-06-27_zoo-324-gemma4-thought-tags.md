# Port Zoo PR #324 — parse Gemma 4 `<thought>` reasoning tags alongside `<think>`

## §0 Credit & provenance

- Upstream: Zoo-Code-Org/Zoo-Code PR #324, commit `0084cc899`, merged 2026-06-26.
- Authors: Sagid M / Sagid Magomedov, Elliott de Launay (edelauna).
- Commit trailers:
    ```
    Co-authored-by: Sagid M <kofon95@mail.ru>
    Co-authored-by: Sagid Magomedov <sagidsmagomedov@gmail.com>
    Co-authored-by: Elliott de Launay <edelauna@gmail.com>
    ```

## §1 What & why (weak-model robustness)

Gemma 4 emits reasoning inside `<thought>…</thought>` rather than `<think>…</think>`.
This generalizes `TagMatcher` to accept multiple tag names so reasoning extraction
works for both, without a closing `</thought>` wrongly terminating a `<think>` block.
Aligns with [[feedback_design_for_weak_models]].

Our `src/utils/tag-matcher.ts` matched Zoo's pre-PR exactly; clean port.

## §2 Edits

- `src/utils/tag-matcher.ts`: constructor accepts `string | [string, ...string[]]`;
  tracks `tagNames` / `activeTagNames` / `candidates` so any of the names opens a
  block and only the matching name closes it. (Replaced wholesale with the upstream
  post-PR version — our file was byte-identical to Zoo's pre-PR.)
- `base-openai-compatible-provider.ts`, `lm-studio.ts`, `native-ollama.ts`,
  `openai.ts`: `new TagMatcher("think", …)` → `new TagMatcher(["think", "thought"], …)`.
- Tests: add `src/utils/__tests__/tag-matcher.spec.ts` (new upstream file, 18 cases);
  add two `<thought>` integration tests + tighten one flush assertion in
  `base-openai-compatible-provider.spec.ts`.

## §3 Scope cuts (divergence)

- **Skipped the `openai.spec.ts` +169-line additions** — our `openai.spec.ts` has
  diverged ~495 lines from Zoo's (timeout work in #567 + other), so the additions
  don't anchor cleanly. The behavior is already covered by `tag-matcher.spec.ts`
  (the matcher unit) and the `base-openai-compatible-provider.spec.ts` `<thought>`
  integration tests (the shared streaming path).

## §4 Verify (binary acceptance) — all ✓

- `pnpm --filter tumble-code check-types` passes.
- `npx vitest run utils/__tests__/tag-matcher api/providers/__tests__/base-openai-compatible-provider`
  → 38 pass (incl. the 2 new `<thought>` tests).
- 4 affected provider suites still green (121 tests).
