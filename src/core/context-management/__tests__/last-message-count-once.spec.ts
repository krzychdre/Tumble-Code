// cd src && ./node_modules/.bin/vitest run core/context-management/__tests__/last-message-count-once.spec.ts

// API P4 (Phase 10): every request counted the tokens of the last message
// twice: once in TaskApiLoop (for the threshold check) and again inside
// manageContext. The second count now reuses the first when both use the same
// handler.

import { TelemetryService } from "@roo-code/telemetry"
import type { ModelInfo } from "@roo-code/types"

import { BaseProvider } from "../../../api/providers/base-provider"
import type { ApiMessage } from "../../task-persistence/apiMessages"
import { manageContext } from "../index"

class CountingHandler extends BaseProvider {
	counted: unknown[] = []

	createMessage(): any {
		return {
			async *[Symbol.asyncIterator]() {
				yield { type: "text", text: "summary" }
			},
		}
	}

	getModel(): { id: string; info: ModelInfo } {
		return {
			id: "m",
			info: { contextWindow: 100_000, maxTokens: 8_000, supportsPromptCache: false } as ModelInfo,
		}
	}

	override async countTokens(content: any[]): Promise<number> {
		this.counted.push(content)
		return 42
	}
}

const messages: ApiMessage[] = [
	{ role: "user", content: "first", ts: 1 },
	{ role: "assistant", content: "reply", ts: 2 },
	{ role: "user", content: [{ type: "text", text: "a large tool result ".repeat(500) }], ts: 3 },
]

const base = {
	messages,
	totalTokens: 1_000,
	contextWindow: 100_000,
	maxTokens: 8_000,
	autoCondenseContext: false,
	autoCondenseContextPercent: 100,
	systemPrompt: "system",
	taskId: "t",
	profileThresholds: {},
	currentProfileId: "default",
}

describe("manageContext counts the last message once (API P4)", () => {
	beforeAll(() => {
		if (!TelemetryService.hasInstance()) {
			TelemetryService.createInstance([])
		}
	})

	it("counts the last message itself when the caller did not", async () => {
		const handler = new CountingHandler()

		const result = await manageContext({ ...base, apiHandler: handler })

		expect(handler.counted).toHaveLength(1)
		expect(result.prevContextTokens).toBe(1_000 + 42)
	})

	it("reuses the caller's count instead of counting the last message again", async () => {
		const handler = new CountingHandler()

		const result = await manageContext({ ...base, apiHandler: handler, lastMessageTokens: 42 })

		expect(handler.counted).toHaveLength(0)
		// Same result as counting it here.
		expect(result.prevContextTokens).toBe(1_000 + 42)
	})
})
