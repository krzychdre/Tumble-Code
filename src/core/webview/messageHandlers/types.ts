import type { WebviewMessage, WebviewMessageTypesByDomain } from "@tumble-code/types"

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

/** A domain handled by one module of this directory (plan review has its own panel). */
export type HandlerDomain = Exclude<keyof WebviewMessageTypesByDomain, "planReview">

/**
 * A domain module's routing table, limited to the message types its domain
 * declares in packages/types/src/vscode-extension-host/<domain>.ts. A handler
 * for another domain's type is a type error here.
 */
export type DomainHandlerMap<D extends HandlerDomain> = { [K in WebviewMessageTypesByDomain[D]]?: MessageHandler }
