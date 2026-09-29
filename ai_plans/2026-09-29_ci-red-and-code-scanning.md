# CI red on main + open code scanning alerts (2026-09-29)

Branch: `fix/ci-red-and-code-scanning`, based on main e1e9a696c.

## What was red

| Workflow / job | Failure | Root cause | Fix |
| --- | --- | --- | --- |
| Changeset Release | `could not parse changeset` | `d14-user-visible-rebrand-strings.md` had no opening `---`. Behind it: 5 changesets named the old `roo-cline` package, 9 named `self-hosted-cloudapi` (a Python dir, not a workspace package), `ui-4-cli-status-line` mixed the ignored `@tumble-code/cli` with `tumble-code`. | Delimiter added, `roo-cline` -> `tumble-code`, cloudapi lines dropped (the files stay as empty changesets), the mixed one split in two. `changeset version` dry-run completes. |
| knip job, `scripts/__tests__` | `the real repo tree is clean` | `src/extension/api.ts` used a literal `"default"` fallback for `currentApiConfigName`. | `SETTINGS_DEFAULTS.currentApiConfigName`. |
| webview unit tests | lucide golden | 7 icons added by the mode-icon change, `Cloud` no longer imported (#648). | Regenerated with `UPDATE_GOLDEN=1`; diff is +7/-1 names, no glyph changed. |
| webview unit tests | `ChatRow.memo-perf` microbenchmark | Single timing pass per comparator; runner noise made targeted lose 12.28 vs 11.89 ms. Locally targeted is 1.8-2.5x faster. | Best of 7 interleaved rounds per side. |
| src unit tests | `autoImportSettings` x2 | Since #628 import calls `readProfiles()`, accepts only the v2 envelope and calls `getProfile()`; the spec's mock and fixtures predated that. | Mock gains both methods, fixtures built with `createProviderProfilesEnvelope`. |
| src unit tests (Windows) | `storage.spec` task dir | Assertion hard-coded `/`. | `path.join` in the expectation. |
| CLI tests (Windows) | reverse search `raftd` vs `draft` | **Product bug.** `MultilineTextInput` was keyed on `history.length`; the async history load re-mounted it mid-typing and the cursor lost its place. Reproduced locally with a deferred `loadHistory` ("daftr"). | Key no longer includes the history length; new regression spec `AutocompleteInput.historyLoad.test.tsx` fails on the old key. |
| Cloud API (Python) | metrics characterization x2 | `_event_ts_ms` called `timestamp()` on the naive `created_at` SQLite returns, which reads it in host-local time. Golden was generated at UTC+2, runner is UTC. | Naive value treated as UTC (same idiom as `retention_service`). Golden durations updated; identical output under UTC, Europe/Warsaw, America/Los_Angeles. |

## Code scanning

- #16 `js/polynomial-redos` (agent-interchange `tools.ts`): real, the fixed `<path>`-style lazy regexes were quadratic on unclosed tags (755 ms at 20000). All tag lookups now use `extractTagContents`; new spec case fails at 834 ms on the old code.
- #29 `js/tainted-format-string` (`extensionBus.ts`): message type moved out of the format string.
- Dismissed with a comment (reopenable): #24, #31-#33 (ReDoS query fixtures in tests), #26, #27 (test-only local proxy/target), #25 (debug-only TLS override, documented at the site), #30 (mention grammar escapes spaces only by design).

The inline `// codeql[...]` comments at those sites do not suppress anything in GitHub code scanning; the dismissals are what closes them.

## Follow-up: #16 moved to the patch header regex

After #652 CodeQL re-pointed #16 at `^\*\*\* (Add|Update|Delete) File:\s*(.+)$`. V8 stays fast on it (40000 tabs in 1 ms), but `\s*` and `.+` overlap and `\s*` crosses a line break: an empty `*** Update File:` header took the next patch line as its path. Now `File:[ \t]*(\S.*)$`; new spec case returns `+not a path` on the old regex.
