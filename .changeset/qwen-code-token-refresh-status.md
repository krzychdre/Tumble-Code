---
"tumble-code": patch
---

When Qwen Code can no longer refresh its sign-in (an expired or revoked token), the task now treats it as an authentication failure and asks you to fix it instead of retrying the same refresh over and over. Refreshed Qwen credentials are also saved atomically, so a crash during the save can no longer leave a broken credentials file.
