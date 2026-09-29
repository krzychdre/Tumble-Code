# Cloud sign-in: replayed callback logs out + bare origin 404

Date: 2026-09-29. Branch: `fix/cloud-login-replay-and-root-redirect`.

## Symptoms

1. After a successful self-hosted sign-in the Cloud view still showed
   "Try Tumble Code Cloud" (logged-out screen).
2. The Cloud view's URL link and "visit website" button open the bare
   `cloudApiUrl` (`http://localhost:8085`), which answered 404; the web panel
   lives at `/app`.

## Root cause 1 (evidence: api container log)

```
POST /v1/client/sign_ins 200                 <- ticket exchanged, credentials stored
POST /v1/client/sessions/.../tokens 200
GET  /v1/me 200, /v1/me/organization_memberships 200 (x6)
POST /v1/client/sign_ins 401                 <- same one-time ticket delivered again
GET  /v1/me/organization_memberships 200     <- refresh timer still alive afterwards
```

The second delivery of the same callback (most likely the manual "paste the
redirect URL" entry used after the browser had already handed it over) fails
on the server, because the ticket is single-use. `WebAuthService.handleCallback`
then called `changeState("logged-out")` unconditionally. That flips only the
visible state: the stored credentials and the refresh timer survive, so the UI
said "logged out" while the session kept working, and a window reload
"fixed" it.

## Fix 1

`handleCallback`'s catch changes the state to `logged-out` only when the
service holds no credentials. A first sign-in that fails still logs out as
before; a failing replay keeps the live session and only reports the error.

Test: `WebAuthService.spec.ts` "keeps a signed-in session when the same
callback is delivered again" (fails on the old code, verified).

## Fix 2

`GET /` in the cloud API redirects (307) to `/app`, which applies its own
login check. Server-side so every client that opens the bare origin benefits.
Route table pin updated; `tests/test_root_redirect.py` added.

## Not changed

- The state parameter is not cleared after a successful exchange: that would
  turn a replay into a "may have been tampered with" message, which is worse
  wording for a harmless double delivery.
- `useOrganizationSwitch` opens `${cloudApiUrl}/billing`, which the
  self-hosted API does not serve; out of scope here.
