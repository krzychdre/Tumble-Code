# Cloud API: no remote images on panel pages (audit 2026-11-06, A-10)

**Status:** done on `fix/sec-img-src`
**Touched:** `self-hosted-cloudapi/src/middleware/content_security_policy.py`, `src/web/static/render.js`,
`tests/browser/images_checks.html`, `tests/test_browser_js.py`, `tests/test_web_a11y_csp.py`.

## Problem

`img-src 'self' data: https:` (`content_security_policy.py`) let `![](https://host/x.png)` in a transcript load from any
host, a read receipt on every view of a shared link.

## Fix

- CSP `img-src 'self' data:` on `/app` and `/shared` (one policy for both). Uploaded task images (same origin),
  attachments and mermaid diagrams (data:) keep rendering.
- `render.js`: markdown is rendered only there (marked + DOMPurify). `bodyImages` (was `localImages`, run on every row
  body) turns an `<img>` whose src is `http(s)://` or `//` into a plain `<a href>` (text: alt, else the URL), like any
  markdown link; it runs before the local-path rewrite and also without an image base. `Referrer-Policy: same-origin`
  already keeps the page URL from the link's host.

## Tests

`test_panel_pages_carry_a_strict_csp`: `img-src` is exactly `'self' data:` on every `/app` and `/shared` page.
`images_checks.html` (headless Chrome): https, alt-less http and protocol-relative images become links named by alt or
URL, no remote `<img>` left; red with the link branch disabled.

## Notes

api image rebuild owed.
