# Fix Authentik back-channel 502 on OAuth callback (public-address ready)

Branch: `fix/cloudapi-authentik-back-channel-host`

## Symptom

After logging in to the bundled Authentik, the browser lands on
`GET http://localhost:8085/auth/clerk/callback?code=...&state=...` with
**502 Bad Gateway**.

## Root cause (proven, not inferred)

The "502" is **not** a reverse-proxy error — it is the cloud API's own error
page, returned at [browser.py:267](../self-hosted-cloudapi/src/routers/browser.py#L267)
when the back-channel token exchange to Authentik throws.

Evidence chain, gathered against the running stack:

1. `api` container log:
   `Token exchange failed: Client error '404 Not Found' for url 'http://auth_server:9000/application/o/token/'`
2. Every Authentik `/application/o/*` route 404s on the back-channel, while
   `/-/health/live/` returns 200 — so the container is reachable, the routes are not.
3. The only variable is the HTTP `Host` header. Probing the same URL:
    - `Host: auth_server:9000` → **404**
    - `Host: localhost` / `localhost:9000` / `auth.tumblecode.dev` / `evil.example.com` → **200**
4. Narrowed to the underscore: `under_score.example.com` → 404, `auth-server:9000` → 200.

**Authentik (Django) resolves the brand — and therefore serves its OAuth/OIDC
routes — from the `Host` header, and rejects hosts containing an underscore
(`auth_server` is not a valid RFC-1123 hostname) with a 404.** The compose
service is named `auth_server`, so the back-channel URL `http://auth_server:9000`
makes httpx send `Host: auth_server:9000` → 404 → token exchange fails → 502 page.
The browser flow works only because the front-channel host (`localhost:9000`) is valid.

The discovery doc's `issuer` merely echoes the request Host, and the token's real
`iss` is fixed at front-channel authorize time, so the topology-independent fix is
to make the back-channel present the **public front-channel host** as `Host`.

## Fix

Connect to the internal service name (for DNS) but send the front-channel host
(host of `AUTHENTIK_BASE_URL`) as `Host` on every server-to-server call. Works
identically for dev (`localhost:9000`) and prod (`auth.tumblecode.dev`).

- [config/auth.py](../self-hosted-cloudapi/config/auth.py): add
  `get_back_channel_host_header()` → returns `urlsplit(authentik_base_url).netloc`
  when `authentik_internal_url` is set, else `None`.
- [src/auth/authentik.py](../self-hosted-cloudapi/src/auth/authentik.py): add
  `_back_channel_headers()` and apply it to `exchange_code_for_tokens`,
  `get_userinfo`, `get_openid_configuration`.
- [.env.example](../self-hosted-cloudapi/.env.example): document the Host behaviour
  and a full `app.tumblecode.dev` production block.
- [tests/test_back_channel_host.py](../self-hosted-cloudapi/tests/test_back_channel_host.py):
  lock in the header value and that it is attached to all three calls.

No compose change needed: the Host override neutralises the underscore, so
`AUTHENTIK_INTERNAL_URL=http://auth_server:9000` stays valid.

## Production (app.tumblecode.dev)

```
API_BASE_URL=https://app.tumblecode.dev
AUTHENTIK_BASE_URL=https://auth.tumblecode.dev        # front-channel host → sent as Host
AUTHENTIK_INTERNAL_URL=http://auth_server:9000        # back-channel (in-cluster)
AUTHENTIK_REDIRECT_URI=https://app.tumblecode.dev/auth/clerk/callback
CORS_ORIGINS=https://app.tumblecode.dev
AUTHENTIK_CLIENT_SECRET=<openssl rand -hex 32>        # provider is confidential
```

The provider `client_type` is `confidential`, so a matching `client_secret` is
mandatory in production (the bundled stack already shares one via env). The api
will send `Host: auth.tumblecode.dev` on back-channel calls.

## Verification

- Unit: `pytest tests/test_back_channel_host.py` + auth suites → 22 passed.
- Live, against the running Authentik (simulating the patched code path):
    - old (`Host: auth_server:9000`) → **404**
    - new (`Host: localhost:9000`) + real client_secret + fake code → **400 `invalid_grant`**
      — i.e. the request now reaches the token endpoint, client auth passes, only the
      fake code is rejected. A real authorization code will succeed.
