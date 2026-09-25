import { useEffect, useLayoutEffect, useRef } from "react"

import type { ExtensionMessage, WebviewMessage } from "@roo-code/types"

import { vscode } from "@src/utils/vscode"

/**
 * One message bus for everything the extension host posts to the webview.
 *
 * Every consumer used to add its own `window` "message" listener and filter
 * with `message.type === "..."`. The bus keeps exactly one window listener
 * (added with the first subscriber, removed with the last one) and hands each
 * subscriber only the message types it asked for, typed to those types.
 *
 * Behavior matches separate window listeners on purpose: subscribers run in
 * subscription order, a subscriber removed while a message is being delivered
 * is not called for it, and a throwing subscriber does not stop the others.
 * Specs that dispatch `new MessageEvent("message", ...)` on `window` keep
 * working because the bus listens on `window`.
 */

export type ExtensionMessageType = ExtensionMessage["type"]

/**
 * `ExtensionMessage` is one interface with a union `type` field rather than a
 * discriminated union, so `Extract` cannot narrow it. Intersecting the type
 * field narrows it locally without changing `packages/types`.
 */
export type ExtensionMessageOf<T extends ExtensionMessageType> = ExtensionMessage & { type: T }

export type ExtensionMessageHandler<T extends ExtensionMessageType> = (message: ExtensionMessageOf<T>) => void

type Subscription = {
	/** `undefined` means every message type. */
	types: ReadonlySet<string> | undefined
	handler: (message: ExtensionMessage) => void
	active: boolean
}

let subscriptions: Subscription[] = []
let listening = false

function isExtensionMessage(data: unknown): data is ExtensionMessage {
	return typeof data === "object" && data !== null && typeof (data as { type?: unknown }).type === "string"
}

function dispatch(event: MessageEvent) {
	const message = event.data
	if (!isExtensionMessage(message)) {
		return
	}

	// Iterate a snapshot: subscribers added while delivering wait for the next
	// message, subscribers removed while delivering are skipped via `active`.
	for (const subscription of subscriptions.slice()) {
		if (!subscription.active || (subscription.types && !subscription.types.has(message.type))) {
			continue
		}
		try {
			subscription.handler(message)
		} catch (error) {
			console.error(`[extensionBus] handler for "${message.type}" failed`, error)
		}
	}
}

function subscribe(types: ReadonlySet<string> | undefined, handler: (message: ExtensionMessage) => void) {
	const subscription: Subscription = { types, handler, active: true }
	subscriptions.push(subscription)
	if (!listening) {
		listening = true
		window.addEventListener("message", dispatch)
	}

	return () => {
		if (!subscription.active) {
			return
		}
		subscription.active = false
		subscriptions = subscriptions.filter((entry) => entry !== subscription)
		if (subscriptions.length === 0 && listening) {
			listening = false
			window.removeEventListener("message", dispatch)
		}
	}
}

/** Subscribe to one or several message types. Returns the unsubscribe function. */
export function onExtensionMessage<T extends ExtensionMessageType>(
	type: T | readonly T[],
	handler: ExtensionMessageHandler<T>,
): () => void {
	const types = new Set<string>(typeof type === "string" ? [type] : type)
	return subscribe(types, handler as (message: ExtensionMessage) => void)
}

/** Subscribe to every message type (for reducers that switch over many types). */
export function onAnyExtensionMessage(handler: (message: ExtensionMessage) => void): () => void {
	return subscribe(undefined, handler)
}

/**
 * The latest handler, stored after render so the subscription does not have to
 * be renewed when the handler identity changes (as `useStableCallback` does).
 */
function useLatest<T>(value: T) {
	const ref = useRef(value)
	useLayoutEffect(() => {
		ref.current = value
	})
	return ref
}

/** Subscribe while the component is mounted; always calls the latest handler. */
export function useExtensionMessage<T extends ExtensionMessageType>(
	type: T | readonly T[],
	handler: ExtensionMessageHandler<T>,
): void {
	const handlerRef = useLatest(handler)
	// A stable key so an inline array literal does not resubscribe every render.
	const typesKey = typeof type === "string" ? type : type.join("\n")

	useEffect(() => {
		const types = typesKey.split("\n") as T[]
		return onExtensionMessage(types, (message) => handlerRef.current(message))
	}, [typesKey, handlerRef])
}

/** Like `useExtensionMessage`, for every message type. */
export function useAnyExtensionMessage(handler: (message: ExtensionMessage) => void): void {
	const handlerRef = useLatest(handler)

	useEffect(() => onAnyExtensionMessage((message) => handlerRef.current(message)), [handlerRef])
}

export class ExtensionRequestTimeoutError extends Error {
	constructor(
		readonly responseType: ExtensionMessageType,
		readonly timeoutMs: number,
	) {
		super(`No "${responseType}" response from the extension within ${timeoutMs} ms`)
		this.name = "ExtensionRequestTimeoutError"
	}
}

function abortError() {
	const error = new Error("The extension request was aborted")
	error.name = "AbortError"
	return error
}

let nextRequestId = 0

export type ExtensionRequestOptions<T extends ExtensionMessageType> = {
	/** Builds the message to post, carrying the generated id where the host expects it. */
	build: (requestId: string) => WebviewMessage
	/** The message type the host answers with. */
	responseType: T
	/**
	 * Reads the echoed id from a response. The host echoes ids in different
	 * places (`fileSearchResults.requestId`, `providerModels.modelSourceResult.requestId`),
	 * so the caller says where.
	 */
	responseId: (message: ExtensionMessageOf<T>) => string | undefined
	/** Reject with `ExtensionRequestTimeoutError` after this long. No timeout when omitted. */
	timeoutMs?: number
	signal?: AbortSignal
}

/**
 * Post a message and resolve with the response that echoes its request id.
 * Only for host handlers that echo the id back (today `searchFiles` and
 * `requestProviderModels`); other messages have no correlation to rely on.
 */
export function request<T extends ExtensionMessageType>({
	build,
	responseType,
	responseId,
	timeoutMs,
	signal,
}: ExtensionRequestOptions<T>): Promise<ExtensionMessageOf<T>> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(abortError())
			return
		}

		const requestId = `${responseType}-${++nextRequestId}`
		let timer: ReturnType<typeof setTimeout> | undefined

		const settle = () => {
			unsubscribe()
			if (timer !== undefined) {
				clearTimeout(timer)
			}
			signal?.removeEventListener("abort", onAbort)
		}

		const onAbort = () => {
			settle()
			reject(abortError())
		}

		const unsubscribe = onExtensionMessage(responseType, (message) => {
			if (responseId(message) !== requestId) {
				return
			}
			settle()
			resolve(message)
		})

		signal?.addEventListener("abort", onAbort)
		if (timeoutMs !== undefined) {
			timer = setTimeout(() => {
				settle()
				reject(new ExtensionRequestTimeoutError(responseType, timeoutMs))
			}, timeoutMs)
		}

		vscode.postMessage(build(requestId))
	})
}
