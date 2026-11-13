# CLI: time limits on the upgrade check and the installer's small downloads (audit C-6)

**Status:** done on `fix/sec-cli-timeouts`
**Audit:** `private_docs/security-audit-2026-11-06/report.md` C-6
**Touched:**

- `apps/cli/src/commands/cli/upgrade.ts`: `getLatestCliVersion` fetch gets `AbortSignal.timeout(15_000)`; the install.sh download in `installScriptCommand` gets `--connect-timeout 10 --max-time 60`
- `apps/cli/install.sh`: `METADATA_TIMEOUT=30`, `--max-time` on the release JSON and `.sha256` curls
- tests: `commands/cli/__tests__/upgrade.test.ts`, `src/__tests__/install-script.test.ts` (the fake curl also logs its arguments)

## Problem

`tumble upgrade` and `curl … | sh` could wait forever on a connection that opens and then
stalls (blackholed VPN, captive portal).

## Root cause

- `getLatestCliVersion` called `fetch` with no signal.
- `installScriptCommand` downloaded the tag's install.sh with plain `curl -fsSL` (not named in the
  report, same defect).
- install.sh bounded only the connect phase for the release JSON (`get_version`) and the checksum
  (`verify_checksum`); only the tarball had `--speed-time/--speed-limit`.

## Fix

Whole-transfer limits on the small downloads: 15 s for the version check, 60 s for install.sh,
30 s for the release JSON and the checksum. The tarball keeps its stall guard (a total limit would
cut a slow but healthy download). A timeout surfaces through the existing error messages.

## Tests

- The version check passes an `AbortSignal` to `fetch`; the install command carries `--max-time 60`.
- install.sh: both metadata curls carry `--max-time 30`. Each proven red by removing the flag or signal.

Installer changes reach users with the next release (upgrades run the tag's install.sh); the
`main` install.sh used by `curl … | sh` has them at once.
