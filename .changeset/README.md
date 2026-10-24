# Changesets

The extension and the CLI ship in one release under one version number, with one `CHANGELOG.md`. Every user-facing
change to either adds one file here (`pnpm changeset`, or by hand), always naming `"tumble-code"`. The changelog ships
in the VSIX, the Marketplace shows it, and the GitHub release quotes the version's section. Write each file for a user
reading that page.

How a release happens:

1. A merge to `main` with pending files makes the Changeset Release workflow open the "Changeset version bump" PR.
   `pnpm changeset:version` writes the new `CHANGELOG.md` section (`scripts/format-changelog.mjs`), bumps
   `src/package.json` and gives `apps/cli/package.json` the same version (`scripts/sync-cli-version.mjs`).
2. Merging that PR runs Publish Release (`.github/workflows/marketplace-publish.yml`): it builds the CLI tarballs for
   macOS arm64, Linux x64 and Linux arm64, then tags `v<version>`, publishes the extension to the Marketplace and
   creates the GitHub release with the VSIX and the CLI tarballs. The CLI installer and `tumble upgrade` take the CLI
   from that latest release.

```md
---
"tumble-code": minor
---

New: **Several editor tabs.** The title bar of a Tumble tab has an "Open In New Tab" button.
```

- **Start the summary with a label**: `New:`, `Improved:` or `Fixed:`. The release section groups the entries under
  `### New`, `### Improved` and `### Fixed`. `node scripts/check-changesets.mjs` (Code QA) rejects an extension
  changeset without one.
- **Then a bold title of a few words, then one or two short sentences** on what the user notices. No file names,
  class names or implementation details; the pull request has those.
- **Internal changes get no changeset**: refactors, tests, CI, dead code removal, dependency bumps with no visible
  effect.
- **Highlights**: the person cutting a release may add one changeset whose summary starts with `Highlights:` and holds
  two or three sentences on the release as a whole. It becomes the paragraph under the version heading.
- The bump (`major`, `minor`, `patch`) only picks the next version number; it does not show in the changelog.
- **CLI changes name `"tumble-code"` too** and start the title with `CLI:`, for example
  `Fixed: **CLI: typing and layout.** ...`. A changeset that names `@tumble-code/cli` or the webview package would
  never reach the changelog; Code QA rejects it.
