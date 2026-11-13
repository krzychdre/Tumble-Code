# D4 — one private helper for the MDM redirect block in `postStateToWebview*`

Roadmap item D4 of `ai_plans/2026-09-27_simplification-roadmap.md` (Priority 2: DRY and YAGNI):

> The MDM redirect block is copied four times in the `postStateToWebview*` methods.
> Fix: One private helper. (Behaviour unchanged, so the do-not-touch rule is respected.)
> Effort: S.

## Status

Implemented on branch `feature/d4-mdm-redirect-helper` off `main` (2026-09-28).

## The duplication (verified on main @ 40426e1bf)

The same three-line block appeared verbatim four times in `src/core/webview/ClineProvider.ts`
(only the leading comment wording differed slightly):

1. [`postStateToWebview()`](../src/core/webview/ClineProvider.ts:1469) — lines 1469-1473
2. [`postStateToWebviewWithoutTaskHistory()`](../src/core/webview/ClineProvider.ts:1495) — lines 1495-1498
3. [`postStateToWebviewWithoutClineMessages()`](../src/core/webview/ClineProvider.ts:1522) — lines 1522-1525
4. [`postClineMessageAdded()`](../src/core/webview/ClineProvider.ts:1574) — lines 1574-1577

```ts
// Preserve existing MDM redirect behavior
if (this.mdmService?.requiresCloudAuth() && !this.checkMdmCompliance()) {
	await this.postMessageToWebview({ type: "action", action: "cloudButtonClicked" })
}
```

## Do-not-touch check

`docs/architecture.md` lists "State delivery to the webview: `clineMessagesSeq`, the three
`postStateToWebview*` variants, the `sourceTaskId` routing in the webview state merge" as
do-not-touch without a dedicated item. D4 **is** that dedicated item, and the roadmap
explicitly scopes it to extracting this block with behaviour unchanged: the four methods keep
their names, signatures, message shapes and orderings; only the duplicated block moves into
one private method. The state-delivery contracts (sequence numbering, history/message
omissions, `messageAdded` routing) are untouched.

## The fix

One private helper, [`postMdmRedirectToWebview()`](../src/core/webview/ClineProvider.ts:1583),
placed right after `postClineMessageAdded` (the last caller). It contains exactly the
condition and message the four blocks contained, with the comment preserved in the doc
comment. All four call sites now end with `await this.postMdmRedirectToWebview()`.

Semantics notes (unchanged from before, stated for the reviewer):

- The helper is `async` and awaited at every call site, so the redirect message keeps its
  position in the post ordering exactly as the inline block had.
- `postClineMessageAdded` calls it before `return true` — same position as the old block.
- The optional-chaining `mdmService?.` keeps the no-MDM-Service case a no-op; without
  `mdmService`, `checkMdmCompliance()` also returns true, so the condition is never entered.

## Regression test

Added at the lowest layer that exercises it: the existing `ClineProvider` unit spec
(`src/core/webview/__tests__/ClineProvider.spec.ts`), which already constructs a real
`ClineProvider` against mocked VS Code — no new harness was needed. The new
`describe("postMdmRedirectToWebview")` block spies on the private helper and asserts:

- each of the four `postStateToWebview*`-family methods routes the state post through the
  helper exactly once (`postClineMessageAdded` is driven through its early-return fallback,
  which forwards to `postStateToWebviewWithoutTaskHistory`, proving that path calls it too);
- the helper posts the `cloudButtonClicked` action exactly once when an MDM policy requires
  cloud auth and the user is non-compliant (against a stubbed `mdmService`);
- nothing is posted without an `mdmService`, and nothing when compliant.

(What the spec cannot cheaply prove is the message _content_ per site, since `postMessageToWebview`
is spied at the provider boundary for most cases; the helper is the single copy of that content,
so one content assertion covers all four sites by construction.)

## Verification

- `cd src && npx vitest run core/webview/__tests__/ClineProvider.spec.ts` — pass (see below).
- Typecheck and lint of the touched files — pass.
- `pnpm knip` from the repo root — no new findings vs. the pre-existing main baseline (exit 1
  baseline unchanged; see the roadmap/known-issues notes).

## Changeset

`.changeset/d4-mdm-redirect-helper.md` — `tumble-code`, patch. Pure refactor, no user-visible
change; the changeset exists because every merged item in this batch carries one per the
roadmap's demand ("one pull request, a changeset, and a regression test at the lowest layer").
