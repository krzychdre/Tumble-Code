---
"tumble-code": patch
---

The CLI installer can no longer stall on a bad network. It probes the npm registry with a short timeout before the dependency install, runs every `npm install` under a wall-clock budget (`ROO_NPM_TIMEOUT`, default 180 s) with a progress heartbeat, keeps npm's output in a log and shows it on failure, and stages the new release in a temp directory so a failed install leaves the previous installation untouched. The GitHub API and tarball download get connect-timeout and stall guards (`ROO_CONNECT_TIMEOUT`), and when the registry ping is a false alarm the installer falls back from a cache-only install to the registry instead of aborting.
