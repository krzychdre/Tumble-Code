---
"tumble-code": patch
---

Google Vertex AI and Amazon Bedrock now default to Claude Opus 5 instead of Claude Sonnet 4.5, which Anthropic retires on 2026-11-30. Profiles that never saved a model id move to Opus 5 without a prompt; Opus 5 costs more ($5 input and $25 output per million tokens, against $3 and $15 for Sonnet 4.5). A saved model id is not changed. A model id that is not in the list (and a Bedrock custom ARN) is still sized and priced like Sonnet 4.5, so those models keep their temperature and get no reasoning effort settings they may not accept.
