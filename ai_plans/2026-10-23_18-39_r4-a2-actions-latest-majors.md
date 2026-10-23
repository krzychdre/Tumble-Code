# R4 A2: GitHub Actions on their latest majors, all SHA-pinned

**Status:** done.
**Related plans:** `2026-10-23_17-20_maintenance-audit-round-4.md` (item A2).
**Touched files:** `.github/actions/setup-node-pnpm/action.yml`, `.github/workflows/*.yml`.

## Problem

Most actions ran on majors that target Node 20, which the runner forces onto Node 24 with a deprecation
annotation. Three actions (`hmarr/auto-approve-action`, `changesets/action`, `actions/github-script`) were pinned by
a moving tag while the rest were pinned by commit SHA.

## Change

Every `uses:` outside the local composite action is pinned to the commit of the latest release, with the exact
version as a comment. Tag objects were dereferenced to their commits.

| Action                               | Version | Commit                                   |
| ------------------------------------ | ------- | ---------------------------------------- |
| actions/checkout                     | v7.0.1  | 3d3c42e5aac5ba805825da76410c181273ba90b1 |
| actions/cache                        | v6.1.0  | 55cc8345863c7cc4c66a329aec7e433d2d1c52a9 |
| actions/setup-node                   | v7.1.0  | 949feb2413d6458794dcd2491c4babbbce0c15c1 |
| pnpm/action-setup                    | v6.1.0  | ea17c68df8912ef543352723c149a84f56e3d413 |
| actions/upload-artifact              | v7.0.2  | cf430e030ddbb5b0abf93d22962f4752f3646cd9 |
| actions/download-artifact            | v8.0.2  | 9000827ccba6bdab643e8b6fd33ac0654aef8333 |
| actions/github-script                | v9.0.0  | 3a2844b7e9c422d3c10d287c895573f7108da1b3 |
| github/codeql-action (init, analyze) | v4.39.1 | 9b3254085494b55a0f7c4c2b3d2d52cc712ce370 |
| changesets/action                    | v2.1.2  | ae32849d5ba541f9ae29e40e22a623bc13562f51 |
| hmarr/auto-approve-action            | v4.0.0  | f0939ea97e9205ef24d872e76833fa908a770363 |
| astral-sh/setup-uv                   | v10.3.2 | 07a047e608db84b3d8c06cd9a7c7dcc9c355c18e |

Breaking changes checked against our workflows:

- `actions/checkout` v6 stores the persisted credentials in a separate file but still persists them by default, so
  the `git push` steps in `changeset-release.yml`, `marketplace-publish.yml` and `cli-release.yml` keep working.
  v7 refuses fork PR checkouts under `pull_request_target` and `workflow_run`; no workflow uses those triggers.
- `actions/setup-node` v5 caches automatically from `packageManager`, v6 limits that to npm, so nothing changes for
  pnpm. v7 drops the dummy `NODE_AUTH_TOKEN` export; no workflow uses `registry-url`.
- `actions/upload-artifact` v7 still zips by default. `actions/download-artifact` v5 changed only by-id downloads and
  v8 fails on digest mismatch; `cli-release.yml` downloads all artifacts by pattern into `artifacts/` and copies the
  files with `find`, which is unaffected.
- `actions/github-script` v9 removes `require('@actions/github')` and reserves `getOctokit`; our script only calls
  `github.rest.issues.addLabels`.
- `changesets/action` v2 renamed the inputs (`commit` to `commit-message`, `title` to `pr-title`, `version` to
  `version-script`), takes the token from the `github-token` input (default `github.token`) instead of the
  `GITHUB_TOKEN` env, and pushes the release branch through the GitHub API by default. The workflow uses the new
  input names and drops the env. The PR title stays `Changeset version bump`, which the approve job matches.
- `pnpm/action-setup` v6 keeps the `version` input; the pinned 10.8.1 equals `packageManager`.

## Tests

Workflows are the test. `grep -rn 'uses:' .github | grep -v '@[0-9a-f]\{40\}'` prints only the local
`./.github/actions/setup-node-pnpm` lines; every workflow file parses as YAML.

## Notes

`hmarr/auto-approve-action` v4.0.0 is the latest release and still declares `node20`; the runner forces it onto
Node 24. No newer release exists.
