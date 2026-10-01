# Cloud web panel: sign-in pages on base.html, one palette, deduplicated CSS

Status: done (PR 1 of 2 for item D8 of `ai_plans/2026-10-01_simplification-round-2.md`; the visual polish is
stacked on this branch as `feat/cloud-web-polish`).

## Touched files

- `self-hosted-cloudapi/src/web/templates/auth_success.html`, `auth_error.html`
- `self-hosted-cloudapi/src/web/static/auth_return.js` (new)
- `self-hosted-cloudapi/src/routers/browser.py`
- `self-hosted-cloudapi/src/middleware/content_security_policy.py` (docstring only)
- `self-hosted-cloudapi/src/web/static/app.css`
- `self-hosted-cloudapi/src/web/templates/task_detail.html`
- tests: `test_route_boilerplate.py`, `test_browser_auth.py`, `test_web_a11y_csp.py`, `test_web_light_theme.py`

## Problem

1. The two sign-in pages did not extend `base.html`. Each carried its own `<style>` with hard-coded greys
   (`#1e1e1e`, `#2d2d2d`, `#ccc`, `#999`, ...), a blue button that exists nowhere else, no light theme, and
   `auth_success.html` ran an inline script with the redirect URL written into it as a JS string literal.
   `routers/browser.py:88` built its own `Jinja2Templates` instead of using `src/web/templating.templates`.
2. `app.css` wrote the light palette twice (lines 131-174 for a light OS preference, 175-216 for the forced
   light theme), because a media query and an attribute selector cannot share one rule. The tests had to
   check that the two copies stayed equal.
3. `.btn-stop` was a copy of `.btn-deny`, `.btn-resume` a copy of `.btn.ghost`, `.btn-send` a copy of `.btn`
   (app.css ~2600-2630).
4. `.search-clear` (app.css ~687-697) matched nothing: no template, script or presenter emits it.

## Fix

1. Both sign-in pages extend `base.html` (no section tabs: there is no user; `hide_sign_in` set in the
   template hides the panel's Sign in button) and use the `.empty` component like `not_found.html`. The
   title takes the outcome's hue (`--d-cache` / `--d-error`). The redirect moved to `static/auth_return.js`,
   which follows the page's own "Return to VS Code manually" link (reads its `href` attribute, where
   autoescape put the URL), so the URL is never inside a script and `json_for_script` is no longer needed
   here. `browser.py` renders through the shared `templates`.
2. Every colour token in `:root` is now `light-dark(light, dark)`, `:root` has `color-scheme: light dark`,
   and `:root[data-theme="dark"|"light"]` only pin `color-scheme`. `--shadow-lift` got a colour token
   (`--shadow-ink`) because `light-dark()` accepts colours only. theme.js is unchanged (it still sets or
   removes `data-theme`).
3. Stop is `btn btn-deny`, Resume is `btn ghost`, Send is `btn`; the three copies are gone.
4. `.search-clear` deleted. Every other class in app.css was checked against templates, JS and Python
   presenters, including the families built from strings (`grade-*`, `seg-*`, `spend-*`, `role-*`,
   `hide-*`, `tl-*`): all are live.

## Before / after

Pixel comparison of 14 pages x dark/light x desktop/phone (seeded SQLite, headless Chrome): every panel
page is byte-identical before and after; only the two sign-in pages changed (now the panel's top bar,
typography and theme, light theme works).

## Tests

- `test_route_boilerplate.py`: the success page test now checks the return link carries exactly the URL,
  there is no inline script, and `auth_return.js` and `app.css` are loaded; the error page test checks the
  texts and that there is no inline style or script.
- `test_web_light_theme.py`: replaced "the two light blocks are equal" with "every colour token is a
  light-dark() pair, no `prefers-color-scheme` block exists, the forced themes only pin color-scheme"; the
  AA contrast checks read each side of the pairs.
- `test_web_a11y_csp.py`: the sign-in templates are no longer exempt from the no-inline-style/script check.
- Gates: `pytest tests/test_web_*.py test_phone_layout test_browser_js test_route_boilerplate
test_browser_auth test_sign_in_flow test_auth*.py test_json_islands test_remote_access test_csrf
test_shared_access`: 480 passed. `pnpm knip` exit 0.

## Notes / caveats

- `light-dark()` needs Chrome/Edge 123+, Firefox 120+, Safari 17.5+ (all from 2024). An older browser
  would drop every colour declaration. The panel already relies on `:has()` and `color-mix()` from the same
  era, so the floor moves only slightly.
- The `/auth/...` pages are still outside the CSP prefixes (the error page closes its tab through a
  `javascript:` link).
