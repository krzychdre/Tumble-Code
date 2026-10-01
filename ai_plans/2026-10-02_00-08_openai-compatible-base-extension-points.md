# OpenAI-compatible base: extension points, dead MiniMax code, shared request boilerplate

Status: done on `refactor/openai-compatible-base`, PR open, not merged.

## Touched files

- `src/api/providers/base-openai-compatible-provider.ts`
- `src/api/providers/moonshot.ts`, `src/api/providers/zai.ts`
- `src/api/providers/openai.ts`, `src/api/providers/deepseek.ts`
- `src/api/providers/__tests__/openai-compatible-request-bodies.characterization.spec.ts` (new) and its snapshot file

## Problem

- `BaseOpenAiCompatibleProvider` has two subclasses and both replaced `createStream` wholesale: Moonshot to use the
  R1 converter, its own max tokens and temperature and to drop `parallel_tool_calls`; Z.ai (thinking models) to use
  the R1 converter with `mergeToolResultText` and add `thinking` / `reasoning_effort`. Each copy repeated the request
  body, `stream_options: { include_usage: true }` and the abort-controller + `handleProviderError` cycle.
- The base checked MiniMax's `base_resp` error field in the stream (`onChunk`) and in `completePromptWithUsage`, but
  MiniMax runs on the Anthropic-compatible endpoint (`minimax.ts:61-70`, `MiniMaxHandler extends BaseProvider`), so
  nothing on this base ever receives `base_resp`.
- `OpenAiHandler` repeated the "new abort controller, create with the Azure AI Inference path, wrap the error, clear
  the controller" block four times (stream, non-stream, o3 stream, o3 non-stream), and `DeepSeekHandler` (which
  replaces `createMessage`) had a fifth copy.

## Fix

- The base builds the streamed request once and asks the subclass through explicit hooks: `convertMessages`,
  `getSamplingParams` (`max_tokens`, `temperature`), `getExtraStreamParams` (default: the binary `thinking` switch)
  and the `sendsParallelToolCalls` flag. The one-shot path goes through `sendCompletion` (abort controller, error
  wrapping, release). The unused `requestOptions` parameter of `createStream` is gone (no caller passed it).
- Moonshot overrides the hooks (R1 messages, `getModel()` sampling, no extras, no `parallel_tool_calls`) and uses
  `sendCompletion` for its one-shot request. Z.ai overrides `convertMessages` and `getExtraStreamParams` for the
  thinking models and falls back to the base for the others; the effort resolution is unchanged.
- MiniMax `base_resp` handling deleted.
- `OpenAiHandler` gets `openChatStream`, `streamUntilDone` and a private `sendChatCompletion`; its four copies and
  DeepSeek's use them. DeepSeek passes its own provider name, so its error labels stay "DeepSeek".

## Why DeepSeek stays on OpenAiHandler

It inherits the OpenAI handler's client construction (Azure AI Inference client with the `api-version` query, Azure
OpenAI client for `*.azure.com` hosts or `openAiUseAzure`, `openAiHeaders`) and its `completePromptWithUsage`
(`max_completion_tokens` through `includeMaxTokens`, Azure path). Moving it to the compatible base would mean adding
those client variants to the base for one provider, so it now shares only the request boilerplate.

## Tests

`openai-compatible-request-bodies.characterization.spec.ts` was committed first, against the old code: the wire body
(after `JSON.stringify`), the request option keys and the Azure path of the stream and one-shot requests for a plain
base subclass (binary reasoning on/off, user temperature, `parallelToolCalls: false`), Moonshot (3 cases), Z.ai
(non-thinking model, GLM-5 default / reasoning off, GLM-5.3 that cannot disable, GLM-5.2 effort max with a max-tokens
override) and DeepSeek (thinking on/off, Azure AI Inference, reasoner with xhigh). It passes unchanged.

Also green: `openai*.spec.ts`, `base-openai-compatible-provider*.spec.ts`, `moonshot*.spec.ts`, `zai*.spec.ts`,
`deepseek.spec.ts`, `minimax.spec.ts`, `error-contract.spec.ts`, `stop-aborts-request.spec.ts`,
`cancellation-contract.spec.ts`, `chat-completions-characterization.spec.ts`, `strict-schema-characterization.spec.ts`,
`runtime-provider-registry.spec.ts`, `ApiRequestBuilder.reasoning-items.spec.ts`.

## Notes and caveats

- Z.ai thinking models used `modelTemperature ?? defaultTemperature`; they now use the base rule
  `modelTemperature ?? info.defaultTemperature ?? defaultTemperature`. No Z.ai catalog model sets `defaultTemperature`,
  so the sent value is the same today (the characterization spec covers it).
- Kept as is on purpose: a stream request of the compatible base that rejects (as opposed to throwing synchronously)
  still reaches the caller as the raw SDK error, not through `handleProviderError`, and its controller is cleared only
  by the next request. Wrapping it would change the error text Z.ai and Moonshot users see; worth a separate item.
- Not touched: LiteLLM, Qwen Code, OpenRouter, LM Studio and Bedrock also build Chat Completions requests by hand,
  but their abort and error handling differ (stream-wide try/catch with a "streaming" prefix, LM Studio's hint text,
  Bedrock's own SDK), so a shared helper would not fit them without behaviour changes.
- The shared Chat Completions stream adapter (`src/api/transform/chat-completions-stream.ts`) stays the only parser.
