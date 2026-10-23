import type { Anthropic } from "@anthropic-ai/sdk"

/** A conversation turn: the SDK's MessageParam without the system role, which our history never holds. */
export type ConversationMessage = Anthropic.Messages.UserMessageParam | Anthropic.Messages.AssistantMessageParam
