# Mixed CLI changesets block the release - investigation & fix

**Status:** done
**Related plans:** ai_plans/2026-10-12_13-00_cli-display-prompt.md
**Touched:** `.changeset/cli-display-prompt.md`, `.changeset/cli-display-prompt-cli.md`, `.changeset/cloud-web-task-images.md`, `.changeset/cloud-web-task-images-cli.md`, `scripts/check-changesets.mjs`, `scripts/__tests__/check-changesets.test.mjs`, `.github/workflows/code-qa.yml`

## Symptom

`pnpm changeset status` on main (d4f02ec50) fails:

```
Error: Found mixed changeset cli-display-prompt
Found ignored packages: @tumble-code/cli
Found not ignored packages: tumble-code
Mixed changesets that contain both ignored and not ignored packages are not allowed
```

`changeset version`, which the Changeset Release workflow runs after every merge to main, fails the same way, so
no version bump PR can be opened.

## What was happening

`.changeset/config.json` lists `@tumble-code/cli` in `ignore`, and changesets also treats a workspace package
without a `version` field (`@tumble-code/vscode-webview`) as ignored. A changeset file may name ignored packages or
released packages, never both. Two files on main named `"tumble-code"` and `"@tumble-code/cli"` together:
`cli-display-prompt.md` (#858) and `cloud-web-task-images.md` (#877). The command reports only the first bad file per
run, so the second one only showed up after the first was split.

No PR check runs `changeset version` or `changeset status`, so both files passed review and CI. The same mistake
was fixed once before (#799).

## Fix

- Each mixed file is split into a `tumble-code` file (the original name, extension wording) and a `-cli` file
  (`@tumble-code/cli` only). The text is unchanged apart from `cli-display-prompt.md`, whose extension half now
  describes the prompt section instead of the terminal UI.
- `scripts/check-changesets.mjs` reads the ignore list and every workspace `package.json`, and fails when a
  changeset names both an ignored (or unversioned) package and a released one. It runs in the Code QA workflow next
  to the other guard scripts, so the mistake now fails the PR instead of the release.

## Tests

- `scripts/__tests__/check-changesets.test.mjs`: one-sided files pass; an ignored plus released file is flagged; a
  package without a version counts as ignored.
- The script exits 1 on a copy of the tree with main's `cli-display-prompt.md` added back, and 0 on this branch.
- `pnpm changeset status` exits 0 on this branch.

## Notes

- The guard does not run `changeset status` itself: that command compares against the base branch with git, which a
  shallow PR checkout does not have.
