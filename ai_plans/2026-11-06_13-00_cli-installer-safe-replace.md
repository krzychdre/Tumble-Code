# CLI installer: guard the install directory, swap by rename (audit C-11, C-12)

**Status:** done on `fix/sec-cli-installer-swap`
**Audit:** `private_docs/security-audit-2026-11-06/report.md` C-11, C-12
**Touched:**

- `apps/cli/install.sh`: `check_install_dir` (called before `get_version`), the swap at the end of `download_and_install`
- `apps/cli/src/__tests__/install-script.test.ts`: `target` fixture (previous install with markers, unrelated dir, empty dir), two new cases, leftovers check
- `apps/cli/README.md`: one sentence under "Custom installation directory"

## Problem

- C-11: `rm -rf "$INSTALL_DIR"` ran on whatever `ROO_INSTALL_DIR` named (`/`, `$HOME`, a typo).
- C-12: `rm -rf "$INSTALL_DIR"` then `mv "$STAGING_DIR" "$INSTALL_DIR"`; `STAGING_DIR` is under
  `mktemp -d` (often another filesystem), so `mv` copies, and a failed copy (disk full) left no
  installation at all.

## Fix

- `check_install_dir`: the target must be absent, empty, or hold `package.json` and `bin/tumble`;
  anything else stops the installer before any download. No force override (remove the directory
  or choose another; nobody needs to install over a foreign tree).
- Swap: copy the staging dir to `$INSTALL_DIR.new` (old install untouched if this fails), then
  rename the old one to `$INSTALL_DIR.previous`, rename `.new` into place, delete `.previous`.

## Not changed (C-12 second half)

`run_with_timeout` kills only `$RUN_PID`, but that PID is npm itself (`sh -c '… exec npm …'`,
install.sh:182 and :222), and npm forwards SIGTERM to its lifecycle scripts
(`@npmcli/run-script/lib/signal-manager.js`, `forwardedSignals = ['SIGINT', 'SIGTERM']`). Process
group kill would need `set -m` in a non-interactive POSIX sh, whose behaviour differs between dash,
bash-as-sh on macOS and busybox ash.

## Tests

- Unrelated directory: refused, nothing downloaded, its file kept. Empty directory: installed.
- Success leaves no `install.new` / `install.previous`.
- Proven red by mutation: guard call removed, empty-dir branch removed, `.previous` cleanup removed.
