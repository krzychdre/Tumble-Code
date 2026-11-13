# R4 F6: the product name inside the cloud API

**Status:** done

**Related plans:** [maintenance audit round 4](2026-10-23_17-20_maintenance-audit-round-4.md), item F6.

## Touched files

- `self-hosted-cloudapi/pyproject.toml`, `self-hosted-cloudapi/uv.lock`, `self-hosted-cloudapi/Makefile`
- `self-hosted-cloudapi/src/__init__.py`, `self-hosted-cloudapi/config/__init__.py`,
  `self-hosted-cloudapi/config/settings.py`, `self-hosted-cloudapi/src/main.py`
- `self-hosted-cloudapi/src/routers/auth.py`, `self-hosted-cloudapi/src/services/task_tree.py`,
  `self-hosted-cloudapi/src/services/task_summary.py`, `self-hosted-cloudapi/src/services/problems/collect.py`,
  `self-hosted-cloudapi/src/web/static/render.js`
- `self-hosted-cloudapi/src/services/problem_brief.py`, `self-hosted-cloudapi/tests/test_problem_filters_brief.py`
- `self-hosted-cloudapi/tests/test_web_tasks.py`

## Problem

The service still named the product by its pre-rebrand name: the package `roo-cloud-api` with its description and
author, the package and settings docstrings, the start and stop log lines, docstrings and comments, and the problem
brief's "About the program" text (asserted by a test).

## Change

- Package `tumble-cloud-api`, description "Self-hosted Tumble Code Cloud API", author "Tumble Code Community";
  `uv lock` re-run (only the project entry changes).
- "Tumble Cloud API" in the docstrings and log lines; "Tumble Code" in the docstrings and comments, the Makefile
  header and the test docstring.
- `collect.py` quotes the extension's current wording, "Tumble tried to use X ..."; matching still keys on
  "tried to use ", so stored messages with the old wording classify the same.
- Problem brief: "Internal identifiers still say roo and cline, after the extensions it was forked from." The test
  asserts "forked from" instead of the old name.

Left alone on purpose: `docker-compose.yml` database user and database names (live data, renaming them is a
migration), the upstream extension id in the auth service's callback URL docstring (the real id used by the
migration bridge), alembic version files (history), workspace paths such as `/home/.../Roo-Code` in tests (real
directory names) and stored "Roo tried ..." messages in test data (what older extensions wrote).

## Tests

- `test_problem_filters_brief`, `test_web_tasks`, `test_problem_catalogue`, `test_error_reports`: 169 passed. Full
  suite: 1348 passed, 1 xfailed. ruff clean.
- `grep -rn 'Roo Code\|roo-cloud\|Roo Cloud' self-hosted-cloudapi --include='*.py' --include='*.toml'
--include='*.js'` leaves only the alembic history file.
- Mutation check: changing the brief's "forked from" wording turns the brief test red.
