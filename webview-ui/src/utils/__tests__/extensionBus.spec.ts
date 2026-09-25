import { act, renderHook } from "@testing-library/react"

import type { ExtensionMessage } from "@roo-code/types"

import {
	ExtensionRequestTimeoutError,
	onAnyExtensionMessage,
	onExtensionMessage,
	request,
	useExtensionMessage,
} from "../extensionBus"

const { postMessage } = vi.hoisted(() => ({ postMessage: vi.fn() }))

vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage } }))

function send(data: unknown) {
	window.dispatchEvent(new MessageEvent("message", { data }))
}

describe("extensionBus", () => {
	const cleanups: Array<() => void> = []
	const track = (unsubscribe: () => void) => {
		cleanups.push(unsubscribe)
		return unsubscribe
	}

	beforeEach(() => postMessage.mockClear())

	afterEach(() => {
		while (cleanups.length) cleanups.pop()!()
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	describe("onExtensionMessage", () => {
		it("delivers only messages of the subscribed type", () => {
			const handler = vi.fn()
			track(onExtensionMessage("theme", handler))

			send({ type: "state", state: {} })
			send({ type: "theme", text: "{}" })

			expect(handler).toHaveBeenCalledTimes(1)
			expect(handler).toHaveBeenCalledWith({ type: "theme", text: "{}" })
		})

		it("narrows the message type for the handler", () => {
			const seen: Array<"theme" | "invoke"> = []
			track(
				onExtensionMessage(["theme", "invoke"], (message) => {
					// Compile-time check: the narrowed type only allows the listed literals.
					const type: "theme" | "invoke" = message.type
					seen.push(type)
				}),
			)

			send({ type: "invoke", invoke: "sendMessage" })
			send({ type: "theme" })
			send({ type: "state" })

			expect(seen).toEqual(["invoke", "theme"])
		})

		it("stops delivering after unsubscribe", () => {
			const handler = vi.fn()
			const unsubscribe = onExtensionMessage("theme", handler)

			send({ type: "theme" })
			unsubscribe()
			send({ type: "theme" })

			expect(handler).toHaveBeenCalledTimes(1)
		})

		it("delivers to several consumers in subscription order", () => {
			const order: string[] = []
			track(onExtensionMessage("theme", () => order.push("first")))
			track(onAnyExtensionMessage(() => order.push("any")))
			track(onExtensionMessage("theme", () => order.push("second")))

			send({ type: "theme" })

			expect(order).toEqual(["first", "any", "second"])
		})

		it("keeps delivering to the other consumers when one handler throws", () => {
			const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
			const after = vi.fn()
			track(
				onExtensionMessage("theme", () => {
					throw new Error("boom")
				}),
			)
			track(onExtensionMessage("theme", after))

			send({ type: "theme" })

			expect(after).toHaveBeenCalledTimes(1)
			expect(consoleError).toHaveBeenCalled()
		})

		it("skips a handler unsubscribed by an earlier handler of the same message", () => {
			const second = vi.fn()
			let unsubscribeSecond = () => {}
			track(onExtensionMessage("theme", () => unsubscribeSecond()))
			unsubscribeSecond = track(onExtensionMessage("theme", second))

			send({ type: "theme" })

			expect(second).not.toHaveBeenCalled()
		})

		it("ignores events whose data is not an extension message", () => {
			const handler = vi.fn()
			track(onAnyExtensionMessage(handler))

			send("plain string")
			send(null)
			send({ noType: true })

			expect(handler).not.toHaveBeenCalled()
		})

		it("holds exactly one window listener, and none once the last consumer leaves", () => {
			const add = vi.spyOn(window, "addEventListener")
			const remove = vi.spyOn(window, "removeEventListener")

			const a = onExtensionMessage("theme", () => {})
			const b = onExtensionMessage("state", () => {})
			const c = onAnyExtensionMessage(() => {})

			expect(add.mock.calls.filter(([type]) => type === "message")).toHaveLength(1)

			a()
			b()
			expect(remove.mock.calls.filter(([type]) => type === "message")).toHaveLength(0)
			c()
			expect(remove.mock.calls.filter(([type]) => type === "message")).toHaveLength(1)
		})
	})

	describe("useExtensionMessage", () => {
		it("subscribes while mounted and always calls the latest handler", () => {
			const first = vi.fn()
			const second = vi.fn()
			const { rerender, unmount } = renderHook(({ handler }) => useExtensionMessage("theme", handler), {
				initialProps: { handler: first },
			})

			act(() => send({ type: "theme" }))
			rerender({ handler: second })
			act(() => send({ type: "theme" }))
			unmount()
			act(() => send({ type: "theme" }))

			expect(first).toHaveBeenCalledTimes(1)
			expect(second).toHaveBeenCalledTimes(1)
		})
	})

	describe("request", () => {
		const buildSearch = (requestId: string) => ({ type: "searchFiles" as const, query: "a", requestId })
		const searchId = (message: ExtensionMessage) => message.requestId

		it("posts the message with a fresh id and resolves with the correlated response", async () => {
			const pending = request({ build: buildSearch, responseType: "fileSearchResults", responseId: searchId })

			expect(postMessage).toHaveBeenCalledTimes(1)
			const { requestId } = postMessage.mock.calls[0][0]
			expect(typeof requestId).toBe("string")

			send({ type: "fileSearchResults", requestId: "someone-else", results: [] })
			send({ type: "fileSearchResults", requestId, results: [{ path: "a.ts", type: "file" }] })

			await expect(pending).resolves.toMatchObject({ requestId, results: [{ path: "a.ts" }] })
		})

		it("gives concurrent requests distinct ids and resolves each with its own response", async () => {
			const first = request({ build: buildSearch, responseType: "fileSearchResults", responseId: searchId })
			const second = request({ build: buildSearch, responseType: "fileSearchResults", responseId: searchId })

			const [firstId, secondId] = postMessage.mock.calls.map(([message]) => message.requestId)
			expect(firstId).not.toBe(secondId)

			send({ type: "fileSearchResults", requestId: secondId, results: [] })
			send({ type: "fileSearchResults", requestId: firstId, results: [] })

			await expect(first).resolves.toMatchObject({ requestId: firstId })
			await expect(second).resolves.toMatchObject({ requestId: secondId })
		})

		it("rejects with a timeout error when no response arrives in time and stops listening", async () => {
			vi.useFakeTimers()
			const remove = vi.spyOn(window, "removeEventListener")
			const pending = request({
				build: buildSearch,
				responseType: "fileSearchResults",
				responseId: searchId,
				timeoutMs: 500,
			})
			const settled = expect(pending).rejects.toBeInstanceOf(ExtensionRequestTimeoutError)

			vi.advanceTimersByTime(500)
			await settled
			expect(remove.mock.calls.filter(([type]) => type === "message")).toHaveLength(1)
		})

		it("rejects and stops listening when the signal aborts", async () => {
			const controller = new AbortController()
			const pending = request({
				build: buildSearch,
				responseType: "fileSearchResults",
				responseId: searchId,
				signal: controller.signal,
			})

			controller.abort()

			await expect(pending).rejects.toMatchObject({ name: "AbortError" })
		})

		it("does not post at all when the signal is already aborted", async () => {
			const controller = new AbortController()
			controller.abort()

			await expect(
				request({
					build: buildSearch,
					responseType: "fileSearchResults",
					responseId: searchId,
					signal: controller.signal,
				}),
			).rejects.toMatchObject({ name: "AbortError" })
			expect(postMessage).not.toHaveBeenCalled()
		})
	})
})
