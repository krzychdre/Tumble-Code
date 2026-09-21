# CLI: return the rescued 38-commit CLI stack (plus the answer-lost fix) to `main`

**Date:** 2026-09-21
**Branches involved:**
- `rescue/cli-installed-build` = `f6ed54afd`: the 38-commit CLI stack, 38 ahead of merge-base `8f8550ccb`, forked BEFORE the 24 commits `main` has gained since.
- `fix/cli-answer-lost-in-dynamic-tail`: 5 commits on top of `f6ed54afd` (plan doc `10922060d`, finalization fix `2c34d4d2b`, idle promotion `a6631749a`, expanded rendering `1653dccbd`, ctrl+o verbose toggle `fff985550`). Implemented, tested, lint clean, knip output byte-identical to the base.
- `main` = `61be588a7` at the time of writing.
**Worktree for the merge work:** a fresh worktree with its OWN `pnpm install` (see slice 0). NOT `/tmp/tumble-cli-fix`, whose `node_modules` is a symlink to the main tree.
**Status:** planned, not started. Nothing in this document has been executed.

Writing and coding rule: never use an em dash or an en dash anywhere (code,
comments, tests, commit messages, UI strings, changesets). Use a hyphen, a
comma, a colon or parentheses.

## Why this matters

The 38 commits of the CLI stack (Claude-style `<Static>` transcript, provider
parity, OAuth for ChatGPT subscriptions, the dynamic-tail clamps, the ink 6.6.0
pin, bundled ripgrep, permissions command, and so on) existed on NO branch
until they were put on `rescue/cli-installed-build`. They were reachable only
from the reflog and one `git gc` away from being lost. They are safe now, but
still nowhere near `main`.

Plainly: the `tumble` binary installed in `~/.roo/cli` (package version
`0.1.17-local.f6ed54afd`, built 2026-08-09) is built from code that is not on
`main`. `main`'s `apps/cli` is the older UI entirely (no `<Static>` transcript,
no Claude-style rendering). Anyone building the CLI from `main` today gets a
different, older program than the one the user runs. Every day this stays
unmerged, `main` drifts further and the merge gets harder (it already costs a
provider-surface reconciliation, see below).

## Facts measured on 2026-09-21

- Merge-base `main`..`rescue/cli-installed-build` = `8f8550ccb`.
- Branch side: 38 commits, all CLI-motivated; 8 of them touch `src/` or
  `packages/` outside `apps/cli` (`627bf3a1c`, `dc93d5de2`, `a85a1c8ba`,
  `efcde397a`, `05be453a3`, `37f8b0845`, `2ea84fe8b`, `f6ed54afd`).
- `main` side: 24 commits; exactly one touches `apps/cli`: `d4a7f4182`
  "Chore/provider cleanup model refresh (#154)", which retired seven providers
  (poe, unbound, requesty, vercel-ai-gateway, baseten, sambanova, fireworks)
  from `@roo-code/types` and removed their three CLI references
  (`apps/cli/src/lib/utils/context-window.ts`, `provider.ts`,
  `src/types/types.ts`).
- Files changed on BOTH sides (the only places a textual merge conflict can
  occur): `apps/cli/src/lib/utils/provider.ts`, `apps/cli/src/types/types.ts`,
  `src/core/assistant-message/presentAssistantMessage.ts`,
  `src/core/webview/ClineProvider.ts`, `src/package.json`, `pnpm-lock.yaml`.
- Files changed ONLY on the branch side that `main` never touched since the
  merge-base: `packages/core/src/index.ts` (adds
  `export { safeWriteJson } from "../../../src/utils/safeWriteJson.js"`),
  `packages/vscode-shim/src/api/create-vscode-api-mock.ts` (adds the
  `openExternal` option), `apps/cli/package.json` (renames to
  `@tumble-code/cli`, pins `ink` to `6.6.0`, adds `string-width`).
  `src/utils/safeWriteJson.ts` still exists on `main`.
