# Webview CSP: guessable nonce, unescaped OpenRouter origin (audit X-7, W-8)

**Status:** done on `fix/sec-ext-csp-nonce`
**Related:** `private_docs/security-audit-2026-11-06/report.md` X-7, W-8
**Touched:** `src/core/webview/getNonce.ts`, `src/core/webview/WebviewHtml.ts`, `src/core/webview/__tests__/WebviewHtml.spec.ts`

## Problem

- X-7: `getNonce` built the CSP script nonce from `Math.random()`, which is not a secure generator. The nonce is
  what keeps injected markup from loading a script (`'nonce-...' 'strict-dynamic'`, `WebviewHtml.ts:79`).
- W-8: `openRouterOrigin` cut the origin with `/^(https?:\/\/[^/]+)/`, so a base URL such as
  `https://a"><script>x</script>` put `"` and `>` into the CSP `content="..."` attribute; `;` could add directives.

## Fix

- `getNonce` returns `crypto.randomBytes(16).toString("base64")`.
- `openRouterOrigin` accepts only host characters (`A-Za-z0-9.-:[]`) up to the first `/`, `?`, `#` or the end;
  anything else falls back to `https://openrouter.ai`. `URL.origin` alone was not enough: it keeps `"` in the host.

## Tests

`WebviewHtml.spec.ts` adds a localhost origin with a port (kept) and the quote and semicolon injections (fall back to
the default). Mutation: the old regex put back fails the quote case; restored, all pass. The nonce has no test: the
only property left to check is the randomness of `crypto`, a library.
