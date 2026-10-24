# Changesets

Every user-facing change to the extension adds one file here (`pnpm changeset`, or by hand). On release,
`pnpm changeset:version` turns the pending files into a new section of `CHANGELOG.md`, which ships in the VSIX and is
what the Marketplace shows as the extension's changelog. Write each file for a user reading that page.

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
- The CLI (`@tumble-code/cli`) and the webview package are not released through changesets; their files never reach
  `CHANGELOG.md` and need no label. A change that ships in both the extension and the CLI needs two files.