- `main` gates CI on knip (`.github/workflows/code-qa.yml`, job `knip`, added
  by `0aaa2713b` and `6ec983eba`).
- `main` reset `src/package.json` to `"version": "1.0.0"` (`60b15ab46`); the
  branch still carries `3.53.0`. The branch's only change to that file
  (`f6ed54afd`) adds `"punycode": "2.3.1"` to dependencies.
- `.changeset/config.json` on `main`: `fixed: [["tumble-code"]]`,
  `ignore: ["@roo-code/cli"]`. The branch renames the CLI package to
  `@tumble-code/cli`, so after the merge the `ignore` entry names a package
  that no longer exists.

## Reading the four breakages found under the symlinked `node_modules`

The gates were run in a worktree whose `node_modules` was a symlink to the
main tree, so every workspace package (`@roo-code/core`, `@roo-code/types`,
`@roo-code/vscode-shim`) resolved to `main`'s SOURCE, while `apps/cli` was the
branch's. That is a useful preview, but it mixes two different kinds of error:

1. Real drift, will conflict or fail after the merge too:
   - the provider surface: `apps/cli/src/lib/utils/provider-types.ts:132`
     (`vercel-ai-gateway` entry), `apps/cli/src/lib/utils/context-window.ts:48,50,54`
     (`requestyModelId`, `unboundModelId`, `vercelAiGatewayModelId`),
     `apps/cli/src/commands/cli/__tests__/run.test.ts:449,451,455` (`unbound`),
     `apps/cli/src/lib/utils/__tests__/provider-types.test.ts:169,173`
     (`vercel-ai-gateway`). `main` deleted those types on purpose.
   - knip: the unused exports listed in slice 4 exist on the branch point and
     `main` now fails CI on them.
2. Artifacts of the symlink, expected to disappear after a real merge plus
   `pnpm install`, because the branch itself carries the missing piece and
   `main` never touched the file:
   - `src/lib/storage/settings.ts:5` importing `safeWriteJson` from
     `@roo-code/core` (branch commit `37f8b0845` adds that export; `main`'s
     `packages/core/src/index.ts` is unchanged since the merge-base, so the
     merge keeps the export with no conflict). This also explains the `tsup`
     build failure and the six failing tests in
     `src/lib/storage/__tests__/settings.test.ts`.
   - `src/commands/auth/openai-codex.ts:76` passing `openExternal` (branch
     commit `05be453a3` adds it to the shim; `main`'s shim is unchanged).
   - `src/ui/__tests__/figures.test.ts:1` importing `string-width` (declared
     in the branch's `apps/cli/package.json`; `main`'s install does not have it).

The plan does not take group 2 on faith: slice 2 re-runs the gates in a
properly installed merged tree and has an explicit fallback if any of them
persists. But the implementer should expect group 2 to vanish and should NOT
start by "fixing" `safeWriteJson` imports.

## Decision: one merge of `main` into the stack, then a squash PR

Chosen: create `integrate/cli-stack-to-main` from
`fix/cli-answer-lost-in-dynamic-tail` (so the fix rides along), merge `main`
into it once (`git merge main`), resolve the six overlapping files in that
single merge commit, then fix the real drift in ordinary follow-up commits on
the same branch, open a PR and squash-merge it into `main`. Re-affirmed after
seeing the compile failures, for these reasons:

- Every previous stack in this repository landed on `main` by squash merge
  (memory: the 2026-08-25 merges). The branch's internal history is not visible
  on `main` afterwards, so replaying 38 commits one by one buys nothing that
  `main` will keep.
- A rebase replays the provider-parity commit `5e06541ef` and the review-fix
  commit `bb8588903` on top of `d4a7f4182`, so the retired-provider conflict is
  resolved twice, and `627bf3a1c`, `efcde397a`, `f6ed54afd` each conflict on
  their own file. With `--exec` type-checking, every intermediate commit would
  also have to compile against `main`'s `@roo-code/types`, which means editing
  history for commits whose only sin is predating the retirement. One merge
  resolves each file once, and the compile only has to be green at the end.
- The fix branch goes in together with the stack, not first: the fix is
  meaningless on `main`'s old CLI UI (there is no `<Static>` transcript there),
  so it cannot land on its own. Merging `main` into the FIX branch's tip (which
  contains the stack) is the same amount of conflict work as merging into the
  stack alone and avoids a second integration.

