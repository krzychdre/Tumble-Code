# Cross-session recall from the self-hosted cloud: design

**Status:** design approved in outline on 2026-10-26 (organizations in scope, default scope `none`, native tools,
real Postgres in CI). Phase 1 done on `feat/recall-organizations`; phases 2 to 4 stacked on it.
**Related plans:** `ai_plans/archive/2026-07/2026-07-31_agent-interchange.md` (local session reading),
`ai_plans/2026-10-02_llm-exchange-dataset.md` (anonymizer, cloud-side settings switch).
**Would touch:** `self-hosted-cloudapi/src/models/`, new `services/organizations.py`, `services/projects.py`,
`services/recall_*.py`, routers and web pages for them, `src/realtime/sio.py` (tenant and project on register),
`.github/workflows/cloudapi.yml` (Postgres service), `src/utils/git.ts`, two native tools in `src/core/tools/` and
`src/core/prompts/tools/native-tools/`, `src/core/prompts/tools/filter-tools-for-mode.ts`, `packages/cloud`.

## Goal

A Tumble Code task (extension or CLI) can look up earlier sessions: its own, other members' in the same project,
or sessions of other projects of the same organization, as far as each project's policy allows. Target scale:
millions of sessions, hundreds of users per organization. A search must answer in tens of milliseconds and cost
the extension one HTTP request. The cloud enforces every rule; the client cannot widen its view.

## What exists today (measured on the live database, 2026-10-26)

| Fact                                                  | Value / place                                                                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Tasks, users, distinct `workspace_path`               | 1470, 1, 24                                                                                                         |
| Stored messages                                       | 166 214 rows, 396 MB of `message_data`                                                                              |
| of which tool messages (`q_kind = 'tool'`)            | 40 133 rows, 150 MB                                                                                                 |
| of which completion results (`q_kind = 'completion'`) | 2 270 rows, 6.5 MB                                                                                                  |
| Organizations                                         | tables `organizations`, `memberships` (roles `org:member`, `org:admin`) exist, 0 rows, no page creates them         |
| Organization in the session token                     | `POST /v1/client/sessions/{id}/tokens` takes `organization_id`, checks membership and puts it in the JWT            |
| Organization switch in the extension                  | `CloudService.switchOrganization`, `webview-ui/src/hooks/useOrganizationSwitch.ts`                                  |
| Organization of a task                                | `tasks.organization_id` exists but is never written; the bridge reads only the user from its token                  |
| Postgres                                              | 16.15 (Alpine image, contrib modules such as `btree_gin` available), extensions in use: `plpgsql`                   |
| Project concept                                       | none. `tasks.workspace_path` is a machine-local absolute path                                                       |
| Per-task summary already on the row                   | `title`, `prompt_excerpt`, `models`, `q_completed`, `first_ts/last_ts`                                              |
| Touched files per message                             | `task_messages.tool_path` (`<tool>:<path>`)                                                                         |
| Secret scrubbing                                      | `services/anonymizer.py`, rule 1 (secrets)                                                                          |
| Background loop pattern                               | `services/retention_scheduler.py`                                                                                   |
| Tool gating precedent                                 | `filterNativeToolsForMode` drops `codebase_search` when the code index is not ready                                 |
| Repository identity in the extension                  | `src/utils/git.ts` `getGitRepositoryInfo` (sanitized https remote); fails in a git worktree, where `.git` is a file |

The useful knowledge of a session (what was asked, what was concluded, which files were touched) is about 2 % of
the stored bytes. The search therefore runs over a small per-session card, never over raw conversations.

## Design

### 1. Tenants and organizations

Every session, project and card belongs to exactly one **tenant**: an organization, or the personal space of one
user. The tenant of a task is the organization active in the extension when the task ran (the JWT's org claim,
empty for the personal space). Nothing is ever visible across tenants, which is also what makes the search cheap:
every query is confined to one tenant before anything else is looked at.

Organizations and memberships come from Authentik, the identity provider the cloud signs users in with; the cloud
keeps a copy so tasks, projects and the session token can refer to an organization by id:

- an Authentik group with the attribute `tumble_organization: "<slug>"` is an organization: `organizations.slug` is
  the slug (the stable key), `organizations.name` the group's name, its direct active members are `org:member`;
- a group with `tumble_organization_admins: "<slug>"` lists the organization's admins (`org:admin`), who are members
  even when not in the first group;
