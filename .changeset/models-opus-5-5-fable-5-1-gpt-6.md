---
"tumble-code": minor
---

- **New Anthropic models.** Added Claude Opus 5.5 and Claude Fable 5.1 on the Anthropic, Amazon Bedrock, Google Vertex and OpenRouter providers, and Claude Opus 5 and Claude Sonnet 5 on Bedrock and Vertex, where they were missing. A custom Bedrock id for Opus 5 or Sonnet 5 no longer fails with a 400, because the whole Claude 5 family now gets the adaptive-thinking request shape.
- **New OpenAI models.** Added GPT-6 Astra, GPT-6 Sol and GPT-6 Luna, with OpenAI's long-context pricing above 272K input tokens.
- **Prompt caching for Claude Opus 5 and Sonnet 5.** On the Anthropic provider these two models, including the default Opus 5, were sent without cache markers, so every turn was billed at the full input price. They are now cached like every other Claude model, and models added later are cached automatically.
- **Corrected prices and cost estimates.** Claude Sonnet 5 is now priced at $2/$10 per million tokens (it was $3/$15). OpenAI cache writes, billed at 1.25 times the input price since GPT-5.6, are now counted, so OpenAI cost estimates are no longer too low.
- **OpenAI reasoning effort.** A reasoning effort saved for one model is no longer sent to a model that rejects it: switching to GPT-6 Astra with "none" selected used to fail with HTTP 400, and now falls back to the model's default.
- A new OpenAI profile now shows the model it actually uses (GPT-5.6 Sol) instead of GPT-4o.
