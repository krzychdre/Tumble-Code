# Webview link handling: mailto and #fragment links opened as files, marketplace URLs not checked

**Status:** done on `fix/sec-webview-links`
**Related:** security audit 2026-11-06, findings W-4, W-5, W-9
**Touched:** `webview-ui/src/utils/markdown.ts`, `webview-ui/src/components/common/MarkdownBlock.tsx`,
`webview-ui/src/components/marketplace/components/MarketplaceInstallModal.tsx`,
`webview-ui/src/components/marketplace/components/MarketplaceItemCard.tsx`, `webview-ui/src/utils/url.ts` (deleted)

## Problem

- W-4: the markdown anchor click handler treated every href without `://` as a local file
  (`MarkdownBlock.tsx`, `!href?.includes("://")`). `mailto:a@b.c` and `#section` became
  `openFile` messages for a file named after the link, so mail links in model output were dead.
- W-5: the marketplace install modal rendered `item.url` (marketplace JSON) as a raw `<a href target=_blank>`.
  VS Code's webview frame turns any anchor click into `did-click-link`, which the opener service handles
  for more schemes than our `openExternal` handler allows (http, https, mailto).
- W-9: `utils/url.ts` `isValidUrl` was only `new URL(...)`, so `javascript:` counted as valid on the
  marketplace card.

## Fix

- `isFileLink(href)` in `utils/markdown.ts` holds the classification: file:, `name.ext:line`, Windows
  paths (shared with `markdownUrlTransform`), plus any non-empty path without a scheme that is not a
  `#fragment`. The click handler uses it, so web, mailto and fragment links are left to VS Code, which
  opens mailto/http(s) and scrolls fragments. Relative links (`src/a.ts:12`, `../docs/a.md`) still open files.
- The marketplace card and modal use `isOpenableExternalUrl` from `@tumble-code/core/browser` (the same
  predicate the host's `openExternal` handler applies); the modal link is a `Button` posting `openExternal`,
  like the card. `utils/url.ts` is gone.

## Tests

- `MarkdownBlock.spec.tsx`: https, mailto and `#section` clicks post no `openFile`; `../docs/a.md` opens.
  Mutation: the old `://` check makes the mailto and `#section` cases red.
- `MarketplaceInstallModal.spec.tsx`: the link posts `openExternal`; a `javascript:` URL renders no link.
  `MarketplaceItemCard.spec.tsx`: `invalid-url` and `javascript:` author URLs render no button.
  Mutation: dropping either predicate makes those cases red.
