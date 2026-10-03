# R3-6: messageEnhancer — static class → plain functions

Source of truth: `ai_plans/simplification_round3_audit_2026-10-02.md`, finding 6.
Branch: `chore/r3-6-message-enhancer-functions` off `main` @ `cdd8839e0`.

## What the audit asked for

Keep `src/core/webview/messageEnhancer.ts` where it is; convert the
`MessageEnhancer` static-method class into plain exported functions in the SAME
file; keep a thin `export const MessageEnhancer = { ... }` object facade over
them. Explicit goals: no imports change anywhere, the routing spec's
`vi.mock("../messageEnhancer", ...)` keeps working untouched, and only the
private `extractTaskHistory` accesses in `messageEnhancer.test.ts` change.
This prepares ground for R3-12 (ClineProvider extraction) by keeping the public
surface stable at the one ClineProvider-adjacent call site
(`messageHandlers/enhanceAndSearch.ts`).

## What was done

- `src/core/webview/messageEnhancer.ts`: the class is gone. Three module-level
  exported functions now carry the logic, bodies verbatim (only `this.` removed):
    - `enhanceMessage(options): Promise<MessageEnhancerResult>` (was `static async`)
    - `extractTaskHistory(messages): string` (was `private static`)
    - `captureTelemetry(taskId?, includeTaskHistory?): void` (was `static`)
- Back-compat facade kept, per the audit: `export const MessageEnhancer = {
enhanceMessage, captureTelemetry }` with a doc comment saying new code should
  import the functions directly. `extractTaskHistory` is intentionally NOT on
  the facade (it was private; the facade mirrors the old public surface).
- `src/core/webview/__tests__/messageEnhancer.test.ts`: exactly 4 line changes —
  the import now also brings `extractTaskHistory`, and the three
  `(MessageEnhancer as any).extractTaskHistory(...)` accesses call the exported
  function directly (the `as any` private-member hack is gone). All other
  `MessageEnhancer.*` call sites in the test keep working through the facade.
- `messageHandlers/enhanceAndSearch.ts`: NOT touched (facade keeps it working).
- `webviewMessageHandler.routing.spec.ts`: NOT touched, verified zero diff.

## Behavior change

None. Function bodies are byte-identical to the former static method bodies.

## Verification (all on the branch)

- `cd src && npx vitest run core/webview/__tests__/messageEnhancer.test.ts
core/webview/__tests__/webviewMessageHandler.routing.spec.ts` — 2 files,
  166 tests passed, 0 skipped/failed.
- `cd src && npx tsc --noEmit` — clean.
- `pnpm knip` — exit 1 with only the two pre-existing findings
  (`.claude` + `.roo` `zoo-prs.mjs`, by design) and the known `.css`
  configuration hint. No new findings.
- `node scripts/find-test-only-exports.mjs --check` — exit 0
  ("No test-only exports outside the allowlist"). Note: the newly exported
  `extractTaskHistory` is used in its own file by `enhanceMessage`, so it falls
  under the script's `usedInOwnFile` seam convention and needs no allowlist
  entry.
- Audit's verify-by-content checks: `class MessageEnhancer` gone from `src`;
  exactly one non-test importer of `messageEnhancer`
  (`messageHandlers/enhanceAndSearch.ts:10`); routing spec diff empty.

## Deviations from the audit

None.

## Follow-up note (from the audit, not this PR)

If a future owner drops the facade, finding 12 (R3-12) must carry an explicit
one-off exception for the mock shape at `webviewMessageHandler.routing.spec.ts:209-216`.
