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
})
