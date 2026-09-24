---
"tumble-code": patch
---

The extension no longer opens an external IPC socket when the `ROO_CODE_IPC_SOCKET_PATH` environment variable is set. That socket existed only for the inherited evaluation harness, which has been removed together with its web dashboard; the extension API that other VS Code extensions call is unchanged, and the extension bundle no longer ships the `node-ipc` library.
