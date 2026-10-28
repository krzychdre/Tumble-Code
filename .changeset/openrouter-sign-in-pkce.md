---
"tumble-code": patch
---

Fixed: **A link can no longer swap your OpenRouter key.** "Get OpenRouter API Key" now starts a sign-in that only this window can finish, protected by PKCE; an OpenRouter sign-in link you did not start is ignored instead of replacing the key in your profile.
