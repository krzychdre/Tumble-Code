# Zoo PR #55 — Update @ai-sdk/amazon-bedrock to v4.0.107

- **Upstream:** Zoo-Code #55, squash `b2b4ee42a`, merged 2026-05-15 22:13, author renovate[bot].
- **Branch:** `feature/zoo-55-amazon-bedrock-4.0.107` (off `main`).
- **Credit:** `Co-authored-by: renovate[bot] <29139614+renovate[bot]@users.noreply.github.com>`.

## Change

Pure dependency bump. `src/package.json` declares
`"@ai-sdk/amazon-bedrock": "^4.0.51"` (identical in both repos); upstream PR touched only
`pnpm-lock.yaml`. Our lock resolves `4.0.51`; upstream targets `4.0.107`, which satisfies
`^4.0.51` — no `package.json` edit required.

## Approach

Regenerate the lockfile only, pinning resolution to `4.0.107` to match upstream intent:

```
pnpm update @ai-sdk/amazon-bedrock@4.0.107 --lockfile-only
git checkout src/package.json   # restore ^4.0.51 if pnpm rewrote it
pnpm install --lockfile-only    # reconcile importer specifier back to ^4.0.51 @ 4.0.107
```

Verify the diff is scoped to `@ai-sdk/amazon-bedrock` + transitive deps; importer
specifier reads `^4.0.51` with version `4.0.107(zod@3.25.76)` (matching upstream lock).

## Verification

- Lock resolves `@ai-sdk/amazon-bedrock@4.0.107`; no `4.0.51` left; package.json unchanged.
- Build gate: `pnpm install:vsix -y --editor=code` must be green before push.
