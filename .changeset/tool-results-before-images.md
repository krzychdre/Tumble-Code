---
"tumble-code": patch
---

Fixed: **Reading several images at once no longer breaks Anthropic requests.** When the model read more than one image in a single turn, the request failed with "tool_use ids were found without tool_result blocks immediately after"; the tool results now always come before the images.
