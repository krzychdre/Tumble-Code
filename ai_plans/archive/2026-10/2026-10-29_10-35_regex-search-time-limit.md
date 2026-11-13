# Interruptible regex scan for read_artifact and search_task_history

**Status:** fixed on `fix/regex-search-time-limit`
**Related:** security audit 2026-10-28, section 34 (after 99d12a0fe and #1225);
`2026-10-29_10-16_read-artifact-alternation-regex.md`
**Touched:** `src/core/tools/helpers/searchTaskHistoryQuery.ts`, `src/core/tools/helpers/searchTaskHistory.ts`,
`src/core/tools/ReadArtifactTool.ts`, their specs

## Symptom

`isCatastrophicPattern` refuses repeated groups whose body can split text in several ways, but a pattern without a
repeated group can still backtrack polynomially: `a*a*a*b` takes 0.56 s on a 200-character line, 2.2 s at 400 and over
2 minutes at 2 000 (the `search_task_history` line cap). Both tools ran `regex.test` directly on the extension host,
which cannot be interrupted; `search_task_history`'s 2 s budget was checked only between lines, `read_artifact` had
none. A model (or a prompt injection) could freeze the extension host with two auto-approved calls.

## What was happening

A running `RegExp.test` cannot be stopped from JavaScript, so a per-line check of the clock never fires inside the one
slow line. No syntactic rule can refuse every slow shape without refusing ordinary patterns.

## Fix

`matchingLineIndexes(regex, lines, millis, limit)` in `searchTaskHistoryQuery.ts` runs the line loop inside a `vm`
context with `timeout`, which V8 enforces even inside a regex match, and returns `undefined` on timeout. One reused
context costs about 54 microseconds per call; 100 000 ordinary lines scan in about 17 ms.

- `searchHistorySources` collects every tested line (each cut to `MAX_TESTED_LINE_CHARS`) and scans them in one call
  with the remaining budget and the `MAX_COLLECTED_MATCHES` cap. The between-lines clock check and
  `BUDGET_CHECK_INTERVAL` are gone.
- `read_artifact` scans each 64 KB chunk with the time left of one 2 s budget (`MAX_SEARCH_MILLIS`) and, on timeout,
  returns a message that the search was stopped and a simpler pattern is needed, without partial results.

The shape check stays: it turns the known exponential shapes into a plain-text search instead of a 2 s timeout.

## Tests

- `searchTaskHistory.spec.ts`: "interrupts a single line that backtracks past the budget" (`a*a*a*b` on 2 000 a's, a
  clock that never moves, so only the interrupted scan can report it). The two fake-clock tests that differed only in
  line count are one test now.
- `ReadArtifactTool.search.spec.ts`: "stops a pattern that backtracks past the time budget and says so".
- Mutations: ignoring the `undefined` result in `searchHistorySources`, and not setting `timedOut` in
  `read_artifact`, each turn its test red.

## Not fixed

Nothing left in these two tools. Other regex scans over model-chosen patterns (for example `search_files`) run in
ripgrep, whose engine has no backtracking.