Rejected alternative A: linear rebase, `git rebase --onto main 8f8550ccb`.
Reasons above. Keep it only as a fallback if the user explicitly wants a
readable linear history on the PR (then still squash-merge).

Rejected alternative B: land the fix first, then the stack. Impossible: the
fix does not apply to `main`'s CLI.

Rejected alternative C: cherry-pick the stack into small themed PRs
(rebrand, provider parity, UI redesign, OAuth, hardening). Cleanest review,
but the 38 commits are heavily interdependent (the UI redesign commits edit
files the rebrand renamed, the clamps depend on the redesign, the OAuth commit
edits the shim the settings mirror needs), and the user runs a binary built
from the whole stack. Splitting it risks landing a `main` whose CLI matches no
tested build. Not worth it for history that will be squashed.

## Invariants

- I1. The landed CLI must be, in behavior, the installed build plus the four
  fix slices, minus the seven retired providers. Nothing else changes.
- I2. `main`'s intent wins wherever the two sides disagree on the product:
  retired providers stay retired; `src/package.json` stays at `main`'s version;
  `main`'s teaching-errors structure in `presentAssistantMessage.ts` stays.
- I3. The branch's intent wins on everything CLI-specific that `main` never
  touched: the `@tumble-code/cli` name, the `ink` pin at exactly `6.6.0`, the
  bundled ripgrep path, the `safeWriteJson` re-export, the shim's
  `openExternal` option, the settings mirror.
- I4. `pnpm knip` at the repo root must exit 0 from a properly installed tree
  before the PR is opened (the CI gate).
- I5. The manual checks run on the INSTALLED bundle built from the merged
  branch, not on the dev tree.
- I6. `rescue/cli-installed-build` and `fix/cli-answer-lost-in-dynamic-tail`
  are not deleted until the PR is merged and the installed build has been
  verified (rollback story below).

## Work slices (sequential unless stated)

All git commands below run inside the integration worktree from slice 0.

### Slice 0: an honest worktree

- `git worktree add /tmp/tumble-cli-integrate -b integrate/cli-stack-to-main fix/cli-answer-lost-in-dynamic-tail`
- In that worktree, run a REAL `pnpm install` (no symlinked `node_modules`).
  This is mandatory: the symlink is what produced the false compile errors,
  and root `pnpm knip` cannot even load `webview-ui/vite.config.ts` through it.
- Baseline: `pnpm -C apps/cli check-types`, `pnpm -C apps/cli test`,
  `pnpm -C apps/cli build`, and `pnpm knip` at the root. Record the results
  BEFORE merging. Expected: all green except knip (the pre-existing debt of
  slice 4). If `check-types` or `build` fail here, on the branch's own
  packages, the group 2 errors above were not symlink artifacts after all;
  stop and re-diagnose before merging.

Verification: the four commands above, results pasted into the PR description
as the "before" column.

### Slice 1: the merge commit

- `git merge main` (no `--squash`; one merge commit, the branch history stays
  intact until the PR squashes it).
- Expected conflicts and the rule for each:
  - `apps/cli/src/lib/utils/provider.ts` and `apps/cli/src/types/types.ts`:
    take the branch's registry-derived structure (provider parity), then apply
    `main`'s deletions on top: no entry for any of the seven retired providers.
    Do not resurrect them.
  - `src/core/assistant-message/presentAssistantMessage.ts`: take `main`'s
    version (teaching-errors structure from `a2b2e102d`), then re-apply the
    branch's abort guard from `efcde397a` inside it. The guard is small; read
    `src/core/assistant-message/__tests__/presentAssistantMessage-abort.spec.ts`
    (branch side) first, it states the behavior.
  - `src/core/webview/ClineProvider.ts`: take `main`, re-apply the branch's
    `cliSettingsMirror` hook from `627bf3a1c` (a call site plus an import).
  - `src/package.json`: take `main` (`"version": "1.0.0"` and all its
    dependency edits), add the branch's single line `"punycode": "2.3.1"`.
  - `pnpm-lock.yaml`: do not hand-merge. Take either side, then run
    `pnpm install` and commit the regenerated lockfile with the merge.
