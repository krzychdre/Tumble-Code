# Cloud panel: Sign out refused by the CSP

## Symptom

Clicking "Sign out" in the web panel did nothing. The browser console showed:

> Refused to send form data to 'http://localhost:8085/app/logout' because it
> violates the following Content Security Policy directive: "form-action 'self'".

## Root cause (verified on the live server)

The form posts to the same origin, so the first hop is allowed. The redirect
chain after it is not:

```
POST /app/logout  -> 303 Location: /app/login
GET  /app/login   -> 307 Location: http://localhost:9000/application/o/authorize/...
```

Chrome applies `form-action` to every redirect that follows a form
submission. The hop to Authentik (port 9000, another origin) violates
`form-action 'self'`, so the whole navigation is cancelled. Chrome reports the
original URL, not the redirect target, which is why the message names
`/app/logout`.

The chain dates from R10 (#538), which turned the GET logout link into a POST
form: a link navigation is not subject to `form-action`, a form is.

A second, hidden defect: even without the CSP, going straight to Authentik
after logout signs the reader back in, because Authentik's own session
outlives the panel's.

## Fix

- `POST /app/logout` now redirects to a new same-origin page
  `GET /app/signed-out` (template `signed_out.html`) with a "Sign in again"
  link. The CSP stays as strict as it was.
- Rejected: adding the Authentik origin to `form-action`. It weakens the
  policy and still re-signs the reader in at once.

## Tests

- `test_logout_redirects_never_leave_the_panel_origin` walks the redirect
  chain from the logout POST and requires every hop to be a relative panel
  path, ending on a 200 page. Verified to fail with the old `/app/login`
  redirect.
- Route table and OpenAPI expectations list the new route; the CSP/a11y suite
  renders `/app/signed-out` too.

## Not done here

- Ending the Authentik session (RP-initiated logout via the end-session
  endpoint) would need its own design: it is a cross-origin redirect as well.
- `test_extension_routes_refuse_a_bad_token[headers3]` fails in a full run
  only: its JWT is minted at import time with a 60 s lifetime and expires
  before the test runs. Pre-existing, unrelated.

## Deployment

The live API runs from a built image; rebuild it after merge for the fix to
be live.
