# Cloud web: open the panel from other machines, behind a host/network allowlist

**Status:** done on `feat/cloud-web-remote-access` (stacked on `feat/cloud-web-subtask-tree`), committed, not pushed.
Second of three stacked branches. **Live since 2026-09-23** on the local stack, built from the top branch
(`feat/cloud-web-run-cost-rollup`), with `WEB_PUBLIC_URL=http://192.168.50.141:8085` and
`WEB_ALLOWED_NETWORKS=192.168.50.0/24` in `.env` (see "Deployed" below).
**Related plans:** `2026-06-22_full-stack-docker-compose.md` (front/back-channel split, bundled Authentik and
its blueprint), `2026-06-19_finish-self-hosted-auth-flow.md` (the OAuth flow itself).
**Touched:** `self-hosted-cloudapi/config/settings.py`, `config/auth.py`, new `src/auth/network_access.py`,
`src/auth/authentik.py`, `src/auth/web_session.py`, `src/routers/browser.py`, `src/realtime/sio.py`,
`src/main.py`, new `src/web/templates/forbidden.html`, `src/web/templates/base.html`,
`authentik/blueprints/tumble-code.yaml`, `docker-compose.yml`, `.env.example`, `README.md`,
new `tests/test_remote_access.py`, `tests/test_bridge.py`

## Request

"Allow opening the panel from external hosts (a whitelist of hosts/networks)."

## What was happening

The port is published on every interface (`0.0.0.0:8085`), so another machine could load the panel; it
could not sign in. Measured against the live stack from this host through its LAN address:

```
GET http://192.168.50.141:8085/app        -> 303 http://192.168.50.141:8085/app/login
GET http://192.168.50.141:8085/app/login  -> 307 http://localhost:9000/application/o/authorize/?...
                                                  &redirect_uri=http%3A%2F%2Flocalhost%3A8085%2Fauth%2Fclerk%2Fcallback
```

Both the Authentik address (`AUTHENTIK_BASE_URL`) and the callback (`AUTHENTIK_REDIRECT_URI`) are
`localhost`, which on another machine is that machine. There was no notion of who may open the panel.

Facts the design rests on, each checked in the running containers:

- **Authentik checks a token request's `redirect_uri` only against the provider's registered list**
  (`authentik/providers/oauth2/views/token.py`, `__check_redirect_uri`), not against the URI the code was
  issued for. So the registered list is the only thing that stops a code from being issued to another
  host: a broad regex there, combined with a callback host taken from the request's `Host` header, would
  let an attacker who gets a victim's code replay it at the api with a forged `Host` and receive the
  victim's session. Hence one exact public URL, registered strictly, and the `Host` header is compared
  against it, never used to build a URL.
- **Blueprint tags:** `!ParseJSON` takes only a literal string (it does not resolve `!Env`), so a list of
  URLs cannot come from the environment; `!If`, `!Env` and `!Format` can express "the local callback,
  plus the public one when set".
- **A blueprint is re-applied when its file hash changes** (`blueprints/v1/tasks.py`,
  `check_blueprint_v1_file`), not when the environment changes.
- **A browser on the host arrives from the compose network's gateway**, not loopback: the api's access log
  shows `192.168.0.1` for `localhost:8085` (docker-proxy), and the real source (`192.168.50.141`) for the
  LAN address.
- **engine.io sets `REMOTE_ADDR` to the constant `"127.0.0.1"`** (`engineio/async_drivers/asgi.py`), so the
  bridge must read the client from `environ["asgi.scope"]["client"]`.

## Change

Two settings, both validated at startup (a typo stops the server rather than silently opening or closing
the panel):

- **`WEB_ALLOWED_NETWORKS`**: IPs and CIDR networks, comma separated. Empty (default) = any client, as
  before. Once set, loopback and, inside a container, the default gateway (read from
  `/proc/net/route`, i.e. this host) stay allowed.
    - `WebAccessMiddleware` answers everything under `/app` (panel, login, logout) with a 403 page for other
      clients.
    - The web branch of `/auth/clerk/callback` refuses such a client before the code is spent.
    - `get_web_user_optional` ignores the session cookie for such a client, so `/shared/<id>` treats it as
      anonymous (public shares stay public; private ones need a sign-in, which is gated).
    - The bridge refuses a browser handshake from such a client; extension sockets (token auth) are not
      the panel and are untouched.
