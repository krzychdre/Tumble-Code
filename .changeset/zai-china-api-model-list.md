---
"tumble-code": patch
---

Z.ai with the "China API" line now shows the mainland model list in the settings and the chat header, the same list its requests use. Before, only the "China Coding" line was treated as China there, so a China API profile showed international prices and context windows (for example glm-4.5 at $0.60/$2.20 per million tokens instead of $0.29/$1.14) and did not warn about glm-4-32b-0414-128k, a model the mainland list does not have.
