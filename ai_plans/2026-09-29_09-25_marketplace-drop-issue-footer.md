# Marketplace: drop the "Found a problem..." footer

**Status:** done on `fix/marketplace-drop-issue-footer`
**Touched:** `webview-ui/src/components/marketplace/IssueFooter.tsx` (deleted),
`webview-ui/src/components/marketplace/MarketplaceListView.tsx`, `webview-ui/src/i18n/locales/*/marketplace.json`
(key `footer.issueText` removed in all 18 locales), `webview-ui/src/components/ui/__tests__/link.call-sites.spec.tsx`

## Problem

Every marketplace tab ended with "Found a problem with a marketplace item or have suggestions for new
ones? Open a GitHub issue to let us know!", linking to the upstream Roo Code repository. The owner asked
to remove it.

## Fix

The footer had one call site, so the component, its call and the translation key are gone. The
link-call-site test that covered the footer's inline style was removed with it.

## Tests

Marketplace and link specs green, `tsc --noEmit` clean, `scripts/find-missing-translations.js` reports
all locales complete.
