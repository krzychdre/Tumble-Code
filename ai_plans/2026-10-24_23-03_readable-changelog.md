# Readable changelog: highlights and New / Improved / Fixed

**Status:** done on branch `chore/readable-changelog`
**Related plans:** `2026-08-26_changeset-1.0.0-sync.md`, `2026-10-24_20-15_marketplace-entra-publish.md`
**Touched:** `scripts/format-changelog.mjs` (new), `scripts/check-changesets.mjs`, `.changeset/changelog-config.js`,
`.changeset/README.md`, `package.json` (`changeset:version`), `.github/workflows/marketplace-publish.yml`, `AGENTS.md`,
`docs/10-adding-things.md`, `CHANGELOG.md`, tests in `scripts/__tests__/`

## Symptom

The changelog the Marketplace shows for Tumble Code 1.1.0 was unreadable: about 570 paragraph-long bullets under
"Minor Changes" and "Patch Changes", internal refactors next to user-facing changes, followed by the whole Roo Code 3.x
history (3934 lines, 412 KB inside the VSIX). The owner also objected to "Minor Changes" heading a release with that
many changes.

## What was happening

- `changeset version` (`@changesets/apply-release-plan`) writes `## 1.1.0` and groups the entries by semver bump
  under the hardcoded headings `### Major Changes`, `### Minor Changes`, `### Patch Changes`. The changelog config
  (`.changeset/changelog-config.js`) controls only the text of one entry, not the headings.
- Every changeset summary went in verbatim, written while working on its branch: implementation detail, file names,
  "no behaviour change" refactors.
- The root `CHANGELOG.md` still carried the inherited Roo Code history below `## 1.0.0`.

## Fix

- **Labels in the summary.** An extension changeset now starts with `New:`, `Improved:` or `Fixed:` (optionally one
  `Highlights:` changeset per release), then a bold title and one or two sentences for users. Internal changes get no
  changeset. Written down in `.changeset/README.md`, pointed to from `AGENTS.md` and `docs/10-adding-things.md`.
- **One bullet per changeset.** `getReleaseLine` joins the summary lines into one bullet, so the label stays at its
  start.
- **`scripts/format-changelog.mjs`** runs in `pnpm changeset:version` right after `changeset version` and rewrites the
  new section: `## 1.2.0`, a `Released <date>` line, the Highlights paragraphs, then `### New`, `### Improved`,
  `### Fixed`. The heading stays the bare version because changesets/action finds the version bump PR's entry by it
  (with a dated heading it would quote the whole changelog). The Major/Minor/Patch headings are dropped. A first
  section without those headings is a formatted release and is left alone (no new extension changesets). An entry
  without a label throws.
- **`scripts/check-changesets.mjs`** (Code QA) rejects an extension changeset without a label, so the release job
  cannot hit that throw.
- **Release notes.** The awk in `marketplace-publish.yml` compares the heading's second field, so `## 1.2.3` and the
  old `## [1.2.3]` both match.
- **CHANGELOG.md rewritten.** 1.1.0 and 1.0.0 are condensed into the new layout (about 70 bullets in total instead of
  about 620); the Roo Code history is replaced by a link to the Roo Code changelog. The full old text stays at tag
  `v1.1.0`.

## Tests

- `scripts/__tests__/format-changelog.test.mjs`: a changesets-shaped section becomes highlights plus grouped sections
  and the older release stays untouched; an already dated first section is returned unchanged; an unlabeled entry
  throws.
- `scripts/__tests__/check-changesets.test.mjs`: labeled one-sided changesets pass; an extension changeset without a
  label is flagged while CLI and other package changesets are not.
- Mutations, each made red by the tests and then restored: dropping the date guard, dropping the throw, rendering
  Highlights as a section, requiring labels on every package, testing the label against the raw file instead of the
  summary.
- End to end in a scratch worktree: three labeled changesets plus `pnpm changeset:version` produced the dated, grouped
  section and the right version bump; the release-notes awk extracted the 1.2.0, 1.1.0 and 1.0.0 sections.

## Notes

- The Marketplace keeps the old 1.1.0 changelog until the next publish; the changelog lives inside the VSIX.
- The date is the day the "Changeset version bump" PR is generated, not the day it is merged.
- Highlights are optional: without a `Highlights:` changeset the section starts straight with `### New`.