- people are matched by Authentik's user `uid`, which is the OIDC `sub` under the provider's `hashed_user_id` mode
  and so equals `users.authentik_id`; a person who never signed in to the cloud has no user row and is skipped until
  the first sign-in;
- one reconcile (`services/organizations.py`) creates and renames organizations by slug and adds, removes and
  re-roles memberships. An organization whose groups are gone keeps its row (tasks and projects point at it) and
  loses its members. It runs at startup, every five minutes and after every sign-in (web and extension share the
  callback), so a removal takes effect without the person signing in again. If Authentik's API cannot be read, the
  memberships stay as they are and the sign-in goes on;
- the API reads `GET /api/v3/core/groups/` with `AUTHENTIK_API_TOKEN`; the bundled blueprint provisions a service
  account whose role may only view groups, and a non-expiring token with that key;
- the web panel only shows organizations (`/app/organizations`: the list, an organization's members and roles) and
  links to Authentik's groups page.

The bridge keeps the org claim of the socket's token, and new task rows get `organization_id` from it.

### 2. Projects and folder bindings

Table `projects`: `id` (`prj_...`), `organization_id` (null for a personal project), `user_id` (creator; owner of a
personal project), `key`, `name`, `recall_scope` (default `none`), timestamps. Unique: (`organization_id`, `key`)
for organization projects, (`user_id`, `key`) for personal ones.

Table `project_bindings`: (`user_id`, `organization_id`, `workspace_path`) -> `project_id`, unique on the first
three. A binding says "this folder of this user, in this tenant, is that project".

Resolution, when the extension reports a folder (`extension:register` and `GET /api/recall/context`, both carrying
`workspacePath` and, if there is one, `repositoryUrl`):

1. a binding exists: use its project;
2. otherwise, with a git remote: key = normalized remote (lower-cased host and path, no scheme, no credentials,
   no `.git`, ssh and https spellings equal); find or create the project with that key in the tenant; bind;
3. otherwise (no git, or no remote): create a project keyed `folder:<sha256(user_id, workspace_path)>`, named after
   the folder; bind.

A folder without git therefore works at once for its user. To share it with colleagues (whose paths differ), an
admin or the owner rebinds their folders to one project on the projects page, which lists each project's bound
folders and offers "move to project ...". The same action merges two clones of a repository that had no remote.

When a binding is created, the user's tasks in that tenant with the same `workspace_path` and no project are
attached to it; this backfills the existing 1470 tasks as their folders are opened again.

`getGitRepositoryInfo` learns to follow a `.git` file (worktree) to the common git directory, so every worktree of a
repository resolves to the same project.

Projects page (`/app/projects`): the projects of the active tenant with name, key, bound folders, session count and
`recall_scope`. Who may change the name, the bindings and the scope: the owner for a personal project, an
`org:admin` for an organization project.

### 3. Visibility policy

Each project has one `recall_scope`:

| `recall_scope`   | Meaning for the project's own tasks and for its sessions                                             |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| `none` (default) | no recall at all: its tasks get no recall tools, its sessions are found by nobody, no cards are kept |
| `owner`          | a member finds only their own sessions of this project                                               |
| `members`        | a member finds every member's sessions of this project                                               |
| `organization`   | as `members`, plus sessions of every other project of the tenant whose scope is also `organization`  |

The rule for a reader U working in project C and a session card in project P (same tenant always):

- `scope(C) = none`: nothing (the tools are not even offered);
- P = C: `owner` requires `author = U`; `members` and `organization` allow any author;
- P != C: allowed only when `scope(C) = organization` and `scope(P) = organization`.

The rule is symmetric, so a project kept at `members` or `owner` is never reached from another project, and `none`
is a complete ban.

A personal space has one member, so it offers three choices, stored with the same values: `none`, `owner` shown as
"Only this project" and `organization` shown as "All my projects" (the personal projects whose scope is also "All
my projects"). `members` is not offered there.

The client names its folder (`workspacePath`, and `repositoryUrl` when there is one); the cloud derives U and the
tenant from the token and resolves C from the folder within that user and tenant only, exactly as on register. A
client claiming another folder can only reach a project it could open anyway. The predicate is one function, the
logic the tests cover in depth.

### 4. The session card (what is indexed)

Table `session_cards`, one row per task of a project whose scope is not `none`:

- `task_id`, `tenant_id` (organization id or user id), `project_id`, `author_id`, `last_ts`, `completed`;
- display text: title, prompt excerpt, the last completion result in full and earlier ones capped, the user's
  replies to completions, up to 50 distinct touched paths; capped at 6 KB in total;
- `search_vector`: a `tsvector` (Postgres type holding the normalized words of a text with their positions and
  weights), built from the normalized text, weight A for the title, B for completion text, C for the prompt and
  replies, D for paths.

Normalization runs in Python, identically for cards and queries: lower case, Polish and other diacritics folded
(`ł` -> `l`, `ż` -> `z`), identifiers split as well as kept whole (`resolveMaxInlineToolResultBytes` also yields
`resolve`, `max`, `inline`, ...; `task_access.py` yields `task`, `access`, `py`), Polish and English stop words
dropped. The Postgres configuration is then plain `simple`, so no dictionary files are needed on the server.
Stemming (`sesja`/`sesji`) is not in the first version; the benchmark and the search log decide whether it is
needed.

Before storing, rule 1 of the anonymizer (secrets) runs over the display text.

**Building.** A tiny queue table `recall_dirty` (`task_id` primary key, `dirty_at`) is upserted only by the writes
that change a card: a task's first message, a completion, a reply to a completion, a backfill. These are a few
writes per task, not per streamed chunk. A background loop (pattern of `retention_scheduler`) takes up to 100 rows
idle for 10 minutes, rebuilds their cards (skipping and dropping tasks of `none` projects), and deletes the rows.
Changing a project's scope from `none` queues all its tasks; changing it to `none` deletes its cards. Task deletion
and the retention sweep remove cards through `ON DELETE CASCADE`. A task can be excluded by its author
(`tasks.recall_excluded`, a toggle on the task page), which deletes its card.

Storage at scale: about 4 KB of text plus vector per card, so about 8 GB for two million sessions, plus the index.

### 5. Search and its cost

Endpoint `GET /api/recall/search` (contract in section 7):

1. One query resolves U, the tenant, C and `scope(C)`; `none` answers 404 (the tools should not exist).
2. The query text is normalized as above; all remaining words must match (AND), as whole words. There is no prefix
   match: a prefix makes Postgres read the whole posting list of every word it covers into a bitmap, which cost
   up to 100 ms per search at two million cards.
3. Candidates: the newest 100 visible cards that match. Two indexes give them, and the planner picks by the
   estimated number of matches: a btree on (`project_id`, `last_ts`) or (`tenant_id`, `last_ts`) read from the
   newest end when the words are common (the first 100 matches come quickly), and a GIN index (an inverted index:
   for every word the list of rows containing it) on (`project_id`, `search_vector`), through the `btree_gin`
   extension, when they are rare. With the project in the GIN index, a search within one project starts from that
   project's short list instead of a common word's long one. A tenant or author column in the GIN index selected
   almost nothing and made it slower.
4. For the cross-project case the allowed projects are the tenant's `organization`-scoped projects, named by a
   subquery. Joined instead, the planner drove even a one-project search from the projects table into the word
   index.
5. Ranking: the candidates by `ts_rank` times a recency factor that halves every 90 days, times 0.5 for a
   subtask (`session_cards.is_subtask`); the 10 best are returned. A subtask's title and prompt are the long brief a
   delegating agent wrote, and on the live data such briefs filled most hits. Ranking every match instead read most of a tenant for a common word. Snippets are cut in Python from
   the returned cards only (no `ts_headline`).
6. Guard rails: a per-statement timeout (300 ms) that answers "too broad, add a more specific word" instead of
   failing; the server's global rate limit; query length and response size caps. The search also sets
   `plan_cache_mode = force_custom_plan`: asyncpg prepares statements, and the generic plan Postgres keeps after
   five runs cannot see the project or how common a word is.

The extension does no indexing and no prefetch. A search costs one HTTP request and at most about 1500 tokens.

**Benchmark gate (part of phase 3).** A script fills a local Postgres with two million synthetic cards in one
tenant (300 authors, 2000 projects, a realistic Polish and English vocabulary with identifiers) and measures the
p50 and p95 of: one common word, two words, one identifier, a cross-project query, a same-project query. Target:
p95 under 50 ms on the server. Postgres full-text search meets it (results in the progress notes); had it not, the
search module (one function with one caller) would be swapped for a BM25 engine (ParadeDB `pg_search` inside the
same Postgres, or a separate engine such as Meilisearch) without touching the policy or the cards. Embeddings (meaning-based search through
vectors) stay out until the search log shows that keyword search misses what users ask for.

### 6. The interface for the agent: native tools, gated

Two native tools, calling the cloud with the session token the extension already holds:

- `search_past_sessions { query, scope?: "this_project" | "all" (default "all"), max_results? (default 5, max 10) }`
  returns per hit: session id, project name, author, date, title, two snippets of about 300 characters, completed
  or not;
- `read_past_session { session_id, part?: "summary" | "conversation", offset? }` returns the card, or a paged
  slice (8 000 characters) of the user and completion messages, never raw tool output.

Gating: the tools are absent from the tool list (and from the prompt) unless the user is signed in and the
current project's scope is not `none`. The extension learns the scope from `GET /api/recall/context` when a task
starts, cached per folder for five minutes; the gate in `filterNativeToolsForMode` works like the one for
`codebase_search`. `scope = organization` additionally offers `scope: "all"`; otherwise the parameter is absent
from the tool schema, so a weak model cannot ask for what it may not have. The tools carry the folder on every call
and hold no state, so a mode switch changes nothing.

### 7. API contract (extension to cloud)

All three are `GET`, authenticated like every extension call (`Authorization: Bearer <session JWT>`; the JWT's org
claim is the tenant). Field names are camelCase like the rest of the extension API. Folder parameters:
`workspacePath` (required, absolute path of the workspace folder) and `repositoryUrl` (optional, the sanitized https
remote that `getGitRepositoryInfo` returns).

`GET /api/recall/context?workspacePath=&repositoryUrl=` resolves (creating if needed) the folder's project:

```json
{ "projectId": "prj_...", "projectName": "Roo-Code", "scope": "none" }
```

`scope` is one of `none`, `owner`, `members`, `organization`.

`GET /api/recall/search?workspacePath=&repositoryUrl=&q=&scope=this_project|all&limit=&excludeTaskId=`
(`scope` defaults to `all`, `limit` to 5, at most 10; `excludeTaskId` is the asking task, left out of the hits):

```json
{
	"results": [
		{
			"sessionId": "<task id>",
			"projectName": "Roo-Code",
			"author": "Krzysztof Drezewski",
			"lastActivity": "2026-10-26T18:22:00Z",
			"title": "Fix the bridge org claim",
			"completed": true,
			"snippets": ["... about 300 characters around a match ..."]
		}
	],
	"tooBroad": false
}
```

`tooBroad: true` (with empty `results`) means the statement timeout fired; the tool tells the model to add a more
specific word.

`GET /api/recall/sessions/{sessionId}?workspacePath=&repositoryUrl=&part=summary|conversation&offset=0`:

```json
{
	"sessionId": "<task id>",
	"projectName": "Roo-Code",
	"author": "Krzysztof Drezewski",
	"lastActivity": "2026-10-26T18:22:00Z",
	"title": "Fix the bridge org claim",
	"part": "conversation",
	"text": "<at most 8000 characters>",
	"nextOffset": 8000
}
```

`nextOffset` is null on the last page. `summary` is the card text; `conversation` is the user messages and
completion results in order, never tool output.

Errors: 401 not signed in or token expired; 404 for a folder whose project has scope `none`, and for a session the
reader may not see (the same answer as for an unknown one); 400 for an empty or over-long query (200 characters);
429 rate limited (the server's global per-client limit, 60 requests per minute).

## Phases (one branch each, stacked; only the last is pushed)

1. `feat/recall-organizations`: org claim kept by the bridge, `tasks.organization_id` written, the organizations
   pages.
2. `fix/cloud-web-task-list-state` (not part of recall, same stack): the task list keeps its group and filter
   state, groups start closed, the project and model pickers keep offering every value.
3. `feat/recall-projects`: `projects`, `project_bindings`, `tasks.project_id`, resolution on register and on
   `GET /api/recall/context`, the projects page with scope and rebinding.
4. `fix/dataset-exclude-by-project`: the dataset page's "Leave out projects" lists projects, not every worktree
   folder.
5. `feat/recall-search`: `session_cards`, `recall_dirty`, the builder loop, normalization, the policy predicate,
   `/api/recall/search` and `/api/recall/sessions/{id}`, the exclusion toggle, the search log, the Postgres CI
   lane, the benchmark.
6. `feat/recall-extension`: `repositoryUrl` from the extension (register, context, search), the worktree fix in
   `getGitRepositoryInfo`, the two native tools, the gate, the client calls in `packages/cloud`, descriptions
   written for weak models, a changeset (`New:`).
7. `feat/cloud-orgs-from-authentik`: organizations and memberships synchronized from Authentik groups, the
   organization pages read-only.

## Tests (where each lives)

- Cloud, unit (SQLite as today): the organization reconcile from Authentik groups (new, renamed, members and admins
  added and removed, a user who never signed in, vanished groups) and the groups request, project key normalization,
  resolution and bindings, the visibility predicate as a table (each scope pair times owner, other member, same
  project, other project, other tenant), normalization, card building from a recorded conversation.
- Cloud, Postgres lane: the search query and ranking, the GIN index use, the statement timeout. GitHub Actions
  runs a real `postgres:16-alpine` as a job service container; a mock would only test itself, since what can break
  here is Postgres behavior. The tests are marked and run when `RECALL_PG_URL` is set, which the CI job and a local
  run against the compose database set.
- Extension: worktree detection, the tool gate, the tool argument parsing and the mapping of 401, 404, 429 and
  offline to tool results a model can act on.
- No e2e.

## Progress

### Phase 1: organizations (`feat/recall-organizations`)

- The bridge keeps the handshake token's org claim (`_identity_from_token`, `SocketMeta.org_id`); the backfill route
  passes the API token's. `_get_or_create_task` writes `organization_id` on a new row only, so a task never moves.
- `services/organizations.py` holds the rules; `routers/web_organizations.py` maps them to pages and redirects a
  refusal with an error code (never free text). Non-members get the shared 404; non-admins get 403 on admin forms.
- The pages hang under the Settings tab: a sixth tab in the top bar pushed the bar past a 375 px phone
  (`test_phone_layout.py` caught it). The members table labels its controls with `aria-label`, because an
  absolutely positioned `.sr-only` label inside the horizontally scrolling table widened the whole page.
- Tests: `test_organizations.py` (12, through the pages), `test_task_organization.py` (both write paths, and an
  existing personal task staying personal), the two organization pages in the long-text phone check. Mutations
  checked red: the last-admin guard on removal, the admin check, leaving as a plain member, the org on attach, the
  org on backfill, the case-insensitive e-mail match.
- Relied on, not changed: switching the organization in the extension re-runs the session state machine, which
  stops and restarts the bridge with a token for the new organization.

### Phase 3 of the stack: projects (`feat/recall-projects`)

- `models/project.py`: `projects` (unique `tenant_id` + `key`; `tenant_id` is the organization id or the user id, so
  one unique index serves both kinds of space) and `project_bindings` (unique user + tenant + folder);
  `tasks.project_id` (named key `fk_tasks_project_id` for the downgrade). Migration `b0c1d2e3f4a5`.
- `services/projects.resolve_project` runs on `extension:register` (a failure is logged, never breaks the
  registration) and on `GET /api/recall/context`. Both inserts use `ON CONFLICT DO NOTHING` and read the winner
  back, so a register and a context call racing on a new folder bind it once.
- A new task row takes its folder's project (`telemetry_service._stamp_project`, once, on creation, from both
  the bridge and the backfill); a folder bound later claims its earlier tasks of the same tenant.
- Sharing a folder without git: merge the folder projects on `/app/projects`; there is no per-folder rebind.
- `/app/projects` under Settings lists the personal space and each organization. The owner manages a personal
  project, admins an organization's; others see the scope read-only and get 404 on the forms. A personal project
  offers Off / Only this project / All my projects (stored `none` / `owner` / `organization`).
- Phone layout: the space heading is a flex row and did not wrap an unbroken organization name; a `select` is as
  wide as its longest option. Both caught by `test_phone_layout.py` with seeded long names.
- Tests: `test_projects.py` (14). Mutations checked red: the binding taking precedence (no orphan project), the
  tenant condition when claiming earlier tasks, stamping on backfill, the admin check, the personal scope list,
  the same-tenant merge rule, case folding of the key, binding on register.

### Phase 5 of the stack: cards and search (`feat/recall-search`)

- `models/recall.py`: `session_cards` (GIN `ix_session_cards_search` over the project and the `tsvector` through
  `btree_gin`, whose extension a `before_create` DDL creates on Postgres; btrees `ix_session_cards_recent` on
  tenant and `last_ts` and `ix_session_cards_project_recent` on project and `last_ts`), `recall_dirty`,
  `recall_log`; `tasks.recall_excluded`.
  Migration `c2d3e4f5a6b7`. On SQLite the vector column is plain text and nothing searches it.
- `services/recall_text.py` normalizes cards and queries alike. `services/recall_cards.py` queues a task on its
  first message, a completion, a reply to one and a backfill, and `run_recall_loop` (every 60 s, started in the
  app lifespan) rebuilds tasks idle for 10 minutes, 100 at a time. Turning a project's scope on queues its tasks;
  turning it off deletes its cards; a merge requeues the target; a folder bound later queues the tasks it
  claims when the project is on. The owner's "Keep it out of recall" on the task page rebuilds at once.
- `services/recall_search.py`: `visible()` is the one written rule; the search is the two steps of section 5.
  The timeout and the plan mode are `SET LOCAL` inside a savepoint, so a cancelled search still writes its log
  row.
- Postgres needs the text search configuration and the weights inside the SQL (`'simple'::regconfig`,
  `'A'`): bound as parameters they arrive as varchar and `setweight` has no such signature. Only the Postgres
  lane could see it.
- No per-user rate limit: the server's global limit answers 429 the same way.
- CI: `cloudapi.yml` runs `postgres:16.15-alpine` as a service container and sets `RECALL_PG_URL`;
  `tests/test_recall_pg.py` skips without it. The suite stays on SQLite otherwise.
- Tests: `test_recall.py` (19, SQLite: words, card layout and redaction, queueing, the visibility table, the
  API errors, paging, the exclusion toggle) and `test_recall_pg.py` (4, Postgres: match, weights and age in the
  ranking, whole words only, exclusion of the asking task, cross-project only between organization scopes, the GIN index,
  the timeout). Mutations checked red: each condition of `visible`, the scope and exclusion checks of the
  builder, the queueing triggers, dropping cards on `none`, redaction of results and prompt, the 404 and the 400
  of the API, each card weight, the age decay, the timeout handler, excluding the asking task. Two survivors at
  first exposed weak tests: the Postgres sessions were stamped 1970, so the age decay zeroed every score and
  the order was arbitrary, and the redaction case had no secret in its results.
- Benchmark (`scripts/recall_benchmark.py`, 2 000 000 cards in one tenant, 2000 projects, 300 authors, Postgres
  16.15 in Docker with default settings on the owner's 12-core machine; table and indexes 4.7 GB; 40 runs each):

    | Search                     | p50 ms | p95 ms |
    | -------------------------- | -----: | -----: |
    | one common word            |    9.6 |   12.9 |
    | two words                  |   23.8 |   30.6 |
    | identifier                 |    5.3 |    9.0 |
    | cross-project, common word |   12.9 |   19.2 |
    | cross-project, two words   |   13.5 |   17.2 |
    | cross-project, identifier  |   14.9 |   44.8 |
    | same project, `members`    |   15.0 |   19.0 |

    Getting there took four measured changes, each kept only because the numbers moved: ranking only the newest
    candidates (a common word across projects: 300 ms with timeouts, then 13 ms), the per-project recency index
    with the projects as a subquery (a common word in one project: 150 ms, then 11 ms), the custom plan mode (the
    generic plan read the word index every time), and the GIN index on project and words without prefix matching
    (two words in one project: 100 to 150 ms, then 24 ms).

### Phase 7 of the stack: organizations from Authentik (`feat/cloud-orgs-from-authentik`)

- Details, the verified Authentik facts and the rollout step in `2026-10-27_10-16_cloud-orgs-from-authentik.md`.
- `services/organizations.reconcile_organizations` and the sync triggers (startup, every 300 s, each sign-in);
  `auth/authentik.fetch_groups` pages `/api/v3/core/groups/` with `AUTHENTIK_API_TOKEN`; blueprint entry 5 provisions
  the service account, its view-groups role and the token.
- The organization pages are read-only, paged and filtered by name, and link to Authentik's groups.
