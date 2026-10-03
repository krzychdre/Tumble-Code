# R3-5: consolidate the cloudapi web-router preamble + the four 404 spellings

Date: 2026-10-03 · Branch: `chore/r3-5-web-router-preamble-404` · Base: main @ `ee25b804f`

## Scope (from the audit)

`ai_plans/simplification_round3_audit_2026-10-02.md`, finding 5: across the five web routers
(`web_metrics.py`, `web_diagnostics.py`, `web_dataset.py`, `web_tasks.py`, `web_settings.py`)
18 endpoints each re-typed the same pair `Depends(require_web_user)` + `Depends(get_db)`, every
HTML page re-typed the `TemplateResponse(request, ..., {"user": user, "nav_active": ...})`
render block, and the "unknown or not yours → 404 page" response was spelled FOUR ways:
inline in `web_tasks.py`, a local `_not_found` helper in `web_diagnostics.py`, its own
heading/hint fields in `web_dataset.py`, and the fourth spelling in `shared.py`.

## Design

One new module, `self-hosted-cloudapi/src/routers/web_page.py` (a plain module, not a router —
routers are registered explicitly in `main.py`, so nothing sweeps it up):

- `WebPage` — a `TypedDict` with the two things every page handler starts with: `user`, `db`.
- `require_web_page` — one FastAPI dependency: `require_web_user` + `get_db`, returning
  `WebPage`. Every `/app` endpoint takes `web: WebPage = Depends(require_web_page)`. Test
  overrides of `get_web_user_optional`/`require_web_user` keep working unchanged (verified:
  `test_web_tasks.py`, `test_cloud_web_perf.py` and ~8 more suites override
  `get_web_user_optional`, never `require_web_user`).
- `render_page(request, page, template_name, nav_active, /, **context)` — the per-page render
  block written once: `{"user": ..., "nav_active": ..., **context}`. The four fixed parameters
  are positional-only so a template context key (e.g. `page=page` in the task list's pager)
  can never collide with a parameter name — that collision was real and is why the `/` is
  there.
- `not_found_page(request, user, /, heading="", hint="", back_href="/app",
back_label="Back to your tasks")` — the ONE 404 for an unknown-or-foreign thing. Takes the
  `WebUser` (optional, since `/shared` renders it for an anonymous reader), not the `WebPage`.
  Every default is `not_found.html`'s own default (`heading or "Task not found"`, etc.), so the
  four previous spellings are reproduced byte-identically by passing exactly what they passed
  before.

## Changes

1. New `src/routers/web_page.py` (the module above, ~90 lines with docstrings).
2. `web_metrics.py`, `web_settings.py`, `web_diagnostics.py`, `web_dataset.py`, `web_tasks.py`:
   all 18 endpoints switched to `web: WebPage = Depends(require_web_page)`; every HTML
   `TemplateResponse` render block replaced by `render_page(...)`; every 404 replaced by
   `not_found_page(...)`. No route names, paths, methods, OpenAPI params, status codes,
   redirect targets or template contexts changed.
    - The task-detail page passes `nav_active=""` (it never set `nav_active`; the template only
      compares it, so `""` behaves the same as absent).
    - Routers that still use a raw `templates.TemplateResponse` where the block was NOT the
      boilerplate shape (e.g. `web_dataset.py`'s streaming JSONL responses) are untouched.
3. `shared.py`: the fourth 404 spelling replaced by `not_found_page(request, user)` —
   `{"user": user}` only, no heading/hint/back fields, exactly as before.

## What was deliberately NOT done

- No `get_own_task`-style dependency was introduced. The audit named it as one possible shape
  ("a `get_own_task`-style dependency that unifies the four 404 spellings"), but the four
  sites do not share one lookup: `web_tasks` loads a `Task` row and compares `user_id`,
  `web_diagnostics` loads a report / renders a brief, `web_dataset` loads exchanges,
  `shared.py` asks `shared_view_access`. A task-scoped dependency would fit one of the four
  and be wrong for the other three. Unifying the RESPONSE (one `not_found_page`) is the part
  that prevents divergence; the lookups were already one-liners each. This matches the
  audit's own arbiter rule ("keep the tests' pinned bodies as the arbiter").
- Heading/hint text was NOT unified: each site keeps exactly the wording it had, including
  `web_tasks`/`shared`'s template defaults and `web_dataset`'s "No recording" page. The audit
  says text changes are allowed "only deliberately", and there was no reason.

## Verification

- `cd self-hosted-cloudapi && uv run pytest`: **1173 passed, 1 xfailed** — full suite,
  zero test edits. Both pinning suites (`tests/test_route_boilerplate.py`,
  `tests/test_route_table.py`) green without a single test change: route table, OpenAPI
  operations, login-wall behaviour (every route → 303 `/app/login`, empty body), signed-in
  behaviour, 404 bodies, 303 redirect targets all unchanged.
- `uvx ruff@0.15.12 check .` — clean; changed files `ruff format`-ed.
- Audit's verify-by-content, after the change:
    - `grep -c "Depends(require_web_user)" src/routers/web_*.py` → 0 everywhere except
      `web_page.py` (the one definition site).
    - `grep -rn "not_found" src/routers/*.py` → one helper (`not_found_page` in `web_page.py`)
        - its call sites; no local `_not_found`, no inline 404 TemplateResponse outside the helper.
    - `Depends(get_db)` appears in exactly one web router file (`web_page.py`).

## Ops note

The docker api image is NOT rebuilt by this branch. The running self-hosted instance picks
these changes up only after an image rebuild (`docker compose build api` + restart in the
deployment).

## Files

- `self-hosted-cloudapi/src/routers/web_page.py` (new)
- `self-hosted-cloudapi/src/routers/web_metrics.py`
- `self-hosted-cloudapi/src/routers/web_settings.py`
- `self-hosted-cloudapi/src/routers/web_diagnostics.py`
- `self-hosted-cloudapi/src/routers/web_dataset.py`
- `self-hosted-cloudapi/src/routers/web_tasks.py`
- `self-hosted-cloudapi/src/routers/shared.py`
