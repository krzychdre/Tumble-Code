# Cloud API: loopback sign-in redirect for the CLI

**Status:** done on branch `feat/cloudapi-loopback-sign-in` (not pushed)
**Related plans:** `ai_plans/2026-10-03_11-00_cli-cloud-login-overview.md` (overview, shared contract; lives on
`feat/client-kind-telemetry`), `ai_plans/archive/2026-06/2026-06-19_finish-self-hosted-auth-flow.md`

## Touched

- `self-hosted-cloudapi/src/routers/browser.py`: `is_loopback_auth_redirect`, `is_allowed_auth_redirect` accepts it,
  the callback answers a loopback redirect with a 303, the refusal text names the CLI too.
- `self-hosted-cloudapi/tests/test_auth_redirect_validation.py`: accept and reject lists, callback and end-to-end
  tests.
- `self-hosted-cloudapi/tests/test_route_boilerplate.py`: the refusal page's new wording.
- `self-hosted-cloudapi/README.md`, `docs/08-cloud.md`: the redirect rules.

## Problem

The CLI cannot receive a `vscode://` deep link, so it signs in the way native apps do (RFC 8252 section 7.3): it
listens on a random port of the loopback interface and asks the cloud API to send the browser back there. The
API refused every `http://` value (`_NON_EDITOR_SCHEMES`, DEF-S3), so `auth_redirect=http://127.0.0.1:<port>`
got a 400.

## Fix

### Accepted grammar

```
http://(127.0.0.1|localhost|[::1]):PORT        (full match, nothing before or after)
PORT = [1-9][0-9]{3,4}, value 1024..65535
```

- Lowercase only, as the CLI builds it (`HTTP://` and `LOCALHOST` are refused).
- No path, query, fragment, user info or trailing slash. The trailing slash is refused on purpose: the callback
  appends `/auth/clerk/callback`, and `http://127.0.0.1:8080/` would turn that into `//auth`.
- `[0-9]`, not `\d`: in a Python `str` pattern `\d` matches digits of every script, and `int()` would accept them.
- The editor rule (`<scheme>://<publisher>.<name>`, not a browser scheme) is unchanged. Every other http or https
  value is still refused.

### Redirect, not a page

For a loopback redirect the callback returns `303 See Other` with
`Location: <auth_redirect>/auth/clerk/callback?code=<ticket>&state=<state>` and `Cache-Control: no-store`. The
editor redirect keeps the HTML bounce page (browsers block a 3xx to `vscode://`).

Why a redirect rather than the success page with "Return to the terminal" wording:

- A browser follows an http 3xx by itself; no script and no click are needed.
- When the CLI runs on another machine (an ssh session) the browser cannot reach the port and shows a connection
  error, but the address bar holds the whole callback URL. The CLI tells the user to paste it into the
  terminal (overview plan, "Fallback for a remote shell"). With the page, a working script navigation ends the
  same way, but a blocked one leaves only a link whose target the user has to copy by hand.
- The success page and its script stay untouched, so the VS Code flow cannot regress.

The CLI's listener serves its own "you can close this tab" page after a successful callback.

### What did not change

- The session and the ticket: `create_session`, `create_ticket` (single use, 5 minute TTL) and
  `POST /v1/client/sign_ins` are the same calls in the same order; the end-to-end test redeems the ticket once and
  gets 401 on the second try.
- The state row (10 minutes, consumed by the callback) and PKCE.
- Authentik. The blueprint (`self-hosted-cloudapi/authentik/blueprints/tumble-code.yaml`, `redirect_uris`,
  `matching_mode: strict`) lists only the API's own `/auth/clerk/callback` (plus the `WEB_PUBLIC_URL` one), and
  `get_authorize_url` always sends that as `redirect_uri`. `auth_redirect` never reaches Authentik; it lives
  only in our state row. No blueprint change.

## Security notes

- The ticket goes only to this machine's loopback interface. A local process that wins the port could read it,
  which is the accepted RFC 8252 model; the CLI also checks `state`, so a ticket arriving for another sign-in is
  ignored.
- Bypass attempts in the reject list: `http://127.0.0.1.evil.com:8080`, `http://127.0.0.1:8080@evil.com`,
  `http://evil.com@127.0.0.1:8080`, `http://localhost.:8080`, `http://0.0.0.0:...`, `http://127.1:...`,
  `http://2130706433:...`, `http://[::ffff:127.0.0.1]:...`, missing, privileged, zero-padded, signed,
  underscored and out of range ports (`99999`, `65536`), full-width and Arabic-Indic digits, whitespace, tab,
  CR/LF, trailing slash, path, query, fragment, `https://` and `ws://` loopback.
- The callback re-checks the stored value with the same function, so a state row with a foreign value (written
  before DEF-S3, or by any other path) still gets a 400 and no ticket; the test now covers loopback look-alikes
  too.
- The CSP middleware (`src/middleware/content_security_policy.py`) applies only to `/app` and `/shared`, so the
  `/auth/clerk/callback` response carries no policy. A CSP would not govern a top-level 3xx navigation anyway.
  Authentik ends its flow with a script navigation to our callback, not a form post, so its `form-action` does
  not apply to the redirect chain either.
- Not mixed content: an https page moving the top-level window to an http URL is a plain navigation.

## Tests

- `test_auth_redirect_validation.py`: `LOOPBACK_ACCEPTED` (5 values) and `LOOPBACK_REJECTED` (47 values) added to
  the validator and sign-in route lists; three loopback look-alikes in the route 400 test; the stored-redirect
  refusal parametrised over five values; `test_callback_redirects_a_loopback_redirect_with_303` (exact
  `Location`, URL-encoded ticket and state, `no-store`); `test_editor_redirect_still_gets_the_success_page`;
  `test_loopback_sign_in_end_to_end` (real state row, session and ticket on SQLite, only Authentik mocked:
  sign-in, callback, replayed callback refused, ticket redeemed once).
- `uv run pytest -q`: whole suite green. `uvx ruff@0.15.12 check .`: clean.

## Notes

- **api image rebuild needed** before the CLI login works against the live server.
- Merge order (overview): after the client kind branches, before `feat/cli-cloud-login`. This branch has no
  dependency on them.
