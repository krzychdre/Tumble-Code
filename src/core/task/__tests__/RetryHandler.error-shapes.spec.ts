import { RetryHandler } from "../RetryHandler"
import type { RetryHandlerAccess } from "../RetryHandler"
import type { TaskAskSay } from "../TaskAskSay"
import type { ClineProvider } from "../../webview/ClineProvider"

/**
 * S6 round 3 characterization: RetryHandler reads caught errors of any shape
 * (`status`, `message`, Google's `errorDetails` RetryInfo). These tests pin
 * what it does with each shape so the `error: any` -> `unknown` change cannot
 * move it.
 */

function makeHandler(overrides: Partial<RetryHandlerAccess> = {}) {
	const say = vi.fn().mockResolvedValue(undefined)
	const ask = vi.fn().mockResolvedValue({ response: "noButtonClicked" })
	const provider = { getState: async () => undefined } as unknown as ClineProvider
	const access: RetryHandlerAccess = {
		taskId: "test-task",
		instanceId: "test-instance",
		abort: false,
		isBackground: false,
		apiConfiguration: { apiProvider: "anthropic" },
		api: { getModel: () => ({ id: "test-model" }) } as unknown as RetryHandlerAccess["api"],
		contextManager: {
			handleContextWindowExceededError: vi.fn().mockResolvedValue(undefined),
		} as unknown as RetryHandlerAccess["contextManager"],
		providerRef: new WeakRef(provider),
		askSay: { say, ask } as unknown as TaskAskSay,
		abortTask: vi.fn().mockResolvedValue(undefined),
		...overrides,
	}
	return { handler: new RetryHandler(access), access, say, ask }
}

const retryInfo = (retryDelay: unknown) => ({ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay })

describe("RetryHandler.buildErrorHeaderText", () => {
	const { handler } = makeHandler()

	it.each([
		["status and message", { status: 500, message: "boom" }, "500\nboom\n"],
		["status without message", { status: 503 }, "503\nUnknown error\n"],
		["message only", new Error("plain"), "plain\n"],
		["neither", {}, "Unknown error\n"],
		["undefined", undefined, "Unknown error\n"],
		["null", null, "Unknown error\n"],
		["a string", "text error", "Unknown error\n"],
	])("%s", (_label, error, expected) => {
		expect(handler.buildErrorHeaderText(error)).toBe(expected)
	})
})

describe("RetryHandler.calculateBackoffDelay RetryInfo", () => {
	const { handler } = makeHandler()
	const state = { requestDelaySeconds: 5 }

	it("a 429 with a RetryInfo of 30s waits 31 s", () => {
		expect(handler.calculateBackoffDelay(0, { status: 429, errorDetails: [retryInfo("30s")] }, state)).toBe(31)
	})

	it("ignores the RetryInfo when the status is not 429", () => {
		expect(handler.calculateBackoffDelay(0, { status: 500, errorDetails: [retryInfo("30s")] }, state)).toBe(5)
	})

	it("ignores a RetryInfo that is not whole seconds, or not a string", () => {
		expect(handler.calculateBackoffDelay(0, { status: 429, errorDetails: [retryInfo("1.5s")] }, state)).toBe(5)
		expect(handler.calculateBackoffDelay(0, { status: 429, errorDetails: [retryInfo(30)] }, state)).toBe(5)
	})

	it("keeps the exponential delay for a 429 without errorDetails, and for other detail types", () => {
		expect(handler.calculateBackoffDelay(1, { status: 429 }, state)).toBe(10)
		expect(handler.calculateBackoffDelay(0, { status: 429, errorDetails: [{ "@type": "other" }] }, state)).toBe(5)
	})

	it("reads only `status`, not `statusCode`", () => {
		expect(handler.calculateBackoffDelay(0, { statusCode: 429, errorDetails: [retryInfo("30s")] }, state)).toBe(5)
	})
})

describe("RetryHandler.handleApiRequestError api_req_failed text", () => {
	async function askedText(error: unknown) {
		const { handler, ask } = makeHandler()
		const retryRequest = vi.fn()
		const it = handler.handleApiRequestError(error, 0, false, {} as AsyncIterator<unknown>, 0, retryRequest)
		await expect(it.next()).rejects.toThrow()
		expect(retryRequest).not.toHaveBeenCalled()
		return ask.mock.calls[0][1]
	}

	it("shows the error message when there is one", async () => {
		expect(await askedText(Object.assign(new Error("bad request"), { status: 400 }))).toBe("bad request")
	})

	it("shows the serialized error when there is no message", async () => {
		expect(await askedText({ status: 400, detail: "x" })).toBe(
			JSON.stringify({ status: 400, detail: "x" }, null, 2),
		)
	})
})
