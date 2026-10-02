import { applySourceMapsToStack, enhanceErrorWithSourceMaps } from "../sourceMapUtils"

// Mock console.debug to avoid cluttering test output
beforeEach(() => {
	vi.spyOn(console, "debug").mockImplementation(() => {})
})

describe("sourceMapUtils", () => {
	describe("applySourceMapsToStack", () => {
		test("should return original stack when source maps cannot be applied", async () => {
			const stackTrace = `Error: Test error
    at Function.execute (webpack:///./src/components/App.tsx:123:45)`

			const result = await applySourceMapsToStack(stackTrace)

			// For now, we expect it to return the original stack
			// since we haven't implemented actual source map application
			expect(result).toBe(stackTrace)
		})

		test("should handle empty stack", async () => {
			const emptyStack = ""
			const result = await applySourceMapsToStack(emptyStack)
			expect(result).toBe(emptyStack)
		})
	})

	describe("enhanceErrorWithSourceMaps", () => {
		test("should add sourceMappedStack property to error", async () => {
			const error = new Error("Test error")
			error.stack = `Error: Test error
    at Function.execute (webpack:///./src/components/App.tsx:123:45)`

			// Mock the applySourceMapsToStack function
			vi.spyOn(global.console, "error").mockImplementation(() => {})

			const enhancedError = await enhanceErrorWithSourceMaps(error)

			expect(enhancedError).toBe(error) // Should return the same error object
			expect("sourceMappedStack" in enhancedError).toBe(true)
		})

		test("should handle errors without stack", async () => {
			const error = new Error("Test error")
			error.stack = undefined

			const enhancedError = await enhanceErrorWithSourceMaps(error)

			expect(enhancedError).toBe(error)
			expect("sourceMappedStack" in enhancedError).toBe(false)
		})
	})
})
