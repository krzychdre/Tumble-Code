# Port Zoo PR #659 — undici 6.27.0 security update

## §0 Credit & provenance

- Upstream: Zoo-Code-Org/Zoo-Code PR #659, commit `f798462f4`, merged 2026-06-20.
- Author: Elliott de Launay (renovate[bot] dropped as a bot).
- Commit trailer:
    ```
    Co-authored-by: Elliott de Launay <edelaunay@wealthsimple.com>
    ```

## §1 What & why

Security update of `undici` to `6.27.0`. **Unlike the vite bump (#642), this one is
NOT already satisfied here**: our lockfile resolved `undici@6.26.0` (below the
patched 6.27.0) via the `^6.21.3` floor. Bumping the floor pulls in the fix.

## §2 Edits

- `package.json` (pnpm.overrides): `"undici": "^6.21.3"` → `"^6.27.0"`.
- `src/package.json` (devDeps): `"undici": "^6.21.3"` → `"^6.27.0"`.
- Refresh `pnpm-lock.yaml` → now resolves `undici@6.27.0`.

## §3 Scope cuts (divergence / noise)

- Our root override was already `^6.21.3` (Zoo's pre-PR was `>=5.29.0`); kept our
  caret convention rather than Zoo's exact `6.27.0` pin.
- **Did NOT port the `ClineProvider.flicker-free-cancel.spec.ts` changes** bundled in
  this PR — they are an unrelated test refactor squashed into the renovate bump, not
  part of the security fix, and our ClineProvider tests have diverged.

## §4 Verify (binary acceptance) — all ✓

- `pnpm install --lockfile-only` succeeds; lockfile resolves `undici@6.27.0`, no 6.26.0.
- `pnpm --filter tumble-code check-types` passes.
