// cd src && npx vitest run api/providers/__tests__/base-provider.compact.spec.ts
//
// convertToolsForOpenAI under a compact profile: optional parameters stay
// optional (original schema, strict: false); every other profile gets today's
// strict conversion byte for byte.

import { Anthropic } from "@anthropic-ai/sdk"

import type { ModelInfo } from "@tumble-code/types"

import { BaseProvider } from "../base-provider"
import { getNativeTools } from "../../../core/prompts/tools/native-tools"
import { getCompactNativeTools } from "../../../core/prompts/tools/native-tools/compact"
import type { ApiStream } from "../../transform/stream"

class TestProvider extends BaseProvider {
	createMessage(_systemPrompt: string, _messages: Anthropic.Messages.MessageParam[]): ApiStream {
		throw new Error("Not implemented")
	}

	getModel(): { id: string; info: ModelInfo } {
		return { id: "test-model", info: { maxTokens: 4096, contextWindow: 128000, supportsPromptCache: false } }
	}

	public convert(tools: any[] | undefined, profile?: { compactProfile?: boolean } | null): any[] | undefined {
		return this.convertToolsForOpenAI(tools, profile)
	}
}

const provider = new TestProvider()

function findTool(tools: any[] | undefined, name: string): any {
	return tools?.find((tool) => tool.function?.name === name)
}

describe("convertToolsForOpenAI with a compact profile", () => {
	it("keeps optional parameters optional and sends strict: false", () => {
		const converted = provider.convert(getCompactNativeTools(), { compactProfile: true })
		const readFile = findTool(converted, "read_file")

		expect(readFile.function.strict).toBe(false)
		expect(readFile.function.parameters.required).toEqual(["path"])
		expect(readFile.function.parameters.properties.offset).toEqual({
			type: "integer",
			description: "1-based line to start at",
		})

		const executeCommand = findTool(converted, "execute_command")
		expect(executeCommand.function.parameters.required).toEqual(["command"])
		expect(executeCommand.function.parameters.properties.cwd.type).toBe("string")
	})

	it("sends every compact schema exactly as defined", () => {
		const tools = getCompactNativeTools()
		const converted = provider.convert(tools, { compactProfile: true })!

		expect(converted.map((tool) => tool.function.parameters)).toEqual(tools.map((tool) => tool.function.parameters))
		expect(converted.every((tool) => tool.function.strict === false)).toBe(true)
	})

	it("also relaxes a full definition that carries strict: true", () => {
		const fullReadFile = findTool(getNativeTools(), "read_file")
		const converted = findTool(provider.convert([fullReadFile], { compactProfile: true }), "read_file")

		expect(fullReadFile.function.strict).toBe(true)
		expect(converted.function.strict).toBe(false)
		expect(converted.function.parameters.required).toEqual(["path"])
	})

	it("passes non-function tools through and keeps undefined undefined", () => {
		const custom = { type: "custom", custom: { name: "x" } }

		expect(provider.convert([custom], { compactProfile: true })).toEqual([custom])
		expect(provider.convert(undefined, { compactProfile: true })).toBeUndefined()
	})

	it("forces every property into required without the flag (today's strict conversion)", () => {
		const strictReadFile = findTool(provider.convert(getCompactNativeTools(), undefined), "read_file")

		expect(strictReadFile.function.strict).toBe(true)
		expect(strictReadFile.function.parameters.required).toEqual(["path", "offset", "limit"])
	})

	it.each([undefined, null, {}, { compactProfile: false }])(
		"gives today's bytes for the full catalog with profile %j",
		(profile) => {
			const tools = getNativeTools()

			expect(JSON.stringify(provider.convert(tools, profile))).toBe(JSON.stringify(provider.convert(tools)))
		},
	)
})
