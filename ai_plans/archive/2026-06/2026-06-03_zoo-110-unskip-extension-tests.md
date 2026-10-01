# Port Zoo-Code #110 — Clean up skipped extension package tests

**Date:** 2026-06-03
**Branch:** `feature/zoo-110-unskip-extension-tests` (off `main`)
**Upstream:** Zoo-Code PR #110 (`39342a794`), "[Chore] Clean up skipped extension package tests"

## §0. Credit

PR #110 was authored entirely by `roomote[bot]` (AI assistant; the only
`Co-authored-by` is `Roomote <roomote@roocode.com>`, the same bot). Per our
credit rule, bot / AI-assistant trailers are dropped and no human author remains.
**No `Co-authored-by:` trailer.**

## §1. Scope

Test-only chore. Removes dead `it.skip` / `test.skip` / `describe.skip` blocks and
replaces them with working coverage that runs against current production code. No
production change. Two files:

- `src/core/task/__tests__/Task.spec.ts` — unskip + rewrite 4 tests:
    - "should clean conversation history…" → "should strip non-protocol fields from
      API conversation history before sending to the API"
    - "should handle image blocks based on model capabilities" → "should shape image
      blocks for API compatibility before request construction"
    - "should handle API retry with countdown" (unskipped, rewritten)
    - "should not apply retry delay twice" (unskipped, rewritten)
    - The rewrites use the modern `new Task({ …, startTask: false })` construction
      plus `Task.resetGlobalApiRequestTime()` in `beforeEach`/`afterEach`.
- `src/core/webview/__tests__/ClineProvider.spec.ts`:
    - top-of-file: add `fs/promises`, `axios`, and `../../../utils/path`
      (`getWorkspacePath`) mocks needed by the unskipped MCP-settings tests.
    - unskip `test("handles openProjectMcpSettings message")`.
    - unskip + rewrite `test("handles openProjectMcpSettings file creation error")`
      — switch `require` → `await import`, mock `getWorkspacePath`, and assert the
      translated key `"errors.create_json"` (test-mode `t()` returns the key).
    - delete the entire `describe.skip("ContextProxy integration")` block (dead).

## §2. Fork-divergence handling (verified)

Our test files match Zoo's pre-#110 state closely. Two divergences mattered:

1. **`cline.say` → `cline.askSay.say`** — our fork moved `say` onto an `askSay`
   sub-object (Task.spec.ts lines 641, 762). These sit in the **unchanged gaps
   between** #110's hunks, so the patch applied without touching them. Verified by
   clean `git apply` of the Task.spec.ts patch and a full green run.
2. **`ClineProvider.spec.ts` `@@ -2133,86` hunk rejected** — our
   `describe.skip("ContextProxy integration")` block had `extensionUri: {}` where
   Zoo had `extensionUri: { fsPath: "/test/path" }`. Since #110 **deletes** that
   whole block, the divergence is irrelevant to the result; resolved by manually
   applying Zoo's post-state (rewrite the file-creation-error test + delete the
   block). All other 8 hunks applied cleanly.

Production sanity-checks before trusting the rewrites:

- `webviewMessageHandler.ts:1404` calls `t("mcp:errors.create_json", …)` — matches
  the new assertion (test `t()` mock strips the namespace → `"errors.create_json"`).
- `getWorkspacePath` is exported from `src/utils/path.ts:114`.
- `ApiStreamChunk` already imported in Task.spec.ts (line 14).
- `ContextProxy` import retained (still used at lines 436, 516, 1145, …).

## §3. Method (how it was applied)

1. `git apply` Zoo's #110 patch for `Task.spec.ts` — clean.
2. `git apply --reject` for `ClineProvider.spec.ts` — 8/9 hunks applied; 1 `.rej`.
3. Manually resolved the rejected hunk with two `Edit`s (rewrite test + delete
   ContextProxy block); removed the `.rej`.

## §4. Verification (binary acceptance)

```
cd src && npx vitest run core/task/__tests__/Task.spec.ts            # 42 passed
cd src && npx vitest run core/webview/__tests__/ClineProvider.spec.ts # 91 passed
pnpm check-types   # 13/13
pnpm lint          # 13/13
```

- [x] All unskipped tests pass against **unchanged** production code.
- [x] No `it.skip` / `test.skip` / `describe.skip` remain in either file.
- [x] Gates green.
- [x] No production code touched; no Roo/Zoo branding introduced.

## §5. Landmines

- This is test-only — do **not** modify production to make a test pass. If a
  rewritten test encoded Zoo behavior our fork doesn't have, the correct move is to
  adapt the assertion to our real behavior (none were needed — all passed as-is).
- Keep the `askSay` form (`vi.spyOn(cline.askSay, "say")`) — do not revert to
  `cline.say`.
- Don't re-add the deleted `ContextProxy integration` block.