- **`WEB_PUBLIC_URL`**: `scheme://host[:port]`, no path, no trailing slash (the blueprint appends the
  callback path to the exact string). `config.auth.front_channel(host)` returns the configured URLs, unless
  the request arrived on this URL's host; then the callback is `<WEB_PUBLIC_URL>/auth/clerk/callback` and
  Authentik is addressed on the same host (keeping its port) when it is configured on loopback. The
  callback exchanges the code with the same URI (the browser followed it to get there). `/app/login`
  reached under a name with no registered callback (the machine's wifi address next to its ethernet one)
  first moves the browser to `WEB_PUBLIC_URL`.
- **Blueprint:** `redirect_uris` is `!If WEB_PUBLIC_URL` → [local, `<WEB_PUBLIC_URL>/auth/clerk/callback`],
  else [local]; strict matching. Compose passes `WEB_PUBLIC_URL` to both Authentik containers and both
  variables to the api.
- The startup log prints `Web panel open to: …` and warns when the allowlist is set without a public URL
  while Authentik is on loopback (other machines would pass the gate but could not sign in).

## Failure surface (before/after)

| Scenario                                                 | Before                                            | After                                                                   |
| -------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------- |
| Laptop on the LAN opens `http://192.168.50.141:8085/app` | loads, sign-in sent to the laptop's own localhost | signs in via `192.168.50.141:9000`, comes back to `192.168.50.141:8085` |
| Same, via the server's second address                    | same                                              | moved to `WEB_PUBLIC_URL` first, then as above                          |
| Browser on the server, `localhost:8085`                  | works                                             | works (loopback, or the container gateway)                              |
| Client outside `WEB_ALLOWED_NETWORKS` on `/app`          | loads the login redirect                          | 403 page naming the setting                                             |
| Its cookie on `/shared/<private>`                        | n/a                                               | ignored, redirected to sign in                                          |
| Forged `Host` header                                     | n/a                                               | never used to build a URL; only `WEB_PUBLIC_URL`'s host is recognised   |
| Both variables empty                                     | as today                                          | as today                                                                |

## Verification

- `tests/test_remote_access.py` (20 tests): settings validation; allowlist semantics incl. IPv6-mapped
  addresses and the container gateway read from a fake route table; 403 on `/app` paths but not on
  `/health`, `/static`, `/shared`; the cookie not travelling; `front_channel` for the public host, for
  localhost, for foreign `Host` values, for a real-named Authentik, for an IPv6 public host; `/app/login`
  on each kind of host; the callback's exchange URI; the refused web callback never spending the code.
- `tests/test_bridge.py`: a browser handshake from outside the list is refused despite a valid cookie,
  inside it is accepted, an extension token from outside is still accepted.
- **Mutations**, each reverted with an edit: reading `REMOTE_ADDR` in the bridge failed the bridge test;
  treating any non-loopback `Host` as the public host failed the front-channel test.
- Full suite: 223 passed.
- **Live, throwaway container on the branch code** (DB clone, random secret, port 18085 on loopback and the
  LAN address, stopped afterwards): with `192.168.50.0/24` both `localhost` (seen as `192.168.0.1`) and the
  LAN address pass, and `/app/login` via the LAN address answers `307 http://192.168.50.141:9000/…
redirect_uri=http://192.168.50.141:18085/auth/clerk/callback`; with `10.9.9.0/24` the LAN address gets
  403 and localhost still passes; the startup log lists `loopback, 192.168.0.1 (container gateway, i.e.
this host), 10.9.9.0/24`.
- **Authentik:** the new blueprint validated inside the running worker with `Importer.validate()` and an
  explicit `transaction_rollback()` (nothing persisted; the provider still lists only the localhost URI
  afterwards). Resolved `redirect_uris`: with `WEB_PUBLIC_URL=http://192.168.50.141:8085`, the localhost
  and the public callback, both strict; without it, the localhost one only. The live Authentik answers on
  the LAN address (`302` into its login flow for the registered localhost callback) and rejects the
  public callback with "Redirect URI Error", which is exactly the step still to be applied.

## Deployed (2026-09-23)

In `self-hosted-cloudapi/.env`:

```bash
WEB_PUBLIC_URL=http://192.168.50.141:8085
WEB_ALLOWED_NETWORKS=192.168.50.0/24
```

then, from a checkout of the top branch,

```bash
docker compose up -d --build
docker compose exec auth_worker ak apply_blueprint custom/tumble-code.yaml
```

Checked afterwards on the live stack:

- api startup log: `Web panel open to: loopback, 192.168.0.1 (container gateway, i.e. this host),
192.168.50.0/24` and `Web panel public URL: http://192.168.50.141:8085`; `DB state: MANAGED`, no
  migration pending (no branch in the stack adds one).
- The provider's `redirect_uris`: the localhost and the `192.168.50.141:8085` callback, both strict.
- `/app/login` via localhost goes to `localhost:9000` with the localhost callback; via `192.168.50.141`
  to `192.168.50.141:9000` with the public callback, and Authentik now answers that with `302` into its
  login flow (it was "Redirect URI Error" before the blueprint was applied); via the wifi address
  `192.168.50.134` it is first moved to the public URL.
- A request from another container on this host (default bridge, `172.17.0.0/16`) arrived as
  `192.168.0.1` and was admitted as this host: connections that start on the host pass through
  docker-proxy. The 403 itself was verified on the throwaway container (allowlist `10.9.9.0/24`, the LAN
  address refused); a genuinely remote client cannot be produced from this machine.

**Keep the checkout off `main` while this runs.** `./authentik/blueprints` is mounted into Authentik from
the working tree and a changed file is re-applied, so checking out a revision without the `WEB_PUBLIC_URL`
entry drops the public callback until the stack is back on a branch that has it.

## Notes / caveats

- Only IP addresses and networks, not host names: a client's name would need DNS at request time.
- One public URL. A second address (wifi and ethernet) is handled by moving the browser to the public one.
- Where every connection is proxied (rootless Docker, a userland proxy for all traffic) every client
  appears as the gateway and the list cannot tell them apart; behind a reverse proxy uvicorn needs
  `FORWARDED_ALLOW_IPS` to trust its `X-Forwarded-For`. Both are in the README.
- Share URLs handed to the extension are still built from `API_BASE_URL` (`localhost`); not part of this.
- The extension's own sign-in (`/extension/sign-in`) also follows `WEB_PUBLIC_URL`, so VS Code on
  another machine pointed at the public URL can sign in too; it is not gated by the allowlist.
