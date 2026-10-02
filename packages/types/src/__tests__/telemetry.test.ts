// pnpm --filter @tumble-code/types test src/__tests__/telemetry.test.ts

import { ApiProviderError, ConsecutiveMistakeError } from "../telemetry.js"

describe("telemetry error classes", () => {
	describe("ApiProviderError", () => {
		it("should create an error with correct properties", () => {
			const error = new ApiProviderError("Test error", "OpenRouter", "gpt-4", "createMessage", 500)

			expect(error.message).toBe("Test error")
			expect(error.name).toBe("ApiProviderError")
			expect(error.provider).toBe("OpenRouter")
			expect(error.modelId).toBe("gpt-4")
			expect(error.operation).toBe("createMessage")
			expect(error.errorCode).toBe(500)
		})

		it("should work without optional errorCode", () => {
			const error = new ApiProviderError("Test error", "OpenRouter", "gpt-4", "createMessage")

			expect(error.message).toBe("Test error")
			expect(error.provider).toBe("OpenRouter")
			expect(error.modelId).toBe("gpt-4")
			expect(error.operation).toBe("createMessage")
			expect(error.errorCode).toBeUndefined()
		})

		it("should be an instance of Error", () => {
			const error = new ApiProviderError("Test error", "OpenRouter", "gpt-4", "createMessage")
			expect(error).toBeInstanceOf(Error)
		})
	})

	describe("ConsecutiveMistakeError", () => {
		it("should create an error with correct properties", () => {
			const error = new ConsecutiveMistakeError("Test error", "task-123", 5, 3, "no_tools_used")

			expect(error.message).toBe("Test error")
			expect(error.name).toBe("ConsecutiveMistakeError")
			expect(error.taskId).toBe("task-123")
			expect(error.consecutiveMistakeCount).toBe(5)
			expect(error.consecutiveMistakeLimit).toBe(3)
			expect(error.reason).toBe("no_tools_used")
		})

		it("should create an error with provider and modelId", () => {
			const error = new ConsecutiveMistakeError(
				"Test error",
				"task-123",
				5,
				3,
				"no_tools_used",
				"anthropic",
				"claude-3-sonnet-20240229",
			)

			expect(error.message).toBe("Test error")
			expect(error.name).toBe("ConsecutiveMistakeError")
			expect(error.taskId).toBe("task-123")
			expect(error.consecutiveMistakeCount).toBe(5)
			expect(error.consecutiveMistakeLimit).toBe(3)
			expect(error.reason).toBe("no_tools_used")
			expect(error.provider).toBe("anthropic")
			expect(error.modelId).toBe("claude-3-sonnet-20240229")
		})

		it("should be an instance of Error", () => {
			const error = new ConsecutiveMistakeError("Test error", "task-123", 3, 3)
			expect(error).toBeInstanceOf(Error)
		})

		it("should handle zero values", () => {
			const error = new ConsecutiveMistakeError("Zero test", "task-000", 0, 0)

			expect(error.taskId).toBe("task-000")
			expect(error.consecutiveMistakeCount).toBe(0)
			expect(error.consecutiveMistakeLimit).toBe(0)
		})

		it("should default reason to unknown when not provided", () => {
			const error = new ConsecutiveMistakeError("Test error", "task-123", 3, 3)
			expect(error.reason).toBe("unknown")
		})

		it("should accept tool_repetition reason", () => {
			const error = new ConsecutiveMistakeError("Test error", "task-123", 3, 3, "tool_repetition")
			expect(error.reason).toBe("tool_repetition")
		})

		it("should accept no_tools_used reason", () => {
			const error = new ConsecutiveMistakeError("Test error", "task-123", 3, 3, "no_tools_used")
			expect(error.reason).toBe("no_tools_used")
		})

		it("should have undefined provider and modelId when not provided", () => {
			const error = new ConsecutiveMistakeError("Test error", "task-123", 3, 3, "no_tools_used")
			expect(error.provider).toBeUndefined()
			expect(error.modelId).toBeUndefined()
		})
	})
})
