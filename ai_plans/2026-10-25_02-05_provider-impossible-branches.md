# Providers: branches for states that cannot happen

**Status:** done on branch `refactor/provider-impossible-branches`
**Related plans:** `2026-10-25_00-26_test-refactor-round-5.md` (lane L3 listed these while pruning provider specs)
**Touched:** `src/api/providers/bedrock.ts`, `src/api/providers/bedrock/errors.ts`, `src/api/providers/deepseek.ts`,
`src/api/providers/mistral.ts`

## Removed, each verified against its callers

- **Bedrock, custom ARN cross-region flag.** The constructor read `arnInfo.awsUseCrossRegionInference`, a field
  `parseArn` never sets (it set `crossRegionInference`). Even with the right name the flag would do nothing: it is
  read only in `getModel`'s drop-down branch, and a custom ARN takes the other branch. Gone with it:
  `parseArn`'s `crossRegionInference` field and `isSystemInferenceProfile`, which existed only to fill it.
- **Bedrock error table.** `ABORT`, `INVALID_ARN_FORMAT` and `VALIDATION_ERROR` are not in `getBedrockErrorType`'s
  `errorTypeOrder`, so they can never be chosen. The constructor's own `INVALID_ARN_FORMAT:` error is unrelated and
  stays.
- **Bedrock, "Throttling error occurred".** `getBedrockErrorType` returns `THROTTLING` only for an `Error`, so the
  non-Error branch of `bedrockStreamFailure` could not run.
- **DeepSeek effort.** `getModelParams` passes only an effort the model lists (`low`, `medium`, `high`, `xhigh`;
  `disable` is dropped earlier), so the `minimal`, `max` and `disable` cases of `normalizeDeepSeekReasoningEffort`
  could not run.
- **Mistral max tokens.** `includeMaxTokens` has a settings control only for OpenAI Compatible, and the request used
  `maxTokens ?? info.maxTokens`, so a Mistral request always sent the model's `maxTokens`. `getModel` now says so.

## Kept

- **MiniMax base URL.** The settings schema allows only the two `/v1` endpoints, but the CLI maps `--base-url` and
  `MINIMAX_BASE_URL` straight to `minimaxBaseUrl`, so the "neither /v1 nor /anthropic" branch is reachable.
- **`getModelParams`'s `"disable"` check**: unreachable as well, but tied to the effort type; not worth the churn.

## Tests

Bedrock, DeepSeek, Mistral, the error and cancellation contracts and stop-aborts: 10 files, 364 tests pass;
`tsc --noEmit` is clean. No behaviour changes, so no new test.
