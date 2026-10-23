# R4 A4a: Anthropic SDK 1.x

**Status:** Done.

**Related plans:** `ai_plans/2026-10-23_17-20_maintenance-audit-round-4.md` (section A4a).

## Touched files

- `src/package.json`, `pnpm-lock.yaml`: `@anthropic-ai/sdk` ^0.128.0 to ^1.2.0, `@anthropic-ai/vertex-sdk` ^0.19.11
  to ^1.1.0. `@anthropic-ai/bedrock-sdk` is not a dependency (Bedrock goes through the AWS SDK), so it stays out.
- `src/api/providers/anthropic.ts`, `src/api/providers/anthropic-vertex.ts`, `src/api/providers/minimax.ts`
- `src/api/providers/utils/x-api-key-auth.ts` (new), `src/api/transform/conversation-message.ts` (new)
- `src/api/transform/anthropic-stream.ts`, `src/api/transform/caching/vertex.ts`
- `src/core/task-persistence/apiMessages.ts`, `src/core/task/TaskMessageLog.ts`,
  `src/core/task/TaskMessageLog.helpers.ts`, `src/core/task/validateToolResultIds.ts`
- Specs: `anthropic-sdk-wire.spec.ts`, `anthropic-vertex-auth-header.spec.ts`, `anthropic.spec.ts`,
  `anthropic-vertex.spec.ts`, `core/webview/__tests__/ClineProvider.spec.ts`

## Problem

SDK 1.0.0 (2026-10-21) sends `anthropic-version: 2026-10-21` instead of `2023-06-01`. The migration guide
(https://platform.claude.com/docs/en/api/migration-2026-10-21) lists what that means for us:

1. `temperature`, `top_p` and `top_k` return HTTP 400 on the Messages API, even at their defaults, and the SDK
   types no longer have them. The Anthropic handler sent `temperature` (default 0, 1.0 with thinking) on every
   request, the Vertex handler too.
2. The SDK sends `apiKey` as `Authorization: Bearer` instead of `X-Api-Key`, and a client takes one credential.
   The Claude API accepts either header; MiniMax's Anthropic endpoint answers "carry the API secret key in the
   'X-Api-Key' field", and the `anthropicUseAuthToken` setting exists because gateways behind a custom base URL
   differ in the header they read.
3. `MessageParam` is a union of `UserMessageParam`, `AssistantMessageParam` and `SystemMessageParam`, whose
   content may hold text blocks only. Spreading a message and replacing its content no longer type-checks against
   the union (21 tsc errors in `src`).
4. Vertex: the vertex SDK copies the header version into the body, so `anthropic_version` goes from
   `vertex-2023-10-16` to `2026-10-21` (the guide lists Google-managed Claude models as supporting it).
5. Unused by us: removed Text Completions, `HUMAN_PROMPT`, `betas` on non-beta Models methods; document blocks
   in assistant messages and citations in user messages are rejected (we send neither).

## Change

- Anthropic and Vertex requests no longer carry `temperature`. MiniMax keeps it (its server still samples with
  it); its request objects are typed as the SDK params plus `{ temperature: number }`.
- `xApiKeyAuth(key)` returns the client options that send the key in `X-Api-Key` and null the SDK's Bearer
  header. The Anthropic handler uses it unless the auth-token setting is on with a custom base URL (then
  `authToken`, Bearer, as before); MiniMax always uses it. The auth headers on the wire are the ones 0.128 sent.
- `ConversationMessage` (user or assistant message param) is the type of our conversation history: `ApiMessage`
  builds on it, and `validateAndFixToolResultIds`, `convertOrphanedToolResultsToText` and
  `addToApiConversationHistory` take it. `processAssistantMessage`/`processUserMessage` take the role's own type.
  The two cache-breakpoint helpers narrow on `role === "user"` (the indices they cache were user messages already).

No characterization snapshot changed: `anthropic-protocol-characterization` and `bedrock-characterization` pass
as they were (the first mocks the SDK, the second does not use it).

## Tests

- `anthropic-sdk-wire.spec.ts` (real SDK, faked fetch) now pins, per case, the absent second auth header and the
  `temperature` in the body (absent for Anthropic and Vertex, 1 for MiniMax), and gains a case for a gateway with
  the auth-token setting (Bearer, no `X-Api-Key`).
- `anthropic-vertex-auth-header.spec.ts` pins `anthropic_version: "2026-10-21"`.
- Mutation checks, each turned the wire spec red: plain `apiKey` in the Anthropic handler; plain `apiKey` in
  MiniMax; `temperature: 0` back in the Anthropic request; `temperature` dropped from MiniMax; the auth-token
  branch disabled.
- All 79 `src` specs that import `@anthropic-ai/*` (1870 tests), plus `ClineProvider.spec.ts`, the
  `TaskMessageLog`, `task-persistence` and `DelegationService` specs; `tsc --noEmit` in `src`; eslint on touched files.

## Notes

- The temperature control in the settings no longer affects Anthropic and Vertex Claude models. Hiding it for
  those two providers is a possible follow-up in the webview.
- `getModel().temperature` of the two handlers is still computed by the shared `getModelParams`; nothing sends it.
