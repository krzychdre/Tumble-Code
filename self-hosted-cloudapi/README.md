# Self-Hosted Tumble Code Cloud API

The cloud service for the Tumble Code extension, run on your own machine: sign-in through Authentik, task sharing,
telemetry and cost metrics, the live remote-control bridge and a web panel for your tasks.

## What it does

The extension and the CLI work fully without it. Run it and sign in, and you also get:

- **Your tasks in a browser.** The web panel at `/app` lists every task from VS Code and the CLI, with subtasks as a
  tree, filters, cost, tokens and duration, and shows each conversation the way the chat does.
- **Remote control.** Open a task while it runs, from any machine or your phone, and follow it live: send it a
  message, approve or deny what it asks, switch auto-approval, stop it and resume it.
- **Sharing.** "Share task" in the extension gives a read-only link, `/shared/<task id>`.
- **Metrics.** Tokens, cost and time per model, mode and client (VS Code or CLI) over a period you choose, summed
  per project or per model, and narrowed to one project or model with one click.
- **Problem report.** Errors the extension ran into (`/app/diagnostics`), with the model, the context size and the end
  of the request and the response, plus a Markdown brief you can hand to an agent to fix them.
- **LLM exchange dataset**, off until you switch it on at `/app/dataset/recording`: records what the agent sent to the model
  and got back, and exports it anonymized as JSONL.
