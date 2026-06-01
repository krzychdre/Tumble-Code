# Zoo PR #64 — Update lint-staged to v16.4.0

- **Upstream:** Zoo-Code #64, squash `e7382a33c`, merged 2026-05-14 19:46, author renovate[bot].
- **Branch:** `feature/zoo-64-lint-staged-16.4.0` (off `main`).
- **Credit:** `Co-authored-by: renovate[bot] <29139614+renovate[bot]@users.noreply.github.com>`.

## Change

Pure dependency bump. Root `package.json` already declares
`"lint-staged": "^16.0.0"` (identical in both repos); upstream PR touched only
`pnpm-lock.yaml`. Our lock resolves `lint-staged@16.1.2`; upstream targets `16.4.0`,
which satisfies `^16.0.0` — no `package.json` edit required.

## Approach

Regenerate the lockfile only, pinning resolution to `16.4.0` to match upstream intent:

```
pnpm update lint-staged@16.4.0 --lockfile-only
git checkout package.json   # pnpm update rewrites the range; restore ^16.0.0
pnpm install --lockfile-only # reconcile importer specifier back to ^16.0.0 @ 16.4.0
```

Verify the diff is scoped to `lint-staged` + transitive deps; importer specifier reads
`^16.0.0` with version `16.4.0` (matching upstream lock).

## Verification

- Lock resolves `lint-staged@16.4.0`; no `16.1.2` left; package.json unchanged.
- Build gate: `pnpm install:vsix -y --editor=code` must be green before push.
