---
"tumble-code": patch
---

Z.ai, Moonshot and Qwen Code now cap the max output tokens they request at the current model's limit, so a max output setting left over from a previously selected model no longer makes the request ask for more than the model allows.
