import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { generateImageWithProvider } from "../image-generation"

// Mock the i18n module
vi.mock("../../../i18n", () => ({
	t: (key: string, options?: any) => {
		// Return a sensible mock for i18n
		if (key === "tools:generateImage.failedWithMessage" && options?.message) {
			return options.message
		}
		return key
	},
}))

// Mock fetch globally
global.fetch = vi.fn()
global.FormData = vi.fn(() => ({
	append: vi.fn(),
})) as any
global.Blob = vi.fn() as any
global.atob = vi.fn((str: string) => {
	return Buffer.from(str, "base64").toString("binary")
})

describe("generateImageWithProvider (chat completions)", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	it("should use /chat/completions endpoint", async () => {
		const mockResponse = {
			ok: true,
			json: vi.fn().mockResolvedValue({
				choices: [
					{
						message: {
							images: [
								{
									image_url: {
										url: "data:image/png;base64,iVBORw0KGgo=",
									},
								},
							],
						},
					},
				],
			}),
		}

		vi.mocked(global.fetch).mockResolvedValue(mockResponse as any)

		const result = await generateImageWithProvider({
			baseURL: "https://api.example.com/v1",
			authToken: "test-token",
			model: "gpt-4-vision",
			prompt: "A cute cat",
		})

		expect(result.success).toBe(true)

		// Verify /chat/completions endpoint was used
		const callUrl = vi.mocked(global.fetch).mock.calls[0][0]
		expect(callUrl).toContain("/chat/completions")
		// App attribution shared with the chat providers.
		expect(vi.mocked(global.fetch).mock.calls[0][1]?.headers).toMatchObject({
			"HTTP-Referer": "https://github.com/krzychdre/Tumble-Code",
			"X-Title": "Tumble Code",
		})
	})

	it("should handle missing images in response", async () => {
		const mockResponse = {
			ok: true,
			json: vi.fn().mockResolvedValue({
				choices: [{ message: { content: "No images" } }],
			}),
		}

		vi.mocked(global.fetch).mockResolvedValue(mockResponse as any)

		const result = await generateImageWithProvider({
			baseURL: "https://api.example.com/v1",
			authToken: "test-token",
			model: "gpt-4-vision",
			prompt: "A cute cat",
		})

		expect(result.success).toBe(false)
		expect(result.error).toBeDefined()
	})
})
