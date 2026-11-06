# Release workflows: tag the landed commit, gate on the bump branch, drop dead jobs

**Status:** done on `fix/sec-release`
**Related:** `private_docs/security-audit-2026-11-06/report.md` section 6 (P-1, P-2, P-3, P-9, P-10, P-13, P-14, P-17, PO-9)
**Touched:** `.github/workflows/marketplace-publish.yml`, `.github/workflows/changeset-release.yml`,
`.github/workflows/nightly-publish.yml`, `apps/vscode-nightly/package.json`, `src/package.json`, `package.json`, `pnpm-lock.yaml`

## Problems and causes

- **P-1.** `marketplace-publish.yml` checked out, tagged and released `github.event.pull_request.head.sha`. After a
  squash merge that is the branch tip, not a commit on `main`: tag `v1.2.0` points at `9395241bf` (PR #1156 head),
  while the commit on `main` is `58869b270`, and `git branch -r --contains` of the tag is empty. The payload field
  for the landed commit is `pull_request.merge_commit_sha`. `changeset-release.yml` used the same head SHA for its
  checkout (changesets/action resets to `context.sha` anyway, so only the changeset count read the wrong tree).
- **P-2.** The release gate was `contains(title, 'Changeset version bump')`, so any merged PR with that text in its
  title published.
- **P-3, P-13.** Job 2 of `changeset-release.yml` (changelog commit, label, auto-approve) interpolated
  `github.head_ref` into bash and pushed on closed, unmerged PRs. It ran only for `github.actor == 'R00-B0T'`, the
  upstream Roo bot. Here the bump PR is opened by `github-actions[bot]` through `GITHUB_TOKEN`, whose events start
  no workflows, and the `changelog-ready` label does not exist: none of the last 1000 runs is an "Update Changelog"
  run. Dead code holding a write token.
- **P-14.** The tag was pushed before the Azure login and the Marketplace publish, so a failure there left a tag
  without a release and the re-run died on `git tag`.
- **P-17.** `src/.vscodeignore` starts with `**` and has not re-included `.env` since #1049, so `--allow-package-env-file`
  only switched off vsce's own refusal to package a `.env`. The CI `grep` duplicated that check.
- **P-9.** The nightly ran `npx vsce` from `build/`, a directory whose `package.json` has no dependencies.
- **P-10, PO-9.** The nightly picked `ls bin | head -n1` and cloned the full history; the build needs only `HEAD`.

## Fix

- Publish and changeset workflows check out and tag `merge_commit_sha` (`main` on `workflow_dispatch`).
- Publish gate: merged into `main` from `head.ref == 'changeset-release/main'`, the branch changesets/action pushes.
  The `if` lives on `build-cli` only; `publish-extension` needs it and is skipped with it.
- The tag step moved after the Marketplace and Open VSX publishes, just before `gh release create`.
- Job 2, its `opened`/`labeled` triggers and the R00-B0T run-name are gone.
- `vsix` and `vsix:nightly` no longer pass `--allow-package-env-file`; vsce now fails on any packaged `.env`, also for
  local `pnpm install:vsix`. The CI grep is gone.
- Nightly: `@vscode/vsce` moved from the root manifest (its only user was this `npx`) to `apps/vscode-nightly`, called as `vsce`; the asset name comes from the computed
  version; default checkout depth.

## Tests

Workflows cannot run before a release. `actionlint` 1.7.12 passes on all workflows. `vsce ls --no-dependencies` in
`src/` with a dummy `src/.env` lists no `.env`. `pnpm exec` in `apps/vscode-nightly` resolves
`apps/vscode-nightly/node_modules/.bin/vsce`.

## Not done

- No `concurrency` on the publish job: there is one bump branch, so two release runs for one version need a manual
  dispatch during a release, and the second one fails on the Marketplace duplicate-version check anyway.
- No CLI-versus-extension version assertion: `scripts/sync-cli-version.mjs` writes the CLI version in every
  `changeset:version` run.
