import type { WebviewMessage } from "@roo-code/types"

import type { HandlerContext } from "./context"

/**
 * Handles one webview message type. It receives the per-message context
 * (provider, marketplace manager and the small state helpers) and the raw
 * message. `WebviewMessage` is still one interface with optional fields; a
 * per-type discriminated union comes later, additively.
 */
export type MessageHandler = (ctx: HandlerContext, message: WebviewMessage) => void | Promise<void>

/** A domain module's share of the routing table: message type to handler. */
export type MessageHandlerMap = { [K in WebviewMessage["type"]]?: MessageHandler }