- Commit the merge. Immediately run `pnpm install` again if the lockfile was
  taken from one side, and commit the lockfile delta as part of the merge
  commit (`git commit --amend` is acceptable here only because nothing has
  been pushed).

Verification: `git diff --name-only main...HEAD -- src packages | sort`
must list only files the branch's 8 non-CLI commits touched (plus the
lockfile). Anything else means a resolution took the wrong side.

### Slice 2: prove the compile errors of group 2 are gone (or fix them)

Run, in `apps/cli`: `pnpm check-types`, `pnpm build`,
`npx vitest run src/lib/storage/__tests__/settings.test.ts src/ui/__tests__/figures.test.ts src/commands/auth`.

Expected: `safeWriteJson`, `openExternal` and `string-width` errors are gone
(the merged tree has the branch's `packages/core/src/index.ts`, shim and
`apps/cli/package.json`, and the real install provides `string-width`).

Fallback if `safeWriteJson` still fails: the re-export reaches across package
boundaries (`packages/core/src/index.ts` importing
`../../../src/utils/safeWriteJson.js`). If `tsup` or `main`'s tsconfig rejects
that, move the function: copy `src/utils/safeWriteJson.ts` into
`packages/core/src/fs/safeWriteJson.ts`, export it from `packages/core`'s
index, and make `src/utils/safeWriteJson.ts` a re-export of the package copy,
so both the extension and the CLI import one implementation. Do NOT duplicate
the implementation inside `apps/cli` (the `.roo/rules-code/use-safeWriteJson.md`
rule exists precisely to keep one atomic-write path).

Fallback if `openExternal` still fails: the shim change from `05be453a3` was
lost in the merge; restore it from `git show 05be453a3 -- packages/vscode-shim`.

Verification: the three commands above green; also
`pnpm -C packages/core check-types` and `pnpm -C packages/vscode-shim test`.

### Slice 3: provider-surface drift (follow `main`'s intent)

Files and the exact edits:
- `apps/cli/src/lib/utils/provider-types.ts`: delete the `"vercel-ai-gateway"`
  entry (lines 132-136 on the branch). Grep the file for the other six retired
  names and delete any remaining entries.
- `apps/cli/src/lib/utils/context-window.ts`: delete the `requesty`, `unbound`
  and `vercel-ai-gateway` cases (lines 47-54 on the branch), matching `main`'s
  version of the same switch.
- `apps/cli/src/commands/cli/__tests__/run.test.ts:445-457`: the test "rejects
  --base-url for a provider without a base-url field" uses `unbound` as its
  example. Keep the test, change the example to an active provider whose
  schema has no base-url field (pick one by reading the registry in
  `packages/types/src/provider-config/configs.ts` on the merged tree; do not
  guess). If no active provider lacks a base-url field, the test's premise is
  gone and it is deleted with a one-line comment in the commit message.
- `apps/cli/src/lib/utils/__tests__/provider-types.test.ts:165-175`: same
  change, same rule.
- Any provider-list snapshot in `apps/cli/src/lib/utils/__tests__/provider.test.ts`
  (or wherever the "24 providers derived from registry" count is asserted):
  the count becomes whatever the registry yields; assert against the
  registry, not a literal.

Resolution rule stated once: the CLI follows `main`'s retirement. A retired
provider is neither selectable via `--provider` nor listed by the CLI; an
existing profile pointing at one keeps parsing and fails with the standard
"provider no longer supported" path that `d4a7f4182` introduced. No CLI-side
shim, alias or compatibility table for retired names.

