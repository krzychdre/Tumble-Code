import { act, renderHook, waitFor } from "@testing-library/react"

import { getProviderModelSource, useProviderModels } from "../useProviderModels"

const { postMessage } = vi.hoisted(() => ({ postMessage: vi.fn() }))

vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage } }))

describe("useProviderModels", () => {
	beforeEach(() => postMessage.mockClear())

	it("maps provider aliases independently from source IDs", () => {
		expect(getProviderModelSource("openrouter")).toEqual({
			id: "openrouter",
			kind: "remote",
			payload: "models",
		})
		expect(getProviderModelSource("ollama")).toEqual({ id: "ollama", kind: "local", payload: "models" })
		expect(getProviderModelSource("vscode-lm")).toEqual({
			id: "vscode-lm",
			kind: "extension",
			payload: "modelIds",
		})
		expect(getProviderModelSource("anthropic")).toEqual({ kind: "static" })
	})

	it("does not request a static catalog", () => {
		renderHook(() => useProviderModels("anthropic"))
		expect(postMessage).not.toHaveBeenCalled()
	})

	it("sends one unified request and accepts only its correlated response", async () => {
		const { result } = renderHook(() => useProviderModels("ollama", { baseUrl: "http://localhost:11434" }))

		expect(postMessage).toHaveBeenCalledTimes(1)
		const request = postMessage.mock.calls[0][0].modelSourceRequest
		expect(postMessage.mock.calls[0][0]).toMatchObject({
			type: "requestProviderModels",
			modelSourceRequest: {
				source: { id: "ollama", kind: "local", payload: "models" },
				provider: "ollama",
				options: { baseUrl: "http://localhost:11434" },
			},
		})

		act(() => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: {
						type: "providerModels",
						modelSourceResult: { requestId: "other", sourceId: "ollama", models: { ignored: {} } },
					},
				}),
			)
		})
		expect(result.current.models).toBeUndefined()

		act(() => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: {
						type: "providerModels",
						modelSourceResult: { requestId: request.requestId, sourceId: "ollama", models: { qwen: {} } },
					},
				}),
			)
		})

		await waitFor(() => expect(result.current.models).toEqual({ qwen: {} }))
		expect(result.current.isLoading).toBe(false)
	})

	it("refreshes through the same protocol and exposes errors", async () => {
		const { result } = renderHook(() => useProviderModels("vscode-lm"))
		act(() => result.current.refresh())
		expect(postMessage).toHaveBeenCalledTimes(2)
		const request = postMessage.mock.calls[1][0].modelSourceRequest
		expect(request.refresh).toBe(true)

		act(() => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: {
						type: "providerModels",
						modelSourceResult: {
							requestId: request.requestId,
							sourceId: "vscode-lm",
							error: "unavailable",
						},
					},
				}),
			)
		})
		await waitFor(() => expect(result.current.error).toBe("unavailable"))
	})
	it("two consumers of the same source produce one request and both get the response", async () => {
		const options = { baseUrl: "http://localhost:1234" }
		const { result } = renderHook(() => ({
			first: useProviderModels("lmstudio", options),
			second: useProviderModels("lmstudio", { ...options }),
		}))

		const requests = postMessage.mock.calls.filter(([message]) => message.type === "requestProviderModels")
		expect(requests).toHaveLength(1)
		const { requestId } = requests[0][0].modelSourceRequest

		act(() => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: {
						type: "providerModels",
						modelSourceResult: { requestId, sourceId: "lmstudio", models: { local: {} } },
					},
				}),
			)
		})

		await waitFor(() => expect(result.current.first.models).toEqual({ local: {} }))
		expect(result.current.second.models).toEqual({ local: {} })
		expect(result.current.first.isLoading).toBe(false)
		expect(result.current.second.isLoading).toBe(false)
	})

	it("a refresh from one consumer sends one request and updates every consumer", async () => {
		const { result } = renderHook(() => ({
			first: useProviderModels("litellm"),
			second: useProviderModels("litellm"),
		}))
		const initial = postMessage.mock.calls[0][0].modelSourceRequest
		act(() => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: {
						type: "providerModels",
						modelSourceResult: { requestId: initial.requestId, sourceId: "litellm", models: { old: {} } },
					},
				}),
			)
		})
		await waitFor(() => expect(result.current.second.models).toEqual({ old: {} }))

		act(() => result.current.first.refresh())

		expect(postMessage).toHaveBeenCalledTimes(2)
		const refresh = postMessage.mock.calls[1][0].modelSourceRequest
		expect(refresh.refresh).toBe(true)
		// The stale list stays visible while the refresh is in flight (L1).
		expect(result.current.second.models).toEqual({ old: {} })

		act(() => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: {
						type: "providerModels",
						modelSourceResult: { requestId: refresh.requestId, sourceId: "litellm", models: { fresh: {} } },
					},
				}),
			)
		})
		await waitFor(() => expect(result.current.second.models).toEqual({ fresh: {} }))
		expect(result.current.first.models).toEqual({ fresh: {} })
	})
})
