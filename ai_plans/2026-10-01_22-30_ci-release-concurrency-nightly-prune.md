# CI: release workflow race, nightly release pile, Marketplace step without a token

**Status:** done (A9 of `ai_plans/2026-10-01_simplification-round-2.md`)
**Touched:** `.github/workflows/changeset-release.yml`, `.github/workflows/nightly-publish.yml`,
`.github/workflows/marketplace-publish.yml`, `.github/actions/slack-notify/` (deleted)

## Problem

- `changeset-release` failed in 14 of its last 50 runs with `cannot lock ref 'refs/heads/changeset-release/main'`:
  two pull requests merged close together start two runs that push the same branch at the same time. No workflow
  had a `concurrency` block. Meanwhile 357 changesets wait and the version bump PR #522 is open since 2026-09-26.
- `nightly-publish` creates a new prerelease `nightly-vN` on every push to main: 556 of them on 2026-10-01.
- `marketplace-publish` (runs when the version bump PR is merged) fails at "Publish Extension" because the fork has no
  `VSCE_PAT`, so the GitHub release step after it never ran either.
- `.github/actions/slack-notify` is used by no workflow.

## Fix

- `changeset-pr-version-bump` job: `concurrency: changeset-version-bump`, `cancel-in-progress: false` (runs queue).
- `nightly-publish`: workflow-level concurrency, and a last step that deletes every `nightly-v*` release (and its
  tag) except the newest 10. The existing pile was pruned once by hand with the same selection (546 deleted).
- `marketplace-publish`: the Marketplace step runs only when `VSCE_PAT` is set; the tag and the GitHub release with
  the VSIX are created either way.
- Deleted the unused Slack action.

## Tests

The prune selection was run as a dry run with `gh release list ... --jq` (546 tags selected, the 10 newest kept, no
non-nightly releases exist). YAML parsed with PyYAML. The workflows themselves run on the next merge.