Verification: `pnpm -C apps/cli check-types` (expect zero of the 12 errors
left), `npx vitest run src/lib/utils src/commands/cli` in `apps/cli`,
`pnpm -C apps/cli test`.

### Slice 4: the knip debt

Run from the properly installed integration worktree: `pnpm knip` at the root
and `npx knip --workspace apps/cli` for the focused list. Known items on the
branch point (resolve each; the rule is "delete if unused, otherwise wire the
import", never add to `ignore` lists):
- `apps/cli/src/ui/components/tools/utils.ts`: `truncateText`,
  `formatDiffStats`, `formatPath` (unused, delete; `sanitizeContent`,
  `getToolDisplayName`, `parseDiff` are used).
- `apps/cli/src/ui/theme.ts`: the unused keys knip names (delete only the
  keys; the file stays).
- `ASCII_ROO` (welcome art left from the rebrand) and `SDK_BASE_URL`: delete
  if unreferenced, or wire them where the rebrand intended.
- `resetOnboarding` in `apps/cli/src/lib/utils/onboarding.ts`: delete or
  expose it through the CLI command that was meant to call it; read the
  onboarding plan in `ai_plans/` before deciding.
- `apps/cli/src/ui/components/tools/GenericTool.tsx`: the duplicate export
  (named plus default); keep the default, drop the named one, or the reverse,
  matching how `tools/index.ts` imports it.
- Unused types `Theme` (`theme.ts`) and `View` (`apps/cli/src/ui/types.ts:103`):
  delete.
- The four fix slices added `buildStaticItems`, `flushPendingStreamUpdates`,
  `toggleVerboseTranscript`; all have importers, but confirm they do not show
  up.

Each deletion is a separate small commit so a wrong one is trivially
revertable.

Verification: `pnpm knip` at the root exits 0; `pnpm -C apps/cli check-types`,
`pnpm -C apps/cli lint`, `pnpm -C apps/cli test` still green.

### Slice 5: changesets, version and package naming

- Add `.changeset/cli-claude-style-transcript.md` with `"tumble-code": minor`
  (the extension package name on `main`; `fixed` groups it) describing, as
  one-line bullets in the house style of
  `.changeset/provider-cleanup-and-model-refresh.md`: the Claude-style
  scrollback transcript, the answer-promotion fix, ctrl+o verbose transcript,
  thinking visibility, provider parity minus the retired providers, ChatGPT
  subscription OAuth, permissions command, bundled ripgrep, the settings mirror
  from the extension to `~/.roo/cli-settings.json`, the ink 6.6.0 pin.
- `.changeset/config.json`: change `ignore: ["@roo-code/cli"]` to
  `ignore: ["@tumble-code/cli"]` (the CLI is versioned by its own
  `apps/cli/package.json`, not by changesets). Changesets refuses to run when
  an `ignore` entry matches no workspace package, so this is required, not
  cosmetic.
- `src/package.json` stays at `main`'s `1.0.0` (or whatever `main` has when
  the PR merges; a R00-B0T bump PR may move it). Do not touch the version.
- `apps/cli/package.json` version: bump `0.1.17` to `0.2.0` (the transcript
  redesign is a visible minor change; `build.sh` derives the local version
  string from this field).

Verification: `pnpm changeset status` at the root exits 0 and lists the new
changeset; `git diff main -- src/package.json` shows only the `punycode` line.

### Slice 6: full gates and the PR

- `pnpm check-types`, `pnpm lint`, `pnpm test` at the root (expect the
  pre-existing failures listed in memory for `@roo-code/agent-interchange`
  only; anything in `apps/cli`, `packages/core`, `packages/vscode-shim` or
  `src/core/assistant-message` must be green).
- `pnpm knip` exit 0.
- Push `integrate/cli-stack-to-main`, open the PR against `main` with the
  before/after gate table from slice 0 and this document linked. Squash-merge.

### Slice 7: rebuild, reinstall, verify the installed bundle (after the merge)

