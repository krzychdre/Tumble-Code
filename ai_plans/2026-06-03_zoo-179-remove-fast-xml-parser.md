# Zoo-179: Remove unused `fast-xml-parser` dependency

## §0 Context & Credit

Ported from Zoo-Code PR #179, upstream commit `9d3670f12`.
Original author: Elliott de Launay <edelauna@gmail.com>.

Co-authored-by: Elliott de Launay <edelauna@gmail.com>

## §1 What & Why

`fast-xml-parser` was declared as a direct dependency in `src/package.json`
but was never imported anywhere in the codebase. Removing it:

- Shrinks the install surface (fewer packages to audit for vulnerabilities).
- Eliminates a dead entry from the dependency manifest, reducing maintenance
  noise from automated dependency-update bots.

## §2 Scope

Changes are limited to two files:

| File               | Change                                                        |
| ------------------ | ------------------------------------------------------------- |
| `src/package.json` | Delete `"fast-xml-parser": "^5.0.0",` from `dependencies`     |
| `pnpm-lock.yaml`   | Regenerated via `pnpm install` to drop the direct-dep entries |

`fast-xml-parser` remains in the lockfile as a **transitive** dependency of
`@aws-sdk/xml-builder` (pulled in by AWS SDK packages elsewhere in the
monorepo). This is expected and does not indicate the removal was wrong.

Verified unused with:

```
grep -rn "fast-xml-parser|XMLParser|XMLBuilder|XMLValidator" src --include="*.ts"
# → 0 results
```

## §3 Verification

1. `pnpm install` completed cleanly.
2. `grep -c "fast-xml-parser" pnpm-lock.yaml` dropped from **6 → 3**; the
   remaining 3 are transitive references owned by `@aws-sdk/xml-builder`.
3. Root `pnpm check-types` passes (13/13 packages — confirms no code depended
   on the package's type declarations).

## §4 Acceptance Criteria

- [ ] `src/package.json` no longer contains `fast-xml-parser`.
- [ ] `pnpm-lock.yaml` has no direct-dep block for `fast-xml-parser` under the
      `src` specifier.
- [ ] `pnpm check-types` exits 0 with 13/13 successful.
- [ ] CI passes on the PR branch.
