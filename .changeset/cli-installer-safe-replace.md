---
"tumble-code": patch
---

Fixed: **CLI: safer installer.** The installer refuses to replace a directory that is not a previous CLI installation (a mistyped `ROO_INSTALL_DIR` can no longer wipe it), and an upgrade that fails while moving the new release into place leaves the previous installation working.
