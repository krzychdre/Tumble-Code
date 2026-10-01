# Nightly: replace marketplace publish with a GitHub release

**Date:** 2026-06-01
**Branch:** `ci/nightly-github-release`

## Problem

The `Nightly Publish` workflow (`.github/workflows/nightly-publish.yml`) runs on every
push to `main`. It fails on the **Publish to VS Code Marketplace** step (and would also
fail on **Publish to Open VSX Registry**) because this community fork (Tumble Code) does
not have `VSCE_PAT` / `OVSX_PAT` secrets configured and is not published to those
registries.

## Decision

Don't publish to the marketplaces from the nightly job. Instead, build the nightly VSIX
as before and attach it to an automatically-created **GitHub prerelease** so users can
download the nightly build directly from the repo's Releases page.

## Changes

`.github/workflows/nightly-publish.yml`:

1. Bump job permission `contents: read` → `contents: write` (needed to create a
   release + tag).
2. In the version step, also expose the **full** version string (`0.0.<number>`) as an
   output so the release step can name the tag/release.
3. Remove the two marketplace publish steps (VS Code Marketplace, Open VSX).
4. Add a **Create GitHub Release** step using `gh release create`:
    - tag `nightly-v<version>` (unique per run via `github.run_number`),
    - `--prerelease`, `--title "Nightly v<version>"`,
    - attaches the built VSIX from `bin/`,
    - uses the built-in `GITHUB_TOKEN`.

## Notes / non-goals

- `marketplace-publish.yml` (the stable release-on-changeset workflow) is left untouched.
- No marketplace secrets are required anymore for nightlies.
- Build still runs on every push to `main`, acting as a build sanity check + nightly
  artifact producer.
