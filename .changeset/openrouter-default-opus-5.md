---
"tumble-code": patch
---

OpenRouter now defaults to Claude Opus 5 (`anthropic/claude-opus-5`) instead of Claude Sonnet 4.5, which Anthropic retires on 2026-11-30, the same default as the Anthropic, Vertex and Bedrock providers. Profiles that never saved a model id move to Opus 5 without a prompt; Opus 5 costs more ($5 input and $25 output per million tokens, against $3 and $15 for Sonnet 4.5). A saved model id is not changed. A model id the fetched OpenRouter list does not have (or every id, when the list could not be fetched) still gets a plain Sonnet-4.5-sized stand-in, so a GPT or Gemini id keeps its temperature and gets no Claude 5 reasoning settings.