The installed bundle is NOT the dev tree: `build.sh` creates a release
`package.json` from `apps/cli/package.json` ranges and `install.sh` runs
`npm install` inside `~/.roo/cli`, resolving every dependency fresh at install
time. That is how the dev tree ran ink 6.6.0 while the installed bundle got
6.8.0 (the +1 row per frame staircase), which is why `ink` is now pinned to an
exact version. Any range that drifted since 2026-08-09 can bite the same way.

- From a checkout of `main` after the squash merge:
  `./apps/cli/scripts/build.sh --install` (do not pass `--skip-verify`).
- Confirm `cat ~/.roo/cli/package.json` shows a version string ending in the
  new `main` short hash, and `grep '"version"' ~/.roo/cli/node_modules/ink/package.json`
  prints exactly `6.6.0`.
- Compare `~/.roo/cli/package.json` dependencies with the previous install's
  (keep a copy before reinstalling); any version that moved is a candidate
  cause if the checks below regress.
- Re-run the five manual checks from
  `ai_plans/2026-09-21_cli-answer-lost-in-dynamic-tail.md`, slice 5, on the
  installed `tumble` in a 24-row terminal: full answer promoted to scrollback;
  no duplicated rows; thinking plus answer both promoted; ctrl+o reprint and
  collapse; Escape mid-stream then a new prompt.
- Also check the retirement: `tumble --provider unbound ...` must fail with
  the standard unsupported-provider message, not a stack trace.

Only after this passes: slice 8.

### Slice 8: cleanup

- Delete `fix/cli-answer-lost-in-dynamic-tail`, `integrate/cli-stack-to-main`
  and the `/tmp` worktrees.
- Keep `rescue/cli-installed-build` for one more release cycle as the exact
  source of the previously installed binary (`0.1.17-local.f6ed54afd`), then
  delete it once the new installed build has been in daily use.

## Risks

- Wrong side taken in the merge for one of the six overlapping files. Caught
  by the slice 1 name-only diff check and by the abort spec
  (`presentAssistantMessage-abort.spec.ts`) and mirror spec
  (`src/utils/__tests__/cliSettingsMirror.spec.ts`) staying green.
- The `safeWriteJson` cross-package relative export may be legal for `tsc` but
  fragile for `tsup` bundling or for knip's module graph. Slice 2's fallback
  handles it; if the fallback is needed it touches the extension too and
  deserves its own commit.
- A retired-provider reference survives somewhere the type checker cannot see
  (a string in a test fixture, `docs/`, the README's provider table). Grep
  `apps/cli` for the seven names after slice 3.
- knip on `main` may flag things beyond the list above once the merged tree is
  installed for real (the branch-point list came from
  `npx knip --workspace apps/cli`, not the root run). Budget for a second pass.
- A R00-B0T changeset bump PR merging into `main` while the integration PR is
  open moves `src/package.json`; re-merge `main` before squash-merging.
- The installed bundle regressing on a dependency other than ink. Mitigated by
  the dependency comparison in slice 7; the fix is an exact pin in
  `apps/cli/package.json`, same as for ink.
- Two agents working the live tree at once (this has wiped uncommitted edits
  before): the integration happens in its own worktree, and each slice is
  committed as soon as it is green.

## Rollback story

- Before the PR merges: nothing on `main` changed; delete the integration
  branch and worktree, the rescue and fix branches are untouched.
- After the PR merges but before reinstalling: `git revert -m 1 <squash sha>`
  on `main` (a squash merge is a normal commit, so a plain `git revert` works).
  The user's installed binary is still `0.1.17-local.f6ed54afd`, unaffected.
- After reinstalling, if the installed build misbehaves: rebuild from
  `rescue/cli-installed-build` with `./apps/cli/scripts/build.sh --install`
  (this is exactly the code the previous binary was built from; the version
  string will again end in `f6ed54afd`), then revert on `main` as above and
  diagnose against the two builds side by side. This is why the rescue branch
  is kept until slice 8.