- **Organizations.** Groups in Authentik make organizations; the extension's organization switcher then decides
  whether a task belongs to an organization or to your personal space. `/app/organizations` lists them read-only.
  See [Organizations](#organizations).
- **Retention.** At `/app/settings` you choose after how many days old tasks and telemetry are deleted (by default
  nothing is).

Everything stays in this stack: the extension sends its telemetry only to the cloud you sign in to.

## Run it on your machine, step by step

This brings up the whole stack on one machine with Docker Compose: the API with its PostgreSQL, and Authentik (the
sign-in server) with its own PostgreSQL. Authentik is configured automatically from a blueprint
([`authentik/blueprints/tumble-code.yaml`](authentik/blueprints/tumble-code.yaml)).

**1. Check the prerequisites.** Docker with the Compose plugin (`docker compose version`), git and openssl. Ports
8085 (API and web panel), 9000 and 9443 (Authentik) and 5544 (Authentik's database) must be free. Authentik asks for
at least 2 CPU cores and 2 GB of RAM.

**2. Get the code.**

```sh
git clone https://github.com/krzychdre/tumble-code.git
cd tumble-code/self-hosted-cloudapi
```

**3. Create `.env` and its secrets.** Copy the template, then fill the six secrets with random values:

```sh
cp .env.example .env
for name in SECRET_KEY JWT_SECRET AUTHENTIK_CLIENT_SECRET AUTHENTIK_API_TOKEN AUTH_PG_PASS AUTHENTIK_SECRET_KEY; do
  sed -i.bak "s|^$name=.*|$name=$(openssl rand -hex 32)|" .env
done
rm .env.bak
```

Then open `.env` and set `AUTHENTIK_BOOTSTRAP_PASSWORD` to the password you want for the administrator account
`akadmin`, and `AUTHENTIK_BOOTSTRAP_EMAIL` to its e-mail address. You sign in to Tumble Code with this account. The
other values can stay as they are for a local stack; `DATABASE_URL` in `.env` is not used by Compose.

**4. Start the stack.**

```sh
docker compose up -d --build
```

The first start downloads the images, builds the API and lets Authentik set up its database, which takes a few
minutes. The API creates its own tables on start.

**5. Check that it runs.**

```sh
docker compose ps                                 # every service "running", the api "healthy"
curl http://localhost:8085/health/ready           # {"status":"ready",...} once the database answers
docker compose logs auth_worker | grep -i blueprint   # the Tumble Code blueprint was applied
```

**6. Sign in to the web panel.** Open http://localhost:8085/app. It sends you to Authentik on port 9000; sign in as
`akadmin` with the password from step 3. You come back to an empty task list.

**7. Connect VS Code.** In VS Code settings set `tumble-code.cloudApiUrl` to `http://localhost:8085`. Without it the
extension looks for a cloud that does not exist. Then click the cloud icon in the title bar of the Tumble Code panel,
choose **Connect to Tumble Code Cloud**, sign in as `akadmin` in the browser that opens, and allow the browser to
open VS Code. If it cannot, use **Having trouble?** and paste the address the browser ended on. The Cloud view then
shows your account, with **Task sync** on.

In a Remote SSH window the extension runs on the server: set `tumble-code.cloudApiUrl` in the "Remote [SSH: ...]"
settings tab, and remember that `localhost` there means the server.

**8. See a task arrive.** Start any task in Tumble Code and reload http://localhost:8085/app: the task is listed, and
its page shows the conversation live, with the message box and the Stop, Resume, Approve and Deny controls.

**9. Optional: open the panel from other machines.** Out of the box every address is `localhost`. To use the panel
from a laptop or a phone on your network, see [Opening the web panel from other machines](#opening-the-web-panel-from-other-machines).

## Connect the CLI

Add the cloud to `~/.roo/cli-settings.json`:

```json
{
	"cloudApiUrl": "http://localhost:8085"
}
```

Then sign in with `tumble auth cloud login` (it opens the browser; on a machine without one, open the printed address
elsewhere and paste back the address the browser ends on), and check with `tumble auth cloud status`. Inside the
interactive CLI, `/login` and `/logout` do the same. While signed in, the status line shows `● cloud`, and CLI tasks
appear in the panel with a "CLI" badge.

## Everyday operation

- **Logs:** `docker compose logs -f api` (the API), `docker compose logs -f auth_server auth_worker` (Authentik).
- **Stop and start:** `docker compose stop` and `docker compose start`. `docker compose down` removes the containers
  but keeps the data.
- **Where the data is:** in `./.vol/` next to this file (`postgres` for the API, `auth` for Authentik). Deleting that
  folder deletes every task and account.
- **Update:** `git pull`, then `docker compose up -d --build`. The API migrates its database on start. Authentik is
  pinned to a version; to move it, follow [Upgrading the bundled Authentik](#upgrading-the-bundled-authentik). An
  install whose `.env` has no `AUTHENTIK_API_TOKEN` must first follow
  [Updating an install without AUTHENTIK_API_TOKEN](#updating-an-install-without-authentik_api_token): Compose
  refuses to start without it.
- **Back up the API's database:**
  `docker compose exec -T postgres pg_dump -U roo -Fc roo_cloud > tumble-cloud-$(date +%F).dump`
- **More users:** in Authentik (http://localhost:9000, as `akadmin`) create the user under Directory > Users and add
  them to the group **Tumble Code Users**; only members of that group may sign in. Each user sees their own tasks.
- **Organizations:** see [Organizations](#organizations).
- **Address clash:** the stack's network is pinned to `10.99.0.0/24`. If your network already uses that range, change
  the subnet at the end of `docker-compose.yml`.

### Updating an install without AUTHENTIK_API_TOKEN

Organizations come from Authentik groups (see [Organizations](#organizations)), and the API reads those groups with
the token `AUTHENTIK_API_TOKEN`. An install set up before that has no such line in `.env`, and `docker compose up`
stops with "set AUTHENTIK_API_TOKEN in .env". Do this once, in this folder, before the update:

```sh
cp .env .env.backup-$(date +%F)
echo "AUTHENTIK_API_TOKEN=$(openssl rand -hex 32)" >> .env
git pull
docker compose up -d --build
docker compose exec auth_worker ak apply_blueprint custom/tumble-code.yaml
```

`up -d` recreates the API and both Authentik containers, so all of them see the new variable. Applying the blueprint
creates the service account `tumble-code-cloudapi` and gives it a token with that key; without this step the API
logs "could not read Authentik's groups" every five minutes. Organizations created on the web panel before this
change are not carried over: if your database has any (`docker compose exec -T postgres psql -U roo roo_cloud -c
'select slug, name from organizations'`), recreate them as Authentik groups with the same slug in
`tumble_organization`; a row without a slug keeps its tasks and loses its members at the first sync.

## Organizations

An organization is a shared space: tasks run while it is selected in the extension's organization switcher belong to
it, and its projects and recall settings are shared by its members. Organizations and their members are managed in
Authentik, not in the web panel, which only lists them (`/app/organizations`, under Settings, with a link to
Authentik's groups).

Project names are unique in an organization and in a personal space, whatever the letter case. When a new project
would take a name the space already has, for example two members' folders without git both called `notes`, it is
named `notes (bob)` after its member's e-mail (a repository after its owner, such as `api (acme)`), with a number
added if that is taken too. The API logs a warning, and the project's page and the Projects list say so until
someone who manages the project saves a name for it.

In Authentik (http://localhost:9000, as `akadmin`), under Directory > Groups:

1. Create a group for the organization. Its name is the organization's name. In **Attributes** set
   `tumble_organization: acme`, where `acme` is a short key that never changes (renaming the group renames the
   organization; changing the key makes a new one). Add the members to the group.
2. Optionally create a second group with `tumble_organization_admins: acme` for the organization's admins. An admin
   counts as a member even when not in the first group. Admins manage the recall settings of the organization's
   projects.

The API copies the groups at start, every five minutes and whenever someone signs in, so removing a person from a
group takes effect within five minutes even if they never sign in again. Only direct members of a group count (not
members of its child groups), and a user deactivated in Authentik counts as no member. A person who has never signed
in to the cloud is added at their first sign-in. An organization whose groups were deleted keeps its tasks and loses
its members.

The API reads the groups with the API token `AUTHENTIK_API_TOKEN`. The bundled blueprint creates everything it needs:
the service account `tumble-code-cloudapi`, the role **Tumble Code cloud API** that may only view groups, and a token
with the key from `.env` that does not expire. If Authentik cannot be read (a wrong token, Authentik down), the API
logs a warning, keeps the memberships it has, and sign-in still works.


## Configuration reference

### Authentik addresses

> **Front-channel vs back-channel URLs.** `AUTHENTIK_BASE_URL`
> (`http://localhost:9000`) is what the _browser_ is redirected to;
> `AUTHENTIK_INTERNAL_URL` (`http://auth_server:9000`) is what the _api container_
> uses for server-to-server calls (token/userinfo/jwks). Both are preset in
> `docker-compose.yml`; only change them if you front Authentik with a real
> domain/reverse proxy (then point `AUTHENTIK_BASE_URL` at the public domain and
> leave `AUTHENTIK_INTERNAL_URL` as the in-network service URL).
>
> **Why the api overrides the `Host` header on back-channel calls.** Authentik
> resolves a request's _brand_ (and therefore serves its `/application/o/*`
> routes) from the HTTP `Host` header, and rejects hosts containing an
> underscore (`auth_server` is not a valid RFC-1123 hostname) with a **404**.
> So the api connects to `AUTHENTIK_INTERNAL_URL` for networking but sends the
> _front-channel_ host (the host of `AUTHENTIK_BASE_URL`, e.g. `localhost:9000`
> or `auth.tumblecode.dev`) as `Host`. This is automatic (you don't configure
> it), and it is why the underscore in the default `auth_server` service name is
> harmless. If back-channel token exchange ever 404s, this is the mechanism to
> look at (see [`config/auth.py`](config/auth.py) → `get_back_channel_host_header`).

### Production example (public address)

For a public deployment where the API is served at `https://app.tumblecode.dev`
and Authentik at `https://auth.tumblecode.dev`, set in `.env`:

```bash
API_BASE_URL=https://app.tumblecode.dev
AUTHENTIK_BASE_URL=https://auth.tumblecode.dev        # front-channel; also sent as Host on back-channel
AUTHENTIK_INTERNAL_URL=http://auth_server:9000        # back-channel (in-cluster service name)
AUTHENTIK_REDIRECT_URI=https://app.tumblecode.dev/auth/clerk/callback
AUTHENTIK_CLIENT_SECRET=<openssl rand -hex 32>        # REQUIRED: the provider is confidential
```

The api sends `Host: auth.tumblecode.dev` (taken from `AUTHENTIK_BASE_URL`) on
every back-channel call, so Authentik resolves the brand correctly even though
the connection targets the internal service name. The provider's `client_type`
is `confidential`, so a matching `AUTHENTIK_CLIENT_SECRET` is mandatory.

### Opening the web panel from other machines

Out of the box every URL in the sign-in round trip is `localhost`, which on
another machine means that machine. To open the panel from, say, a laptop on
the same LAN, set in `.env` the address the laptop uses and who may use it:

```bash
WEB_PUBLIC_URL=http://192.168.50.141:8085   # scheme://host[:port], no path, no trailing slash
WEB_ALLOWED_NETWORKS=192.168.50.0/24        # IPs and CIDR networks, comma separated
```

then recreate the stack and apply the blueprint (Authentik re-reads it only
when the file changes, not when the environment does):

```bash
docker compose up -d --build
docker compose exec auth_worker ak apply_blueprint custom/tumble-code.yaml
```

- A browser that opens the panel on `WEB_PUBLIC_URL`'s host signs in through
  Authentik on that same host (port from `AUTHENTIK_BASE_URL`) and comes back to
  `<WEB_PUBLIC_URL>/auth/clerk/callback`, which the blueprint registers next to
  the local callback. Opening `localhost:8085` on the server keeps working as before.
- `WEB_ALLOWED_NETWORKS` empty means any client that can reach the port. Once
  set, everything under `/app` answers 403 to other clients, and their session
  cookie is ignored elsewhere too. Loopback and, in Docker, the host itself
  (it arrives from the compose network's gateway) are always allowed. Public
  share links (`/shared/<id>`) stay public; the extension API is not affected.
- The startup log prints `Web panel open to: …` with the effective list.
- Trusted web origins: `API_BASE_URL`, `WEB_PUBLIC_URL` and the extra entries
  of `CORS_ORIGINS` (usually empty). Only these pages get a CORS grant, and
  the live bridge refuses a browser connection from any other page (a page on
  the address the request was sent to is accepted too). The extension connects
  from Node without an `Origin` header and is not affected. `CORS_ORIGINS=*`
  from an older `.env` is ignored with a startup warning; the startup log
  prints `Trusted web origins: …`.
- A state-changing request that carries the panel's session cookie (the
  delete and retention forms) is refused with 403 unless its `Origin` (or,
  without one, its `Referer`) is a trusted origin or the address the request
  was sent to. The session cookie is `Secure` when the browser reached the
  panel over https (directly, or through a proxy on the host of an https
  `API_BASE_URL` or `WEB_PUBLIC_URL`).
- `./authentik/blueprints` is mounted into Authentik straight from the
  checkout, and Authentik re-applies the blueprint whenever the file changes.
  Checking out a revision without the `WEB_PUBLIC_URL` entry while the stack
  runs makes Authentik drop the public callback again.
- The check uses the real client address, which Docker's default port
  publishing preserves. With rootless Docker every client appears as the
  gateway, and behind a reverse proxy uvicorn needs `FORWARDED_ALLOW_IPS` to
  trust its `X-Forwarded-For`.

> **Blueprint troubleshooting.** The provider/app are created by the worker on
> first boot. Check it applied with `docker compose logs auth_worker | grep -i
blueprint`, or in the Authentik UI under **System → Blueprints**. The blueprint
> schema is Authentik-version-sensitive; if it errors, adjust
> `authentik/blueprints/tumble-code.yaml` for your `AUTHENTIK_TAG`.

## Running the API without Docker

Requires Python 3.12+, [uv](https://docs.astral.sh/uv/getting-started/installation/),
a PostgreSQL 16+ you control, and an Authentik instance.

```bash
cp .env.example .env          # set DATABASE_URL + the AUTHENTIK_* values

# Install dependencies
uv sync

# Create the schema on an empty database, or migrate an existing one
make migrate                  # same as: sh ./db-migrate.sh

# Start the server
uv run uvicorn src.main:app --reload --host 0.0.0.0 --port 8085
```

`make migrate` runs the same schema step as the container on start
([`db-migrate.sh`](db-migrate.sh)). Do not run a bare `alembic upgrade head` on
an empty database: the first migration is a no-op baseline and the next one
alters tables that only the ORM models' `create_all` creates, so it fails.
[`src/db_bootstrap.py`](src/db_bootstrap.py) tells the three cases apart
(FRESH: build the schema and stamp head; LEGACY: tables without Alembic
history, stamp the baseline and upgrade; MANAGED: upgrade).

The server itself never creates or alters tables, so run `make migrate` before
the first start and again after every update that brings a new migration.

For a non-compose deployment, leave `AUTHENTIK_INTERNAL_URL` unset; it falls
back to `AUTHENTIK_BASE_URL`.

A [`Makefile`](Makefile) wraps these commands (`make help`, `make dev`,
`make docker-up`, …).

## Configuring the Tumble Code Extension

In VS Code, open Settings (`Ctrl+,` / `Cmd+,`) and search for `tumble-code` to configure these settings:

| VS Code Setting            | Environment Variable  | Description                                                                           |
| -------------------------- | --------------------- | ------------------------------------------------------------------------------------- |
| `tumble-code.cloudApiUrl`  | `TUMBLE_CODE_API_URL` | URL of your self-hosted API (e.g., `http://localhost:8085`)                           |
| `tumble-code.clerkBaseUrl` | `CLERK_BASE_URL`      | URL of the Clerk-compatible auth facade (auto-detected from `cloudApiUrl` if not set) |

> **Auto-detect:** When `clerkBaseUrl` is not explicitly configured, the extension
> automatically uses the same URL as `cloudApiUrl` for Clerk auth requests. This means
> that for self-hosted deployments, you only need to set `cloudApiUrl`: the extension
> will automatically send auth requests (like ticket validation) to your self-hosted API
> instead of the production Clerk.
>
> You only need to set `clerkBaseUrl` explicitly if you want the Clerk auth endpoint
> to be different from `cloudApiUrl` (which is rarely needed).
>
> **Important:** If you do set `clerkBaseUrl` manually, it must point to your self-hosted API,
> **not** to Authentik. The self-hosted API serves the Clerk-compatible endpoints
> (`/v1/client/sign_ins`, etc.) that the extension calls after the browser-based OAuth
> flow completes. If `clerkBaseUrl` is left pointing at the production Clerk
> (`https://auth.tumblecode.dev`), the ticket exchange will fail because the production
> Clerk has no knowledge of users created in your self-hosted instance.

### Authentication Flow

1. The extension opens the browser to `/extension/sign-in?state=...&auth_redirect=vscode://...`
2. The API redirects to Authentik for OAuth authentication
3. After Authentik authentication, the browser is redirected to `/auth/clerk/callback`
4. The API exchanges the OAuth code, creates a user/session, generates a ticket,
   and returns an HTML page that navigates back to `vscode://...`
5. The VS Code extension receives the ticket and calls `/v1/client/sign_ins` on
   `clerkBaseUrl` to complete sign-in

`auth_redirect` accepts only two shapes; anything else gets a 400 before a state row is stored, and the
callback re-checks the stored value before it mints a ticket:

- an editor callback, `<scheme>://<publisher>.<name>` and nothing after it (`vscode://QUB-IT.tumble-code`,
  `cursor://...`), answered with the HTML page above;
- a CLI loopback callback (RFC 8252 section 7.3): exactly `http://127.0.0.1:<port>`, `http://localhost:<port>`
  or `http://[::1]:<port>`, lowercase, port 1024 to 65535 without a leading zero, no path, query, fragment or
  trailing slash. The callback answers it with a 303 straight to
  `<auth_redirect>/auth/clerk/callback?code=<ticket>&state=<state>`. When the CLI runs on another machine the
  browser cannot reach that port, but the address bar keeps the whole URL for the user to paste into the
  terminal.

### Troubleshooting

**"Failed to handle Tumble Code Cloud callback: Error: HTTP 400: Bad Request" after Authentik login:**

- This error occurs when the extension tries to validate the auth ticket against the production Clerk (`https://auth.tumblecode.dev`) instead of your self-hosted API
- Ensure `tumble-code.cloudApiUrl` is set to your self-hosted API URL (e.g., `http://localhost:8085`)
- The extension should auto-detect the Clerk base URL from `cloudApiUrl`; if it doesn't, explicitly set `tumble-code.clerkBaseUrl` to the same URL as `cloudApiUrl`
- Check the VS Code developer console (Help > Toggle Developer Tools) for network requests to verify the ticket is being sent to the correct URL

**"Waiting for browser authentication" hangs after Authentik login:**

- Check the browser's developer console for errors in the callback page
- Verify the Authentik redirect URI is set to `{API_BASE_URL}/auth/clerk/callback`
- Check the API server logs for errors during the token exchange or user creation

**`502 Bad Gateway` on `/auth/clerk/callback` right after Authentik login:**

- This is the API's own error page, returned when the **back-channel token
  exchange** to Authentik fails, not a reverse-proxy error.
- Check the API logs: `docker compose logs api | grep -i "token exchange"`.
  A `404 Not Found` for `…/application/o/token/` means Authentik rejected the
  request's `Host`. The api derives that `Host` from `AUTHENTIK_BASE_URL`, so
  ensure it is a valid hostname (no underscores) and points at the host your
  Authentik brand serves. See _Why the api overrides the `Host` header_ above.
- A `400 invalid_client` instead means `AUTHENTIK_CLIENT_SECRET` is missing or
  does not match the value the blueprint provisioned (the provider is confidential).

## Authentik Setup

1. Deploy Authentik with Docker Compose
2. Create an OAuth2 Provider with:
    - Client type: Confidential
    - Redirect URI: `{API_BASE_URL}/auth/clerk/callback`
    - Scopes: `openid`, `profile`, `email`
    - Grant types: Authorization Code (Authentik 2026.5 and later refuse
      every grant type a provider does not list)
3. Create an Application using this provider
4. Set `AUTHENTIK_CLIENT_ID` and `AUTHENTIK_CLIENT_SECRET` in your `.env`
5. For [organizations](#organizations): create a role with the single permission "Can view Group"
   (`authentik_core.view_group`), a user of type Service account with that role, and an API token for that user
   that does not expire. Put the token's key in `AUTHENTIK_API_TOKEN`.

### Upgrading the bundled Authentik

The compose file pins Authentik 2026.8.3 by tag and digest. Authentik
migrates its database when it starts, the migration cannot be undone, and
since 2026.8 it refuses to start on a database more than one release line
behind ("Major version skips are not allowed"). An existing install therefore
steps through the latest patch of every line in between, for example
2026.2.x, then 2026.5.7, then 2026.8.3, waiting for each step to finish its
migrations and report healthy before the next one:

```bash
# Before the first step: dump Authentik's database.
docker compose exec -T auth_db pg_dump -U authentik -Fc authentik > authentik-$(date +%F).dump

# Each step: set AUTHENTIK_TAG in .env to the step's tag, then
docker compose pull auth_server auth_worker
docker compose up -d --no-deps auth_server auth_worker
docker compose logs -f auth_server auth_worker   # until both are healthy
```

Remove `AUTHENTIK_TAG` from `.env` after the last step so the pinned default
applies again. Rolling back means restoring the dump into an empty `auth_db`
and starting the previous image; starting an older image on a migrated
database is not supported.

## API Endpoints

`tests/test_route_table.py` pins every path, method and route name the app serves; read it for the complete list.
In short:

- Clerk-compatible auth facade, called by the extension on `clerkBaseUrl`: `POST /v1/client/sign_ins`,
  `POST /v1/client/sessions/{id}/tokens`, `GET /v1/me`, `GET /v1/me/organization_memberships`,
  `POST /v1/client/sessions/{id}/remove`.
- Browser sign-in: `GET /extension/sign-in` (redirects to Authentik), `GET /auth/clerk/callback`, `GET /auth/error`,
  and `GET /app/login`, `POST /app/logout` for the web panel.
- Extension API on `cloudApiUrl`: `GET /api/extension-settings`, `PATCH /api/user-settings`,
  `POST /api/extension/share`, `GET /api/extension/bridge/config`, `POST /api/events`, `POST /api/events/backfill`,
  `POST /api/error-reports` (one problem with its model, context size, request and response; sent only while the
  extension is signed in, duplicates by id ignored, 1 MB limit), `GET /api/llm-exchanges/config`,
  `POST /api/llm-exchanges` and `POST /api/llm-exchanges/outcome` (LLM exchange recording for the training
  dataset: only when the user switched it on at `/app/dataset/recording`; incremental, gzip, 32 MB limit).
- Web panel: `/app` (task list, grouped by project, model or user with `group=` and narrowed to one group with
  `only=`; a project is the one of the projects page, so every clone and worktree of a repository is one group, and
  `project=` and `only=` carry its id; a bare `/app` reopens the view last looked at; task pages, metrics at `/app/metrics` (summed per project
  or model with `group=`, the whole page narrowed to one group with `only=`), the problem report at `/app/diagnostics` with filters in the
  query string, one report at `/app/diagnostics/reports/{id}`, and the agent brief as Markdown for the filtered
  list at `/app/diagnostics/report.md` and for one problem at `/app/diagnostics/problems/{key}/brief.md`,
  the dataset tabs at `/app/dataset` (overview), `/app/dataset/export` (the anonymized JSONL export and its audit),
  `/app/dataset/tasks` (the full reconstruction of one task at `/app/dataset/tasks/{task_id}.jsonl`) and
  `/app/dataset/recording`, settings, the projects list at `/app/projects` with its filters in the query string
  (`q`, `space`, `recall`, `renamed`) and one project's page at `/app/projects/{id}`, and the read-only organizations at
  `/app/organizations`) and
  `/shared/{task_id}` for shared tasks.
- Live bridge: socket.io at `/bridge/socket.io` (`BRIDGE_PATH`).
- Health: `GET /health` (process alive), `GET /health/ready` (database reachable).

## Architecture

See [docs/08-cloud.md](../docs/08-cloud.md) for how the extension's cloud client and this service fit together: the
sign-in flow, the data model, how task rows arrive, background work, the database bootstrap and the web panel.

## License

Apache 2.0, like the rest of the repository: see [LICENSE](../LICENSE).
