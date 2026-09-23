# Fix: CI shows no per-test annotations because turbo prefixes every log line

Date: 2026-09-23
Branch: `fix/ci-test-annotations-log-prefix` (off `main` at 896a59fd5)
Follows: PR #183 (`ai_plans/2026-09-03_fix-windows-ci-path-assertions.md`), whose
second commit (f55a56ef0) is documented retroactively in the last section.

## Symptom

PR #183 enabled vitest's `github-actions` reporter so that every failing test on
CI becomes an annotation with its name (annotations are readable through the
public API without logging in; job logs are not). The first two runs after it
still produced no test annotations, only turbo's own summary line:

| Run                     | Head      | Failing Windows package       | Annotations                                        |
| ----------------------- | --------- | ----------------------------- | -------------------------------------------------- |
| 35782773298 (PR #183)   | 825a9680c | `@roo-code/agent-interchange` | `...#test: command (...) pnpm run test exited (1)` |
| 35782795861 (main push) | 896a59fd5 | `@tumble-code/cli`            | `...#test: command (...) pnpm run test exited (1)` |

## Root cause (with evidence)

`pnpm test` runs `turbo test --log-order grouped --output-logs new-only`. turbo's
default `--log-prefix auto` starts every line of a task's output with
`<package>:<task>: `. GitHub only interprets a workflow command such as
`::error file=...::message` when it starts at the beginning of the line.

Local reproduction with `GITHUB_ACTIONS=true` and a deliberately failing probe
test in `packages/agent-interchange`:

```
@roo-code/agent-interchange:test: ::error file=.../zz-probe.spec.ts,title=... > probe fails on purpose,line=2,...
::error::@roo-code/agent-interchange#test: command (...) pnpm run test exited (1)
```

The vitest line carries the prefix (ignored by GitHub), the turbo line does not
(the only annotation we ever saw). With `--log-prefix none` the vitest line starts
with `::error file=...`.

The prefix is redundant on CI: `--log-order grouped` already wraps each task's
output in its own `::group::<package>:<task>` section.

## Fix

`.github/workflows/code-qa.yml`, unit-test step: `pnpm test --continue --log-prefix none`.
Only CI changes; locally the prefix stays, since it helps read interleaved output.

Verified locally with the exact CI command and failing probes in two packages
(`GITHUB_ACTIONS=true CI=true pnpm test --continue --log-prefix none --filter
@roo-code/agent-interchange --filter @roo-code/types --force`): both vitest
`::error file=` lines start the line, and turbo reports
`Failed: @roo-code/agent-interchange#test, @roo-code/types#test`, which also
confirms that `--continue` reaches turbo through `pnpm test`.

Which packages emit the reporter: `src` and `webview-ui` add `github-actions`
explicitly (`src/utils/vitest-verbosity.ts`, since they configure other
reporters); packages that configure no reporters (`apps/cli`,
`packages/agent-interchange`, ...) get it from vitest's default.

## What the two runs already tell us

- Ubuntu unit tests pass on main (first result since July 2026).
- The two runs had identical trees (`git diff 825a9680c 896a59fd5` is empty) but
  failed in different Windows packages, so at least one Windows failure is
  non-deterministic. Because `--continue` is proven to work, each run's single
  failing package means everything else, including `src`, passed in that run.
- Which tests fail is still unknown; the next run with this fix should name them.

## Retroactive record: f55a56ef0 (part of PR #183)

- `packages/agent-interchange`: tests that set `AGENT_INTERCHANGE_TUMBLE_STORAGE`
  now also point `HOME`, `USERPROFILE` and `APPDATA` at an empty temp dir
  (`isolateHome` in `src/__tests__/fixtures.ts`). The override adds a store, it
  does not replace the VS Code stores found under the home directory, so real
  tasks on a developer machine pushed the fixture out of the default page.
  Whether this was also the cause on the Windows runner is not proven.
- `src/utils/vitest-verbosity.ts`: adds the `github-actions` reporter when
  `GITHUB_ACTIONS=true` (listing `dot` had switched vitest's automatic one off).
- `code-qa.yml`: `fail-fast: false` on the unit-test matrix (a Windows failure
  cancelled Ubuntu) and `pnpm test --continue`.
- `.gitignore`: `tumble-cli-*.tar.gz*` next to the old `roo-cli-*.tar.gz*`.

Note: the first version of that commit (3e283ab5f) contained the 25 MB
`tumble-cli-linux-x64.tar.gz` and had already been pushed before it was amended;
the merge fc659535d brought it back and 825a9680c removed it. main (squash) does
not contain it, but the blob stays reachable through the PR branch and
`refs/pull/183/head`. It holds no secrets (its `.env` is empty).
