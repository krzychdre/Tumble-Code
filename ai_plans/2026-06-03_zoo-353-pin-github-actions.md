# Zoo #353 — Pin GitHub Actions to Commit SHAs

## §0 Context & Credit

Upstream Zoo-Code PR #353, authored by **renovate[bot]** (a bot, not a human).
Upstream commit: `45ff598e7`.
No `Co-authored-by` trailer is added — bot authorship does not qualify for that trailer.

## §1 What & Why

GitHub Actions support mutable tags (e.g. `actions/checkout@v4`). A tag can be silently moved to a different commit after the workflow is written, enabling supply-chain attacks where malicious code is injected into CI. Pinning to an immutable commit SHA (with a `# vN` comment for readability) eliminates this attack surface. No workflow logic is changed — only the `uses:` ref strings.

## §2 Scope

**In scope:**
- All 11 action@version pairs listed in the mapping table below, across all files under `.github/`.
- Our fork has extra workflows beyond Zoo's (e2e.yml and release-validation.yml do not exist here; the extra ones we have — nightly-publish.yml, cli-release.yml, marketplace-publish.yml — are also pinned where applicable).

**Out of scope:**
- Zoo's `e2e.yml` and `release-validation.yml` (do not exist in this fork).
- Non-mapped actions: `peter-evans/create-pull-request@v7`, `changesets/action@v1`, `actions/github-script@v7`, `hmarr/auto-approve-action@v4`, `8398a7/action-slack@v3`, `docker/setup-buildx-action@v3`, `docker/build-push-action@v6`.
- No workflow logic, triggers, permissions, env vars, or step ordering changed.

## §3 Pin Mapping

| Floating ref | Pinned SHA | Comment |
|---|---|---|
| `actions/cache@v4` | `actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830` | `# v4` |
| `actions/cache/restore@v4` | `actions/cache/restore@0057852bfaa89a56745cba8c7296529d2fc39830` | `# v4` |
| `actions/cache/save@v4` | `actions/cache/save@0057852bfaa89a56745cba8c7296529d2fc39830` | `# v4` |
| `actions/checkout@v4` | `actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5` | `# v4` |
| `actions/download-artifact@v4` | `actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093` | `# v4` |
| `actions/setup-node@v4` | `actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020` | `# v4` |
| `actions/upload-artifact@v4` | `actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02` | `# v4` |
| `codecov/codecov-action@v4` | `codecov/codecov-action@b9fd7d16f6d7d1b5d2bec1a2887e65ceed900238` | `# v4` |
| `github/codeql-action/analyze@v3` | `github/codeql-action/analyze@03e4368ac7daa2bd82b3e85262f3bf87ee112f57` | `# v3` |
| `github/codeql-action/init@v3` | `github/codeql-action/init@03e4368ac7daa2bd82b3e85262f3bf87ee112f57` | `# v3` |
| `pnpm/action-setup@v4` | `pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1` | `# v4` |

Note: `actions/cache/restore@v4` and `actions/cache/save@v4` were not present in our workflows (only `actions/cache@v4` was used), so those two mapping rows had zero occurrences to replace.
`codecov/codecov-action@v4` was also not present in our workflows.

## §4 Verification

Post-edit grep confirms zero mapped `action@version` refs remain unpinned:
```
grep -rn "uses: .*@v[0-9]" .github | grep -v "@[0-9a-f]\{40\}"
```
Only non-mapped actions remain (peter-evans, docker/*, changesets, github-script, hmarr, 8398a7).

YAML validation: all 9 changed files passed `python3 -c "import yaml; yaml.safe_load(open(f))"`.

Files changed (9):
- `.github/actions/setup-node-pnpm/action.yml` — pnpm/action-setup, actions/cache, actions/setup-node
- `.github/workflows/changeset-release.yml` — actions/checkout ×2
- `.github/workflows/cli-release.yml` — actions/checkout ×2, actions/upload-artifact, actions/download-artifact ×2
- `.github/workflows/code-qa.yml` — actions/checkout ×4
- `.github/workflows/codeql.yml` — actions/checkout, github/codeql-action/init, github/codeql-action/analyze
- `.github/workflows/evals.yml` — actions/checkout
- `.github/workflows/marketplace-publish.yml` — actions/checkout
- `.github/workflows/nightly-publish.yml` — actions/checkout
- `.github/workflows/update-contributors.yml` — actions/checkout

## §5 Acceptance

- [ ] All 11 mapped action@version pairs are pinned with SHA + version comment
- [ ] No non-mapped actions were altered
- [ ] All changed YAML files are syntactically valid
- [ ] Branch `feature/zoo-353-pin-github-actions` pushed and PR open on main
- [ ] No workflow logic changes (diff shows only `uses:` line modifications)
