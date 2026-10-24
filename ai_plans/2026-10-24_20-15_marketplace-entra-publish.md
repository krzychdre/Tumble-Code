# Marketplace publishing with Microsoft Entra ID instead of a PAT

**Status:** done on the repository side; the Marketplace membership step is manual (below).
**Related plans:** `2026-10-24_*_r4-vsix-no-dotenv.md`, `2026-10-01_22-30_ci-release-concurrency-nightly-prune.md`.
**Touched:** `.github/workflows/marketplace-publish.yml`, `.github/workflows/marketplace-identity.yml` (one-off),
`.github/workflows/nightly-publish.yml` (comment), `src/package.json` (`publish:*` scripts).

## Problem

The release workflow published with a stored `VSCE_PAT`. The Marketplace accepts only global PATs ("All
accessible organizations"), and Azure DevOps is retiring those, so a new long-lived token would stop working.

## Change

- Azure (subscription "Azure subscription 1", tenant `596bbfd0-...`): resource group `rg-tumble-release`, user-assigned
  managed identity `id-tumble-marketplace` in `polandcentral` (West Europe refused new customers), Reader on the
  resource group, federated credential `github-tumble-marketplace` with subject
  `repo:krzychdre/Tumble-Code:environment:marketplace`.
- GitHub: environment `marketplace`; repository variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`,
  `AZURE_SUBSCRIPTION_ID` (identifiers, not secrets).
- `marketplace-publish.yml`: the job runs in the `marketplace` environment with `id-token: write`, logs in with
  `azure/login` (OIDC, no secret) and runs `vsce publish --azure-credential`. Open VSX is a separate step that runs
  only when `OVSX_PAT` is set.
- `marketplace-identity.yml`: one-off `workflow_dispatch` job that prints the identity's Azure DevOps profile id.

## Manual steps

1. Create the publisher `QUB-IT` at https://marketplace.visualstudio.com/manage with the same Microsoft account.
2. Run "Marketplace identity id" from the Actions tab and copy the printed id.
3. Add that id to the publisher's Members with the Contributor role.
4. Delete `marketplace-identity.yml`.

## Notes

The Marketplace step is no longer skipped: until steps 1 to 3 are done, a release run fails at it, after the tag is
pushed and before the GitHub release is created.
