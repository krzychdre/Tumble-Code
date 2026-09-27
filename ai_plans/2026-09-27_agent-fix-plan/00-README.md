# Agent fix plan (2026-09-27)

This folder is a queue of self-contained work packages (WP). Each WP file says exactly what to change, where, how
to test it and how to ship it. It is written for an agent that has not seen this repository before. Do one WP per
branch and per pull request, in the order of the table below.

The WPs come from `ai_plans/2026-09-27_simplification-roadmap.md` (items with the same ids). R1 to R5 of that
roadmap are already merged (#523 to #527) and are not repeated here.

## Order of work

Do the phases in order. Inside a phase, the order is a recommendation; "after" means the other WP must be merged
first.

| Order | WP                                      | What                                                                                    | Effort | Risk   | Dependencies and overlaps                                                            |
| ----- | --------------------------------------- | --------------------------------------------------------------------------------------- | ------ | ------ | ------------------------------------------------------------------------------------ |
|       | **Phase 1: trust CI**                   |                                                                                         |        |        |                                                                                      |
| 1     | [F1](WP-F1.md)                          | CLI resume: first message waits for the resume ask (fixes the `cli-integration` flake)  | S      | low    | none                                                                                 |
| 2     | [F2](WP-F2.md)                          | TaskHistoryStore lock-count test: no watcher refreshes during the count (Windows flake) | S      | low    | none                                                                                 |
|       | **Phase 2: correctness and resilience** |                                                                                         |        |        |                                                                                      |
| 3     | [F3](WP-F3.md)                          | Stream loop: show each chunk when it arrives, not one chunk late                        | S      | medium | none                                                                                 |
| 4     | [R6](WP-R6.md)                          | CLI: shared signal and crash guards for print and TUI mode; warning-listener leak       | M      | medium | none                                                                                 |
| 5     | [R7](WP-R7.md)                          | Cloud: retention sweep isolates each user (savepoint)                                   | S      | low    | shares a docs paragraph with R10                                                     |
| 6     | [R8](WP-R8.md)                          | Cloud: unique share per task (migration), atomic settings version check                 | M      | medium | none                                                                                 |
| 7     | [R9](WP-R9.md)                          | Cloud: `/health/ready`, DB and HTTP timeouts, graceful shutdown                         | M      | low    | shares `tests/test_route_table.py` with R10                                          |
| 8     | [R10](WP-R10.md)                        | Cloud: consume OAuth state, purge expired auth rows, POST logout, session expiry        | M      | medium | see R7 and R9                                                                        |
|       | **Phase 3: less code (DRY, YAGNI)**     |                                                                                         |        |        |                                                                                      |
| 9     | [D1](WP-D1.md)                          | One `backoffDelayMs` and `countdown` in `packages/core`, eight call sites               | S      | low    | before R11 and D2                                                                    |
| 10    | [R11](WP-R11.md)                        | Cloud client: jitter, per-item retry backoff, bridge re-arm                             | M      | low    | after D1                                                                             |
| 11    | [D2](WP-D2.md)                          | Settings defaults from `SETTINGS_DEFAULTS`, not literals; adds `requestDelaySeconds`    | S      | low    | after D1 (both edit `RetryHandler.calculateBackoffDelay`; D2's snippets still match) |
| 12    | [D4](WP-D4.md)                          | One helper for the MDM redirect in `ClineProvider`                                      | S      | low    | none                                                                                 |
| 13    | [D5](WP-D5.md)                          | Delete re-export shims, import `@roo-code/core/browser` and `/fs` directly              | S      | medium | before D10 is easier (both touch `Task*.ts` imports)                                 |
| 14    | [D6](WP-D6.md)                          | Delete dead code (CLI tRPC client, webview components, cloud stubs)                     | S      | low    | none                                                                                 |
| 15    | [D8](WP-D8.md)                          | Merge the one-subclass checkpoint service into one class                                | S      | low    | none                                                                                 |
| 16    | [D10](WP-D10.md)                        | Rename `TaskHistory` to `TaskMessageLog`; move `searchTaskHistory`                      | S      | low    | after D2 and D5 (rebase their import lines)                                          |
| 17    | [D14](WP-D14.md)                        | User-visible "Roo Code" strings to "Tumble Code"                                        | S      | low    | owner decision, see below                                                            |
|       | **Phase 4: speed**                      |                                                                                         |        |        |                                                                                      |
| 18    | [P3](WP-P3.md)                          | Send `webviewDidLaunch` once                                                            | S      | low    | before P4 (both edit `App.tsx`)                                                      |
| 19    | [P4](WP-P4.md)                          | Lazy-load posthog and the rarely used views (about 270 KB off the entry chunk)          | S      | low    | after P3                                                                             |
| 20    | [P6](WP-P6.md)                          | Memoize the storage base path check                                                     | S      | low    | none                                                                                 |
|       | **Phase 5: docs**                       |                                                                                         |        |        |                                                                                      |
| 21    | [F4](WP-F4.md)                          | `docs/09-configuration.md` and `docs/10-how-to.md`; fixes two stale doc lines           | S      | low    | last: run its claims check (section 7) first, other WPs change what it documents     |

`TEMPLATE.md` is the format every WP follows. Use it for new WPs.

## Decisions taken while writing the WPs (owner may override)

- **R6** does not add a custom React error boundary. Ink 7 already catches render errors, restores the terminal
  and rejects `waitUntilExit()`. The bug is that `run.ts` never waits for that promise, so R6 handles the
  rejection instead.
- **R11**: socket.io `reconnect_failed` cannot fire today (`reconnectionAttempts` is Infinity). The bridge re-arm
  is only a guard; the real change is the jitter.
- **P4** drops the "lazy KaTeX CSS" idea: `cssCodeSplit: false` puts all CSS in one file, so it would save nothing.
- **D14** keeps the HTTP `User-Agent` as `RooCode/<version>`, because some provider endpoints may allow-list user
  agents. **Owner decision needed** before executing D14 if the User-Agent should change too.

## Known baseline failures outside CI's required checks

- `self-hosted-cloudapi`: `tests/test_metrics_characterization.py::test_metrics_result_is_pinned_for_every_period`
  and `::test_unknown_period_falls_back_to_the_default` fail on `main` already. The cloud WPs (R7 to R10, the cloud
  part of D6) expect exactly these two failures and no others. They are a separate item (roadmap F6).

## 1. Before you start any WP

1. Read, in this order: `AGENTS.md`, `docs/README.md`, `docs/architecture.md` (above all its "Do not touch"
   list), then the docs page the WP names in its "Read these first" section.
2. Update and branch from the latest main:
    ```sh
    git fetch origin main
    git checkout -B <branch name from the WP> origin/main
    ```
3. Install dependencies once per machine. In a sandbox without network access for postinstall scripts use
   `pnpm install --frozen-lockfile --ignore-scripts`; the unit tests still run.
4. Check that the "Current code" excerpts in the WP still match the files. If they do not (someone changed the
   code since this plan was written), stop and follow the WP's "If stuck" section instead of guessing.

## 2. How to work on a WP

1. Write the test from the WP's section 7 first. Run it and see it FAIL for the reason the WP gives. A test that
   passes before the change proves nothing; if that happens, stop and report.
2. Apply the steps of section 6 one by one. Do not add changes the WP does not ask for, even small cleanups.
3. Run the commands of section 8. All must pass:
    - the new test and the whole folder it lives in;
    - type check: `cd src && npx tsc --noEmit -p .` (or the package's own `tsconfig`);
    - eslint on every changed file: `npx eslint <files> --max-warnings=0` from the package directory;
    - prettier: `npx prettier --check <files>` from the repository root (run `--write` to fix, then re-check).
      Run prettier only on the files you changed, never on a whole folder: it would reformat unrelated files.
4. Re-read your diff (`git diff origin/main`) as a reviewer would. Remove anything not required by the WP.
5. Only ASCII in code comments, docs, commit messages and PR text (the owner's preference): no em or en dashes,
   no arrows, no typographic quotes.

## 3. Shipping

1. Add the changeset and the `ai_plans/<date>_<slug>.md` note the WP specifies (the repository adds both for
   every fix; see recent commits with `git log --stat -5`).
2. Commit with the WP's commit title and body. End the message with the attribution lines your harness requires.
3. Push: `git push -u origin <branch>`. Open a pull request against `main` with the WP's PR body.
4. Wait for CI (Code QA: `compile`, `knip`, `check-translations`, `cli-integration`,
   `platform-unit-test (ubuntu-latest)` and `(windows-latest)`; the Windows job takes about 20 minutes).
5. Merge with squash only when every check is green. The title of the squash commit is the PR title plus
   ` (#<number>)`, as in the existing history.

## 4. Known flaky checks (until WP-F1 and WP-F2 are merged)

| Check                                 | Test                                                                                             | Symptom                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `cli-integration`                     | `create-with-session-id-resume-loads-correct-session`                                            | `timed out resuming session ... sawUserTurnWithMarker=false` |
| `platform-unit-test (windows-latest)` | `TaskHistoryStore > record transaction cleanup > releases per-ID lock tails for many unique IDs` | `expected 100 to be +0`                                      |

If one of these fails with exactly that symptom and your WP does not touch that area: write one comment on the PR
naming the check, the symptom and "known flake, see ai_plans/2026-09-27_agent-fix-plan/WP-F1.md (or WP-F2.md)",
then re-run the failed jobs once. If it fails again, or fails with a different message, it is real: investigate.
Never skip, disable or loosen a test to get CI green.

## 5. When to stop and ask

- The WP's excerpts no longer match the code.
- A test the WP says should fail before the change passes, or a test it says should pass after the change fails
  and the reason is not an obvious typo.
- The change would touch an item on the "Do not touch" list in `docs/architecture.md` beyond what the WP allows.
- CI fails in a way sections 4 and 9 of the WP do not describe.

Report: the WP id, the step you were on, the exact command and its output, and what you expected.
