# WP-D6: Delete dead code (CLI tRPC client, four webview files, cloud API leftovers)

Status: ready
Effort: S      Risk: low      Depends on: none
Branch name: fix/d6-dead-code      Base: origin/main

## 1. Goal (2-4 sentences, plain words)

Delete code nothing runs: the CLI's old tRPC client (`apps/cli/src/lib/sdk/client.ts`), its two dependencies and
the `SDK_BASE_URL` constant; four webview files used only by their own specs; two empty Python files; the
`routers/web.py` re-export shim and `get_current_user_optional` in the cloud API (used only by tests, which are
repointed). The `ProviderConfig` table is NOT part of this WP (dropping it needs an Alembic migration).

## 2. Why it matters (user-visible effect, 2-4 sentences)

The CLI release installs its external dependencies at install time (`createReleaseManifest` in
`apps/cli/src/lib/utils/release-manifest.ts` keeps every dependency not in `BUNDLED_DEPENDENCIES`), so
`@trpc/client` (and its peer `@trpc/server`) and `superjson` are downloaded by every CLI user for nothing. Otherwise
no user-visible change: less code to read and fewer false hits when searching.

## 3. Read these first (exact paths, and the symbol to look for in each)

- `apps/cli/src/lib/sdk/index.ts`, `client.ts`, `types.ts`; `apps/cli/src/agent/extension-host.ts` line 32
  (`import type { User } from "@/lib/sdk/index.js"` - the `User` TYPE stays in use).
- `apps/cli/src/types/constants.ts` (`SDK_BASE_URL`), `apps/cli/package.json` (`dependencies`, `dev:local`),
  `apps/cli/README.md` (lines near 545, 602, 605).
- `webview-ui/src/components/ui/index.ts` (barrel line `export * from "./select-dropdown"`).
- `self-hosted-cloudapi/src/routers/web.py` (docstring says it only keeps an old import path),
  `self-hosted-cloudapi/src/dependencies.py` (`get_current_user_optional`).
- `knip.jsonc` (rules block).

## 4. Current code (verbatim excerpts, each headed by path and symbol name; line numbers only as a hint "near line N")

`apps/cli/src/lib/sdk/index.ts` (whole file):

```ts
export * from "./types.js"
export * from "./client.js"
```

`apps/cli/src/types/constants.ts` (near line 35):

```ts
export const AUTH_BASE_URL = process.env.ROO_AUTH_BASE_URL ?? "http://localhost:3000"

export const SDK_BASE_URL = process.env.ROO_SDK_BASE_URL ?? "http://localhost:3001"
```

`apps/cli/package.json`:

```json
		"dev:local": "ROO_AUTH_BASE_URL=http://localhost:3000 ROO_SDK_BASE_URL=http://localhost:3001 ROO_CODE_PROVIDER_URL=http://localhost:8080/proxy tsx src/index.ts",
```

```json
		"@trpc/client": "^11.8.1",
```

```json
		"superjson": "^2.2.6",
```

`apps/cli/README.md` (near line 540):

```
| Variable            | Description                                                                          |
| ------------------- | ------------------------------------------------------------------------------------ |
| `ROO_AUTH_BASE_URL` | Web app that `tumble auth login` signs in through (default: `http://localhost:3000`) |
| `ROO_SDK_BASE_URL`  | Cloud API the CLI talks to (default: `http://localhost:3001`)                        |
```

and near line 602:

```
The `dev:local` script points the CLI at a self-hosted cloud stack on this machine (`ROO_AUTH_BASE_URL=http://localhost:3000`, `ROO_SDK_BASE_URL=http://localhost:3001`, `ROO_CODE_PROVIDER_URL=http://localhost:8080/proxy`). To use another deployment, set the same variables before `pnpm dev`:

