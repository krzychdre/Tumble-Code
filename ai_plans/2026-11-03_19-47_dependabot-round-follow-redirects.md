# Dependabot round of 2026-11-02: follow-redirects advisory blocks six PRs

**Status:** done on `fix/follow-redirects-advisory`
**Related:** `scripts/audit-gate.mjs`, `scripts/audit-allowlist.mjs`, the overrides block in `pnpm-workspace.yaml`
**Touched:** `pnpm-workspace.yaml`, `pnpm-lock.yaml`

## Symptom

Nine Dependabot PRs (#1238 to #1246) were open. The three outside npm (Python image, Python packages, GitHub Actions)
were green. All six npm PRs failed the `pnpm-audit` job, and the same job had been red on `main` since the
2026-11-02 run, so the PRs inherited the failure rather than causing it.

## Cause

GHSA-mrwp-f3q8-3g9p (high, published 2026-10-30): follow-redirects 1.16.0 to 1.16.1 discards cross-realm
`sensitiveHeaders` arrays and lets custom credentials follow redirects. The lockfile held 1.16.1, reached only through
axios 1.20.0 (used by `src` and `webview-ui`). The audit gate fails on any high or critical advisory that is not in
the allowlist, so every branch built from `main` was red. Dependabot's own axios bump (#1244) keeps follow-redirects
at 1.16.1 and does not help.

## Fix

A floor in the overrides block of `pnpm-workspace.yaml`, next to the other advisory floors (tar-fs, bluebird,
lodash-es):

```yaml
follow-redirects: ">=1.16.2"
```

axios already allows `^1.16.0`, so the lockfile moves to 1.16.2 and nothing else changes. `pnpm audit --prod` through
`scripts/audit-gate.mjs` reports no unaccepted advisories.

## Review of the Dependabot PRs

Each release note that mentions a breaking change was checked against our code:

- openai 7.44 changes the Live Decision event types; Tumble does not use that API.
- fastapi 0.162 stops inferring `False` for omitted boolean form fields; every `Form(...)` field in cloud api is `str`.
- starlette 1.10 changes multidict equality; cloud api only reads values from `QueryParams`.
- lucide-react 1.63 renames archive-restore; Tumble does not use the icon.
- i18next 26.5.10 changes fuzzy matching under `supportedLngs`; Tumble does not set it.
- @mistralai/mistralai 3.1 to 3.4 are generated SDK syncs; the chat surface and the `./*` export map we import from
  are unchanged, and `compile` plus the unit tests passed on the PR.
- pydantic 2.14.2 fixes two medium advisories (extra-key validation bypasses).

The only other red check, `platform-unit-test (ubuntu-latest)` on #1240, was the CLI Markdown linear-time guard
crossing its 2000 ms wall-clock budget (2013 ms; a green main run needs 1230 to 1459 ms). knip and typescript-eslint
cannot affect rendering, so that is a timing flake, handled on its own branch.

## Follow-up

After this lands: `@dependabot rebase` on the six npm PRs, merge them one at a time (they share `pnpm-lock.yaml`),
rebuild the VSIX and CLI, and rebuild the cloud api image for the Python PRs.
