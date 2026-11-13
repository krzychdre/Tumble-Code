# Marketplace publishing with Microsoft Entra ID instead of a PAT

**Status:** done; publish rights verified with `vsce verify-pat --azure-credential QUB-IT` on 2026-10-24.
**Related plans:** `2026-10-24_*_r4-vsix-no-dotenv.md`, `2026-10-01_22-30_ci-release-concurrency-nightly-prune.md`.
**Touched:** `.github/workflows/marketplace-publish.yml`, `.github/workflows/nightly-publish.yml` (comment), `src/package.json` (`publish:*` scripts).

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

## Marketplace membership

The publisher `QUB-IT` was created at https://marketplace.visualstudio.com/manage with the owner's Microsoft account.
The identity's Azure DevOps profile id (`abfd365c-bc69-6881-9cb1-59c72710e590`, read once from inside a GitHub
Actions job with `az rest -u https://app.vssps.visualstudio.com/_apis/profile/profiles/me --resource
499b84ac-1321-427f-aa17-267ca6975798`) is a member of the publisher with the Contributor role; the Marketplace lists
it as `<tenant id>\<principal id>`.

## Notes

The Marketplace step is not skipped: if the identity loses its membership, a release run fails at it after the tag
is pushed and before the GitHub release is created.