```bash
ROO_AUTH_BASE_URL=https://auth.example.com ROO_SDK_BASE_URL=https://api.example.com pnpm dev --print "Hello"
```
```

`webview-ui/src/components/ui/index.ts` (line 20): `export * from "./select-dropdown"`

`self-hosted-cloudapi/src/dependencies.py` (end of file):

```python
async def get_current_user_optional(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> Optional[dict]:
    """Like get_current_user but returns None instead of raising for unauthenticated requests."""
    if credentials is None:
        return None

    try:
        return await get_current_user(credentials)
    except HTTPException:
        return None
```

## 5. Root cause / analysis

VERIFIED (grep, and a trial run of the Python part in a scratch copy):

CLI
- `createClient` in `lib/sdk/client.ts` has no importer (knip lists it as an unused export:
  `createClient apps/cli/src/lib/sdk/client.ts:19:14`). `@trpc/client` and `superjson` are imported only by that
  file (`grep -rln "@trpc/client\|superjson" src packages webview-ui/src apps --include=*.ts --include=*.tsx --include=package.json | grep -v node_modules`
  -> `apps/cli/src/lib/sdk/client.ts` and `apps/cli/package.json`). No test references them.
- CORRECTION to the roadmap: the `lib/sdk` folder is not entirely dead. `types.ts` (`User`, `Org`) stays, because
  `apps/cli/src/agent/extension-host.ts:32` imports `type { User }` from `@/lib/sdk/index.js` (used at line 77).
  Only `client.ts` and its re-export line go.
- `SDK_BASE_URL` has no reader (knip lists it; grep finds only its definition). `ROO_SDK_BASE_URL` then has no
  effect; remove it from `dev:local` and the README too.
- `@tumble-code/cli` is in the changesets `ignore` list (`.changeset/config.json`), so no changeset.

Webview
- `components/ui/select-dropdown.tsx`: only referenced by the barrel `components/ui/index.ts` and its spec
  `components/ui/__tests__/select-dropdown.spec.tsx`; no file imports `SelectDropdown` or `DropdownOptionType`
  (`grep -rn "SelectDropdown\|DropdownOptionType" webview-ui/src` -> only those two files). Its imports (`fzf`,
  `@radix-ui/react-icons`, `useRooPortal`, `StandardTooltip`, `Popover`) all have other users, and its i18n key
  `common:ui.search_placeholder` is still used by `components/chat/ApiConfigSelector.tsx`, so no dependency or
  locale key becomes unused.
- `components/chat/SlashCommandItemSimple.tsx`: only its spec `components/chat/__tests__/SlashCommandItemSimple.spec.tsx`.
- `components/chat/BatchListFilesPermission.tsx`: only its spec `components/chat/__tests__/BatchListFilesPermission.spec.tsx`.
- `utils/provider-profile-draft.ts`: only its spec `utils/__tests__/provider-profile-draft.spec.ts`. The
  `@roo-code/types` helpers it calls (`createKnownPersistedProviderProfile`, `providerProfileToLegacySettings`) keep
  other users (`src/core/config/importExport.ts`, `ProviderSettingsManager.ts`).
- knip does not report these files as unused because its vitest plugin treats spec files as entry points; that is
  why they survived.

Cloud API
- `bench_new.py` and `verify_summary.py` are tracked, 0 bytes, referenced nowhere.
- `src/routers/web.py` is imported by no module under `src/` (only its own docstring and `src/utils/format.py`'s
  docstring mention it). Tests that import it: `tests/test_web_presenters.py` (line 16 `from src.routers import web`,
  plus the identity test `test_the_old_import_path_re_exports_the_moved_helpers` at the end), 
  `tests/test_formatting_call_sites.py` (line 12), `tests/test_web_tasks.py` (lines 791, 906),
  `tests/test_web_metrics.py` (line 442), `tests/test_metrics_characterization.py` (line 27).
- `get_current_user_optional` is used only by `tests/test_route_boilerplate.py` (lines 463, 469, 498, 504,
  516-521). (The note in `ai_plans/2026-07-30_cloud-web-gui-overhaul.md` that `routers/proxy.py` uses it is out of
  date; `grep -rn get_current_user_optional self-hosted-cloudapi/src` finds only the definition.)
- Trial run: with the edits of step 9 below applied to a copy, `pytest` gave `2 failed, 787 passed, 13 skipped,
  1 xfailed`; the 2 failures (`test_metrics_characterization.py::test_metrics_result_is_pinned_for_every_period` and
  `::test_unknown_period_falls_back_to_the_default`) fail identically on the unchanged tree (pre-existing, not
  caused by this WP). `uvx ruff@0.15.12 check src tests` -> "All checks passed!".

Out of scope, on purpose
- `ProviderConfig` model/table (`self-hosted-cloudapi/src/models/provider.py`, relationship in
  `src/models/organization.py`, export in `src/models/__init__.py`): dropping it needs an Alembic migration and a
  `test_migration_drift` update. Separate item.
- `scripts/add-missing-translations.js` (in the roadmap row, not in this WP's brief): referenced nowhere; can be
  deleted in the same PR if the reviewer agrees, otherwise a follow-up.
- Raising knip `exports`/`types` from `warn` to `error`: knip currently reports 144 unused exports and 120 unused
  types, so this cannot be switched on in this WP.

## 6. Step-by-step changes

CLI

1. Delete `apps/cli/src/lib/sdk/client.ts` (`git rm`).
2. `apps/cli/src/lib/sdk/index.ts`: replace the whole content with:

```ts
export * from "./types.js"
```

3. `apps/cli/src/types/constants.ts`: delete these two lines (the blank line before and the constant):

```ts

export const SDK_BASE_URL = process.env.ROO_SDK_BASE_URL ?? "http://localhost:3001"
```

4. Remove the two dependencies and update the lockfile in one command (from the repo root):
   `cd /home/user/Tumble-Code && pnpm --filter @tumble-code/cli remove @trpc/client superjson`
   If that fails for lack of network, edit `apps/cli/package.json` by hand (delete the two lines quoted in
   section 4) and run `pnpm install --lockfile-only --offline`; if that also fails, run
   `pnpm install --lockfile-only` when network is available. Afterwards
   `grep -n "@trpc\|superjson" pnpm-lock.yaml` must print nothing (they have no other dependant in the workspace).
5. `apps/cli/package.json` script `dev:local`: find

```
ROO_AUTH_BASE_URL=http://localhost:3000 ROO_SDK_BASE_URL=http://localhost:3001 ROO_CODE_PROVIDER_URL=http://localhost:8080/proxy tsx src/index.ts
```

   replace with

```
ROO_AUTH_BASE_URL=http://localhost:3000 ROO_CODE_PROVIDER_URL=http://localhost:8080/proxy tsx src/index.ts
```

6. `apps/cli/README.md`: delete the table row

```
| `ROO_SDK_BASE_URL`  | Cloud API the CLI talks to (default: `http://localhost:3001`)                        |
```

   In the paragraph near line 602 replace `(`ROO_AUTH_BASE_URL=http://localhost:3000`, `ROO_SDK_BASE_URL=http://localhost:3001`, `ROO_CODE_PROVIDER_URL=http://localhost:8080/proxy`)`
   with `(`ROO_AUTH_BASE_URL=http://localhost:3000`, `ROO_CODE_PROVIDER_URL=http://localhost:8080/proxy`)`, and in the
   bash example replace `ROO_AUTH_BASE_URL=https://auth.example.com ROO_SDK_BASE_URL=https://api.example.com pnpm dev --print "Hello"`
   with `ROO_AUTH_BASE_URL=https://auth.example.com pnpm dev --print "Hello"`. Run prettier on the README (the table
   column widths may need re-alignment).

Webview

7. `git rm` these files:
   - `webview-ui/src/components/ui/select-dropdown.tsx`
   - `webview-ui/src/components/ui/__tests__/select-dropdown.spec.tsx`
   - `webview-ui/src/components/chat/SlashCommandItemSimple.tsx`
   - `webview-ui/src/components/chat/__tests__/SlashCommandItemSimple.spec.tsx`
   - `webview-ui/src/components/chat/BatchListFilesPermission.tsx`
   - `webview-ui/src/components/chat/__tests__/BatchListFilesPermission.spec.tsx`
   - `webview-ui/src/utils/provider-profile-draft.ts`
   - `webview-ui/src/utils/__tests__/provider-profile-draft.spec.ts`
8. `webview-ui/src/components/ui/index.ts`: delete the line `export * from "./select-dropdown"`.

Cloud API (run from `/home/user/Tumble-Code/self-hosted-cloudapi`)

9. `git rm bench_new.py verify_summary.py src/routers/web.py`
10. Repoint the tests and remove `get_current_user_optional` with this script (it asserts every snippet exists, so it
    fails loudly instead of half-applying). Save it as `/tmp/d6_cloud.py` (outside the repo) and run
    `cd /home/user/Tumble-Code/self-hosted-cloudapi && python3 /tmp/d6_cloud.py`:

```python
import re


def edit(path, pairs):
    s = open(path, encoding="utf-8").read()
    for old, new in pairs:
        assert old in s, (path, old)
        s = s.replace(old, new, 1)
    open(path, "w", encoding="utf-8").write(s)


# tests/test_web_presenters.py: import the helpers from their modules, drop the shim identity test.
p = "tests/test_web_presenters.py"
s = open(p, encoding="utf-8").read()
cut = s.index("# --- the old import path")
s = s[:cut].rstrip() + "\n"
assert "from src.routers import web\n" in s
s = s.replace(
    "from src.routers import web\n",
    "from src.services.quality_overview import quality_overview as _quality_overview\n",
    1,
)
s = s.replace(
    "from src.services.task_tree import Spend\n",
    "from src.services.task_tree import Spend\n"
    "from src.web.presenters.task_detail import _spend_summary\n"
    "from src.web.presenters.task_rows import _PROMPT_WRAP_COLS, _PROMPT_WRAP_LINES, _list_row, _row_tooltip\n",
    1,
)
s = re.sub(r"\bweb\._", "_", s)
open(p, "w", encoding="utf-8").write(s)

# tests/test_formatting_call_sites.py
p = "tests/test_formatting_call_sites.py"
s = open(p, encoding="utf-8").read()
assert "from src.routers import web\n" in s
s = s.replace("from src.routers import web\n", "", 1)
s = s.replace(
    "from src.utils import format as fmt\n",
    "from src.utils import format as fmt\n"
    "from src.web.presenters.settings import _plan_view\n"
    "from src.web.presenters.task_detail import _quality_panel, _spend_row\n"
    "from src.web.presenters.task_rows import _metrics_tooltip, _run_tooltip, _spend_fields\n",
    1,
)
s = re.sub(r"\bweb\._", "_", s)
open(p, "w", encoding="utf-8").write(s)

edit(
    "tests/test_web_tasks.py",
    [
        (
            "from src.routers.web import _PROMPT_WRAP_COLS, _PROMPT_WRAP_LINES, _wrap_prompt",
            "from src.web.presenters.task_rows import _PROMPT_WRAP_COLS, _PROMPT_WRAP_LINES, _wrap_prompt",
        ),
        ("from src.routers.web import PAGE_SIZE", "from src.routers.web_tasks import PAGE_SIZE"),
    ],
)
edit(
    "tests/test_web_metrics.py",
    [
        (
            "from src.routers.web import _quality_overview",
            "from src.services.quality_overview import quality_overview as _quality_overview",
        )
    ],
)
edit(
    "tests/test_metrics_characterization.py",
    [
        (
            "from src.routers.web import _quality_overview",
            "from src.services.quality_overview import quality_overview as _quality_overview",
        )
    ],
)

# tests/test_route_boilerplate.py: keep the get_current_user assertions, drop the optional variant.
p = "tests/test_route_boilerplate.py"
s = open(p, encoding="utf-8").read()
for old, new in [
    (
        "    from src.dependencies import get_current_user, get_current_user_optional\n\n"
        "    creds = HTTPAuthorizationCredentials(scheme=\"Bearer\", credentials=_jwt(claims))\n    r = claims.get(\"r\", {})",
        "    from src.dependencies import get_current_user\n\n"
        "    creds = HTTPAuthorizationCredentials(scheme=\"Bearer\", credentials=_jwt(claims))\n    r = claims.get(\"r\", {})",
    ),
    (
        "    assert await get_current_user(creds) == expected\n    assert await get_current_user_optional(creds) == expected\n",
        "    assert await get_current_user(creds) == expected\n",
    ),
    (
        "    from src.dependencies import get_current_user, get_current_user_optional\n\n"
        "    creds = HTTPAuthorizationCredentials(scheme=\"Bearer\", credentials=_jwt(claims))\n    with pytest.raises",
        "    from src.dependencies import get_current_user\n\n"
        "    creds = HTTPAuthorizationCredentials(scheme=\"Bearer\", credentials=_jwt(claims))\n    with pytest.raises",
    ),
    (
        "    assert exc.value.status_code == 401\n    assert await get_current_user_optional(creds) is None\n",
        "    assert exc.value.status_code == 401\n",
    ),
]:
    assert old in s, old
    s = s.replace(old, new, 1)
start = s.index("async def test_get_current_user_optional_is_none_without_a_good_token():")
end = s.index("def test_the_extension_token_check_opens_no_database_session")
s = s[:start] + s[end:]
assert "get_current_user_optional" not in s
open(p, "w", encoding="utf-8").write(s)

# src/dependencies.py: drop get_current_user_optional (the last function in the file).
p = "src/dependencies.py"
s = open(p, encoding="utf-8").read()
start = s.index("\n\nasync def get_current_user_optional(")
s = s[:start] + "\n"
open(p, "w", encoding="utf-8").write(s)
```

    Then check: `grep -rn "routers.web import\|routers import web$\|get_current_user_optional" src tests` prints nothing.
    `Optional`, `HTTPException` and `status` stay used in `src/dependencies.py` (by `get_current_user`); ruff will
    tell you if not.
11. In `self-hosted-cloudapi/src/utils/format.py` the module docstring says "These were previously duplicated in
    ``src/routers/web.py``"; leave it (historical note, the file name is still meaningful in git history).

## 7. Tests to add or change

- Deleted with their subjects: the four webview specs in step 7.
- Deleted: `test_the_old_import_path_re_exports_the_moved_helpers` in `tests/test_web_presenters.py` (it only
  asserted that the shim re-exports) and `test_get_current_user_optional_is_none_without_a_good_token` in
  `tests/test_route_boilerplate.py`; the two `get_current_user_optional` asserts inside
  `test_get_current_user_result` and `test_get_current_user_refuses_a_token_without_our_issuer_and_version` are
  dropped, the `get_current_user` asserts in them stay.
- Repointed (same assertions, new import): `tests/test_web_presenters.py`, `tests/test_formatting_call_sites.py`,
  `tests/test_web_tasks.py`, `tests/test_web_metrics.py`, `tests/test_metrics_characterization.py`.
- No new test: deleting unreferenced code; the type checkers and the suites prove nothing referenced it.

## 8. Commands to run (exact, from which directory) and the expected result

1. Baseline (before changes): `cd /home/user/Tumble-Code/self-hosted-cloudapi && uv run pytest -q 2>&1 | tail -3`
   -> expect the 2 pre-existing failures in `test_metrics_characterization.py` (note the exact counts).
2. CLI: `cd /home/user/Tumble-Code/apps/cli && pnpm check-types && npx vitest run` -> pass;
   `npx eslint src/lib/sdk/index.ts src/types/constants.ts --max-warnings=0`.
3. CLI build smoke: `cd /home/user/Tumble-Code/apps/cli && pnpm build` (check the script name in
   `apps/cli/package.json`) -> succeeds.
4. Webview: `cd /home/user/Tumble-Code/webview-ui && pnpm check-types && npx vitest run` -> pass (4 spec files fewer);
   `npx eslint src/components/ui/index.ts --max-warnings=0`.
5. Cloud: `cd /home/user/Tumble-Code/self-hosted-cloudapi && uv run pytest -q 2>&1 | tail -3` -> the same 2
   pre-existing failures, everything else passes (in the trial: `2 failed, 787 passed, 13 skipped, 1 xfailed`;
   before the change there are 2 more passing tests, the two deleted ones).
6. `cd /home/user/Tumble-Code/self-hosted-cloudapi && uvx ruff@0.15.12 check .` -> "All checks passed!".
7. `cd /home/user/Tumble-Code && pnpm knip 2>&1 | grep -E "sdk/client|SDK_BASE_URL|select-dropdown|trpc|superjson"`
   -> prints nothing.
8. `cd /home/user/Tumble-Code && npx prettier --check apps/cli/README.md apps/cli/package.json apps/cli/src/lib/sdk/index.ts apps/cli/src/types/constants.ts webview-ui/src/components/ui/index.ts`.
9. `cd /home/user/Tumble-Code && git status --short` -> only the intended files, plus `pnpm-lock.yaml`.

## 9. Do not touch / pitfalls

- Keep `apps/cli/src/lib/sdk/types.ts` and the `export * from "./types.js"` line (the `User` type is used).
- Do not touch `AUTH_BASE_URL` / `ROO_AUTH_BASE_URL` (used by `tumble auth login`).
- Do-not-touch list (cloud): the monotonic `ON CONFLICT` upsert, `response_model_exclude_none=True`, share 404,
  `/bridge`, DB bootstrap classification, SQLite as test DB, denormalized summary columns - none touched here.
  Do not touch the `ProviderConfig` model (needs a migration; `test_migration_drift` would fail).
- Security pins in the root `pnpm.overrides` must stay; `pnpm remove` does not touch them, but check the
  `package.json` diff of the root is empty.
- Do not delete the `common:ui.search_placeholder` locale key (still used by `ApiConfigSelector.tsx`).
- Ruff format is not enforced in CI (96 files would be reformatted today); run only `ruff check`.
- Known flaky: F1 (cli-integration resume case) may fail in `apps/cli` integration runs regardless.

## 10. Acceptance checklist (checkboxes)

- [ ] `client.ts`, the 8 webview files, `bench_new.py`, `verify_summary.py`, `src/routers/web.py` deleted.
- [ ] `@trpc/client`, `superjson` gone from `apps/cli/package.json` and `pnpm-lock.yaml`.
- [ ] `SDK_BASE_URL` / `ROO_SDK_BASE_URL` gone from code, `dev:local` and README.
- [ ] `get_current_user_optional` gone; tests repointed; pytest shows only the 2 pre-existing failures.
- [ ] CLI and webview check-types, tests, eslint, prettier clean; ruff check clean; knip shows none of the removed names.

## 11. Commit, changeset and PR text

Commit title: `chore: delete dead code in the CLI, webview and cloud API (D6)`

Body:

```
CLI: the unused tRPC client (lib/sdk/client.ts), SDK_BASE_URL and the
@trpc/client and superjson dependencies, which the CLI release installed for
every user. The User/Org types in lib/sdk stay (extension-host uses User).
Webview: select-dropdown, SlashCommandItemSimple, BatchListFilesPermission and
provider-profile-draft, each used only by its own spec.
Cloud API: empty bench_new.py and verify_summary.py, the routers/web.py
re-export shim and get_current_user_optional; the tests import the helpers
from their modules. The ProviderConfig table stays (needs a migration).

<the commit attribution trailers your harness requires>
```

Changeset: none (`@tumble-code/cli` is ignored by changesets; the extension does not change).

`ai_plans/2026-MM-DD_d6-dead-code.md`:

```
# D6: dead code

Item D6 of `2026-09-27_simplification-roadmap.md`.

## Problem
Code nothing ran: CLI tRPC client and its deps, four webview files kept alive only by their specs, two empty
Python files, a re-export shim and an unused auth dependency in the cloud API.

## Change
Deleted; cloud tests import the helpers from their modules. lib/sdk/types.ts kept (User is used).
Not done: the ProviderConfig table (needs a migration), scripts/add-missing-translations.js, knip rules to error
(144 unused exports remain).

## Tests
Suites unchanged apart from the deleted specs and the shim identity test; cloud pytest keeps its 2 pre-existing
failures in test_metrics_characterization.py.
```

PR body outline: Summary per area; "Kept on purpose" (lib/sdk/types.ts, ProviderConfig); verification commands and
results; pre-existing cloud failures; end with
the PR attribution footer your harness requires (see 00-README.md, section 3).

## 12. If stuck

- If `pnpm remove` wants to change other packages' versions in the lockfile (a big lockfile diff), stop, revert the
  lockfile, and report; do not commit an unrelated lockfile refresh.
- If the cloud pytest run shows failures other than the two pre-existing ones, run the same test on the unchanged
  tree (`git stash`) to see if it is pre-existing; report any new one with its output.
- If a webview test outside the deleted specs imports one of the deleted files (none did at `aa173b9`), report it.
