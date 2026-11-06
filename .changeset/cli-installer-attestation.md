---
"tumble-code": patch
---

Improved: **CLI: the installer verifies where the download was built.** Every CLI release now carries a GitHub build attestation, and when the GitHub CLI (`gh`) is installed and signed in, the installer refuses a tarball that this project's release workflow did not build. The `ROO_SKIP_CHECKSUM` setting is gone: every CLI release publishes a checksum.
