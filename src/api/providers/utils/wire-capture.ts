import { AsyncLocalStorage } from "async_hooks"

/** One HTTP request as the provider SDK sent it. */
export interface WireRequest {
	url: string
	method: string
	/** The body exactly as sent (the SDKs serialize JSON with JSON.stringify). */
	body: string
}

export type WireRequestSink = (request: WireRequest) => void

const sinks = new AsyncLocalStorage<WireRequestSink>()

/**
 * Run `fn` with `sink` receiving every request body that `wireCaptureFetch` sends
 * from inside it (including the awaits it starts). Used by the task loop around
 * the call that starts a provider stream, so the recorder of the LLM exchange gets
 * the exact request (ai_plans/2026-10-02_llm-exchange-dataset.md).
 */
export function runWithWireCapture<T>(sink: WireRequestSink, fn: () => T): T {
	return sinks.run(sink, fn)
}

function urlOf(input: unknown): string {
	if (typeof input === "string") {
		return input
	}
	if (input instanceof URL) {
		return input.href
	}
	const url = (input as { url?: unknown } | null)?.url
	return typeof url === "string" ? url : ""
}

/**
 * The `fetch` given to the provider SDK clients. Outside a capture context it is a
 * plain pass-through. `globalThis.fetch` is read at call time, not captured, so VS
 * Code's proxy-aware fetch and the tests' mocks still apply; the global itself is
 * never replaced (the extension host is shared with other extensions).
 */
export const wireCaptureFetch: typeof fetch = (input, init) => {
	const sink = sinks.getStore()
	if (sink && typeof init?.body === "string") {
		try {
			sink({ url: urlOf(input), method: (init.method ?? "GET").toUpperCase(), body: init.body })
		} catch {
			// Recording must never break a request.
		}
	}
	return globalThis.fetch(input, init)
}
