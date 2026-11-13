# read_artifact / search_task_history: refuse a choice or a counted repeat inside a repeat (2026-10-29)

**Status:** implemented on `fix/read-artifact-alternation-regex` (security audit 2026-10-28, section 34, remainder).
**Touched:** `src/core/tools/helpers/searchTaskHistoryQuery.ts`, `src/core/tools/helpers/searchTaskHistory.ts` (refusal
message), `src/core/prompts/tools/native-tools/search_task_history.ts` (tool rule) and its golden snapshots,
`src/core/tools/helpers/__tests__/searchTaskHistory.spec.ts`, `.changeset/history-search-alternation-safe.md`.

## Symptom

`read_artifact({ artifact_id, search: "(a|a)*b" })` over an artifact with one line of 28 `a`s held the extension host
for 3.7 s, doubling per character; `search_task_history` with the same query too, up to its 2 000-character line cap.
Measured in Node 22 on one line of `a`s plus `!`: `(a|a)*b` 28 chars 3 697 ms, `(?:a|a)+$` 26 chars 7 366 ms,
`(a|aa)*b` 34 chars 1 949 ms, `(a|a){30}b` 40 chars 168 524 ms, `(a+){20}b` 30 chars 65 029 ms, `(a{1,5})+b` 40 chars
117 603 ms.

## What was happening

`isCatastrophicPattern` (`searchTaskHistoryQuery.ts:109` before the fix) refused a group only when its body held an
unbounded quantifier (`*`, `+`, `?`, `{n,}`) and the group itself was followed by `*`, `+` or `{n,}`. It missed:

- an alternation in the body (`(a|a)*b`): each repetition has two ways to match the same character;
- a counted repeat on the group (`(a|a){30}`, `(a+){20}`), treated as bounded and safe;
- a variable count in the body (`(a{1,5})+`).

Both `read_artifact` (`ReadArtifactTool.ts:352`) and `search_task_history` (`searchTaskHistory.ts:383`) compile
through `compileHistoryQuery`, so both ran these patterns live.

## Fix

A group is refused when it is repeated (`*`, `+` or any `{n}`, `{n,}`, `{n,m}`) and its body can split the same text
in more than one way: it holds `*`, `+`, `?`, `{n,}`, `{n,m}` or `|`, also inside a nested group. A fixed `{n}` in a
body does not count (`(\d{4}-)+` stays a regex). Counts are read with a sticky regex instead of slicing the rest of
the pattern. The refusal message and the tool rule now name the choice as well (`(a|b)+`).

After the fix every query above is searched as text: 0.003 ms per 5 001-character line.

`(foo|bar)+` is now searched as text too. A precise rule (literal branches with distinct first characters) would
have to follow JavaScript's case folding under `i` and `u` (`ſ` folds to `s`), so it was not worth the risk.

## Tests

`searchTaskHistory.spec.ts`, `classifies %s as %s`: `(a|a)*b`, `(?:a|aa)+$`, `((a|b)c)*d`, `(foo|bar)+`, `(a|a){30}b`,
`(a+){20}b`, `(a{1,5})+b` unsafe; `(foo|bar)`, `(foo|bar)?`, `(\d{4}-)+` regex. Mutations: dropping the `|` marker
turns five cases red, a count on a group not counting as a repeat two, a variable body count not marking two, an
exact body count marking one. The `read_artifact` wiring is already covered by `ReadArtifactTool.search.spec.ts`.

## Not fixed

`read_artifact` has no wall-clock limit, and the detector stays syntactic, so a polynomial pattern still runs live:
`a*a*a*b` on one line of `a`s takes 0.56 s at 200 characters, 2.2 s at 400 and over two minutes at 2 000 (the
`search_task_history` line cap), in both tools; `search_task_history`'s budget is checked only between lines. A real bound needs the scan to be interruptible: run `regex.test` per line inside
`vm.runInContext` with `{ timeout }` (or in a worker thread that can be terminated), and report a timeout the way
`search_task_history` reports its budget. That costs a context switch per line or chunk and is a separate change.
