# CLI: build provenance attestations for the release tarballs (security audit 2026-11-06, C-13)

**Status:** done on `fix/sec-cli-attestations`
**Touched:** `.github/workflows/marketplace-publish.yml`, `apps/cli/install.sh`, `apps/cli/README.md`,
`apps/cli/src/__tests__/install-script.test.ts`.

## Problem

install.sh checks the tarball against the `.sha256` published in the same release, so whoever can replace a
release asset can replace the checksum too. `ROO_SKIP_CHECKSUM=1` existed for releases without a checksum, but every
CLI release (v1.1.1 on; v1.1.0 had no CLI) ships one.

## Fix (owner decision)

- `build-cli` attests each tarball with `actions/attest-build-provenance` v4.2.2 (pinned SHA), job permissions
  `contents: read`, `id-token: write`, `attestations: write`. The attestation is keyed by the tarball's digest, so the
  copy the publish job uploads to the release verifies.
- install.sh, after the checksum: `gh attestation verify <tarball> --repo krzychdre/Tumble-Code`, fail closed.
  Checksum only (one info line) when gh is missing, has no `attestation` command (before 2.49; Ubuntu 24.04 apt ships
  2.45) or is signed out (exit 4, documented in `gh help exit-codes`).
- Old releases: `LAST_UNATTESTED_VERSION=1.2.0` (the latest release today). Only newer versions are verified. A rule
  "skip when no attestation is found" would let a replaced asset (which has none) pass, so the version is the gate.
  Every release after 1.2.0 comes from a workflow run that has this step, provided this merges before the pending
  bump PR.
- `ROO_SKIP_CHECKSUM` removed from install.sh, the README and the tests.

## Tests

`install-script.test.ts`: the installer now runs with a PATH of the fakes plus links to the tools it needs, so a
real gh never takes part. Fake gh cases: verifies (gh called with the tarball and `--repo`), fails (nothing installed,
npm never runs), absent / too old / signed out (checksum only with a note), release 1.2.0 (gh not called).
Mutations: dropping the call, the version gate, the `--help` probe or the exit-4 branch each turn a case red.
`sh -n`, dash `-n`, shellcheck (no new findings), actionlint (only the two pre-existing SC2086 infos).
