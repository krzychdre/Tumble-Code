# One release for the extension and the CLI

**Status:** done on branch `feat/unified-release` (stacked on `chore/readable-changelog`)
**Related plans:** `2026-10-24_23-03_readable-changelog.md`, `2026-10-24_20-15_marketplace-entra-publish.md`
**Touched:** `scripts/sync-cli-version.mjs` (new), `package.json` (`changeset:version`), `scripts/check-changesets.mjs`,
`.github/workflows/marketplace-publish.yml`, `apps/cli/scripts/build.sh`, `apps/cli/install.sh`,
`apps/cli/src/commands/cli/upgrade.ts`, `apps/cli/package.json`, `.changeset/*`, `AGENTS.md`, `apps/cli/README.md`,
tests; deleted `.github/workflows/cli-release.yml`, `apps/cli/CHANGELOG.md`, `.roo/commands/cli-release.md`

## Symptom

The owner wants one release system: the extension and the CLI share one version number (extension 1.1.0 = CLI
1.1.0), one changelog, and one release publishes both. The next version is 1.1.1.

Before: the CLI had its own version (0.2.0), its own changelog (last entry 0.1.17, inherited from Roo Code), and a
manual workflow (`cli-release.yml`, `cli-v<version>` tags, pre-releases) that had never run in this repository. So no
CLI release existed and the installer failed with "Could not find any CLI releases". The 36 CLI changesets and 8
webview changesets in `.changeset/` named packages that changesets ignores, so they never reached any changelog.

## Fix

- **One version.** `scripts/sync-cli-version.mjs` copies the version of `src/package.json` into
  `apps/cli/package.json`; `pnpm changeset:version` runs it after `changeset version`. The CLI stays on changesets'
  ignore list, so changesets writes no second changelog.
- **One changelog.** CLI changes are changesets of `"tumble-code"` with a `CLI:` title. `check-changesets.mjs` now
  rejects every changeset that names an ignored or unversioned package (the CLI, the webview), which replaces the old
  "mixed packages" check. `apps/cli/CHANGELOG.md` is deleted.
- **One release.** `marketplace-publish.yml` ("Publish Release") gets a `build-cli` matrix job (macOS arm64, Linux
  x64, Linux arm64) that runs `apps/cli/scripts/build.sh --release` and a checksum; `publish-extension` needs it,
  so a failed CLI build stops the release before the tag, the Marketplace and the GitHub release. The release
  `v<version>` carries the VSIX, the three tarballs and their `.sha256` files, and its notes end with install lines.
- **`build.sh --release`** versions the tarball as in `apps/cli/package.json` without the `-local.<hash>` suffix.
  CI reuses the local build script instead of the 120-line copy of it that `cli-release.yml` held, and gets its
  install check (`--help`, `--version`) for free.
- **Installer and `tumble upgrade`** read `GET /repos/krzychdre/tumble-code/releases/latest` (nightly builds are
  pre-releases, never "latest") and download from `releases/download/v<version>/`.
- **Pending changesets.** The 43 old files are replaced by 16 labeled `patch` changesets (one of them Highlights),
  so the next bump gives 1.1.1. Dropped: webview entries (internal, or already described in 1.1.0), CLI entries that
  1.1.0 already lists (display prompt, cloud task images, cloud status line) and internal ones (state store, SDK
  client removal).
- **Tags.** The 32 `cli-v0.0.42` .. `cli-v0.1.17` tags inherited from Roo Code (none had a release here) are deleted
  from origin and locally. Backup: `/home/krzych/backups/tumble-cli-tags-20261024/` (bundle with all 32 refs and the
  name/SHA list).

## Tests

- `check-changesets.test.mjs`: labeled changesets of released packages pass; changesets naming the CLI or the
  webview are flagged; an unlabeled extension changeset is flagged.
- `upgrade.test.ts`: the latest version comes from `/releases/latest` with the `v` stripped; up-to-date and newer
  cases use the new response shape.
- `install-script.test.ts`: the installer asks `/releases/latest` and downloads `releases/download/v1.2.3/...`, and a
  pinned `ROO_VERSION` downloads from `v9.8.7`.
- End to end: `pnpm changeset:version` in a scratch worktree bumped `src/package.json` and `apps/cli/package.json`
  to 1.1.1, consumed all 16 changesets and wrote the dated 1.1.1 section; no other file changed.
  `./apps/cli/scripts/build.sh --release` built `bin/tumble-cli-linux-x64.tar.gz` with version 1.1.0 and passed its
  install check.

## Notes

- The macOS and Linux arm64 build jobs run for the first time on the next release; a failure there stops the release
  before anything is published, and Publish Release can be re-run from Actions after a fix.
- Until 1.1.1 is out, the latest release (v1.1.0) has no CLI tarball, so the installer reports "Release not found".
- Unchanged and out of scope: Publish Release starts on any closed "Changeset version bump" PR, merged or not.
