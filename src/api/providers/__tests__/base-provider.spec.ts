import { Anthropic } from "@anthropic-ai/sdk"

import type { ModelInfo } from "@roo-code/types"

import { BaseProvider } from "../base-provider"
import { getNativeTools } from "../../../core/prompts/tools/native-tools"
import { convertOpenAIToolsToAnthropic } from "../../../core/prompts/tools/native-tools/converters"
import type { ApiStream } from "../../transform/stream"

// Create a concrete implementation for testing
class TestProvider extends BaseProvider {
	createMessage(_systemPrompt: string, _messages: Anthropic.Messages.MessageParam[]): ApiStream {
		throw new Error("Not implemented")
	}

	getModel(): { id: string; info: ModelInfo } {
		return {
			id: "test-model",
			info: {
				maxTokens: 4096,
				contextWindow: 128000,
				supportsPromptCache: false,
			},
		}
	}

	// Expose protected method for testing
	public testConvertToolSchemaForOpenAI(schema: any): any {
		return this.convertToolSchemaForOpenAI(schema)
	}

	// Expose protected method for testing
	public testConvertToolsForOpenAI(tools: any[] | undefined): any[] | undefined {
		return this.convertToolsForOpenAI(tools)
	}
}

describe("BaseProvider", () => {
	let provider: TestProvider

	beforeEach(() => {
		provider = new TestProvider()
	})

	describe("convertToolSchemaForOpenAI", () => {
		it("should add additionalProperties: false to object schemas", () => {
			const schema = {
				type: "object",
				properties: {
					name: { type: "string" },
				},
			}

			const result = provider.testConvertToolSchemaForOpenAI(schema)

			expect(result.additionalProperties).toBe(false)
		})

		it("should add required array with all properties for strict mode", () => {
			const schema = {
				type: "object",
				properties: {
					name: { type: "string" },
					age: { type: "number" },
				},
			}

			const result = provider.testConvertToolSchemaForOpenAI(schema)

			expect(result.required).toEqual(["name", "age"])
		})

		it("should recursively add additionalProperties: false to nested objects", () => {
			const schema = {
				type: "object",
				properties: {
					user: {
						type: "object",
						properties: {
							name: { type: "string" },
						},
					},
				},
			}

			const result = provider.testConvertToolSchemaForOpenAI(schema)

			expect(result.additionalProperties).toBe(false)
			expect(result.properties.user.additionalProperties).toBe(false)
		})

		it("should recursively add additionalProperties: false to array item objects", () => {
			const schema = {
				type: "object",
				properties: {
					users: {
						type: "array",
						items: {
							type: "object",
							properties: {
								name: { type: "string" },
							},
						},
					},
				},
			}

			const result = provider.testConvertToolSchemaForOpenAI(schema)

			expect(result.additionalProperties).toBe(false)
			expect(result.properties.users.items.additionalProperties).toBe(false)
		})

		it("should handle deeply nested objects", () => {
			const schema = {
				type: "object",
				properties: {
					level1: {
						type: "object",
						properties: {
							level2: {
								type: "object",
								properties: {
									level3: {
										type: "object",
										properties: {
											value: { type: "string" },
										},
									},
								},
							},
						},
					},
				},
			}

			const result = provider.testConvertToolSchemaForOpenAI(schema)

			expect(result.additionalProperties).toBe(false)
			expect(result.properties.level1.additionalProperties).toBe(false)
			expect(result.properties.level1.properties.level2.additionalProperties).toBe(false)
			expect(result.properties.level1.properties.level2.properties.level3.additionalProperties).toBe(false)
		})

		it("should convert nullable types to non-nullable", () => {
			const schema = {
				type: "object",
				properties: {
					name: { type: ["string", "null"] },
				},
			}

			const result = provider.testConvertToolSchemaForOpenAI(schema)

			expect(result.properties.name.type).toBe("string")
		})

		it("should return non-object schemas unchanged", () => {
			const schema = { type: "string" }
			const result = provider.testConvertToolSchemaForOpenAI(schema)

			expect(result).toEqual(schema)
		})

		it("should return null/undefined unchanged", () => {
			expect(provider.testConvertToolSchemaForOpenAI(null)).toBeNull()
			expect(provider.testConvertToolSchemaForOpenAI(undefined)).toBeUndefined()
		})

		it("should handle empty properties object", () => {
			const schema = {
				type: "object",
				properties: {},
			}

			const result = provider.testConvertToolSchemaForOpenAI(schema)

			expect(result.additionalProperties).toBe(false)
			expect(result.required).toEqual([])
		})
	})

	describe("convertToolsForOpenAI", () => {
		it("should return undefined for undefined input", () => {
			const result = provider.testConvertToolsForOpenAI(undefined)
			expect(result).toBeUndefined()
		})

		it("should set strict: true for non-MCP tools", () => {
			const tools = [
				{
					type: "function",
					function: {
						name: "read_file",
						description: "Read a file",
						parameters: { type: "object", properties: {} },
					},
				},
			]

			const result = provider.testConvertToolsForOpenAI(tools)

			expect(result?.[0].function.strict).toBe(true)
		})

		it("should set strict: false for MCP tools (mcp-- prefix)", () => {
			const tools = [
				{
					type: "function",
					function: {
						name: "mcp--github--get_me",
						description: "Get current user",
						parameters: { type: "object", properties: {} },
					},
				},
			]

			const result = provider.testConvertToolsForOpenAI(tools)

			expect(result?.[0].function.strict).toBe(false)
		})

		it("should apply schema conversion to non-MCP tools", () => {
			const tools = [
				{
					type: "function",
					function: {
						name: "read_file",
						description: "Read a file",
						parameters: {
							type: "object",
							properties: {
								path: { type: "string" },
							},
						},
					},
				},
			]

			const result = provider.testConvertToolsForOpenAI(tools)

			expect(result?.[0].function.parameters.additionalProperties).toBe(false)
			expect(result?.[0].function.parameters.required).toEqual(["path"])
		})

		it("should not apply schema conversion to MCP tools in base-provider", () => {
			// Note: In base-provider, MCP tools are passed through unchanged
			// The openai-native provider has its own handling for MCP tools
			const tools = [
				{
					type: "function",
					function: {
						name: "mcp--github--get_me",
						description: "Get current user",
						parameters: {
							type: "object",
							properties: {
								token: { type: "string" },
							},
							required: ["token"],
						},
					},
				},
			]

			const result = provider.testConvertToolsForOpenAI(tools)

			// MCP tools pass through original parameters in base-provider
			expect(result?.[0].function.parameters.additionalProperties).toBeUndefined()
		})

		it("should preserve non-function tools unchanged", () => {
			const tools = [
				{
					type: "other_type",
					data: "some data",
				},
			]

			const result = provider.testConvertToolsForOpenAI(tools)

			expect(result?.[0]).toEqual(tools[0])
		})
	})

	// DEF-C10: getNativeTools() hands out the same module-level tool objects on
	// every call, so a conversion that writes into its input changes the tool
	// definitions for every later request in the process (any provider, any
	// mode). These tests pin that the conversion only reads its input, and that
	// what is sent to the model keeps exactly the shape it has today.
	describe("does not mutate its input (DEF-C10)", () => {
		const deepFreeze = <T>(value: T): T => {
			if (value && typeof value === "object" && !Object.isFrozen(value)) {
				Object.freeze(value)
				for (const child of Object.values(value)) {
					deepFreeze(child)
				}
			}
			return value
		}

		// Recursively drops "description" keys so the snapshot pins the schema
		// shape (types, required, additionalProperties, key order) without
		// breaking every time a tool description is reworded.
		const withoutDescriptions = (value: unknown): unknown => {
			if (Array.isArray(value)) {
				return value.map(withoutDescriptions)
			}
			if (value && typeof value === "object") {
				return Object.fromEntries(
					Object.entries(value)
						.filter(([key]) => key !== "description")
						.map(([key, child]) => [key, withoutDescriptions(child)]),
				)
			}
			return value
		}

		const nullableSchema = () => ({
			type: "object",
			properties: {
				command: { type: "string" },
				cwd: { type: ["string", "null"] },
				either: { type: ["string", "number", "null"] },
				nested: {
					type: ["object", "null"],
					properties: {
						inner: { type: ["number", "null"] },
					},
				},
				list: {
					type: ["array", "null"],
					items: {
						type: "object",
						properties: {
							mode: { type: ["string", "null"] },
						},
					},
				},
			},
			required: ["command"],
		})

		it("converts a nullable schema exactly as before (characterization)", () => {
			const result = provider.testConvertToolSchemaForOpenAI(nullableSchema())

			expect(result).toEqual({
				type: "object",
				properties: {
					command: { type: "string" },
					cwd: { type: "string" },
					either: { type: ["string", "number"] },
					nested: {
						type: "object",
						properties: {
							inner: { type: "number" },
						},
						additionalProperties: false,
						required: ["inner"],
					},
					list: {
						type: "array",
						items: {
							type: "object",
							properties: {
								mode: { type: "string" },
							},
							additionalProperties: false,
							required: ["mode"],
						},
					},
				},
				required: ["command", "cwd", "either", "nested", "list"],
				additionalProperties: false,
			})
		})

		it("leaves the input schema deep-equal to itself", () => {
			const schema = nullableSchema()
			const before = structuredClone(schema)

			provider.testConvertToolSchemaForOpenAI(schema)

			expect(schema).toEqual(before)
		})

		it("converts a deep-frozen schema to the same output as an unfrozen one", () => {
			const expected = provider.testConvertToolSchemaForOpenAI(nullableSchema())
			const frozen = deepFreeze(nullableSchema())

			expect(provider.testConvertToolSchemaForOpenAI(frozen)).toEqual(expected)
		})

		it("keeps the shared native tool definitions intact after a conversion", () => {
			const before = structuredClone(getNativeTools())

			provider.testConvertToolsForOpenAI(getNativeTools())

			expect(getNativeTools()).toEqual(before)
			const executeCommand = getNativeTools().find(
				(tool) => tool.type === "function" && tool.function.name === "execute_command",
			) as any
			expect(executeCommand.function.parameters.properties.cwd.type).toEqual(["string", "null"])
		})

		it("keeps execute_command.cwd nullable for the next provider (mode switch to an Anthropic model)", () => {
			provider.testConvertToolsForOpenAI(getNativeTools())

			const anthropicTools = convertOpenAIToolsToAnthropic(getNativeTools())
			const executeCommand = anthropicTools.find((tool) => tool.name === "execute_command") as any
			expect(executeCommand.input_schema.properties.cwd.type).toEqual(["string", "null"])
			const followup = anthropicTools.find((tool) => tool.name === "ask_followup_question") as any
			expect(followup.input_schema.properties.follow_up.items.properties.mode.type).toEqual(["string", "null"])
		})

		it("sends the native tools to OpenAI-compatible models in an unchanged shape", () => {
			const first = provider.testConvertToolsForOpenAI(getNativeTools())
			const second = provider.testConvertToolsForOpenAI(getNativeTools())

			// Same output on every request, not only the first one.
			expect(second).toEqual(first)
			// JSON text (key order included) pinned against the output of the
			// implementation that shipped before DEF-C10 was fixed.
			expect(JSON.stringify(withoutDescriptions(first), null, 2)).toMatchSnapshot()
		})
	})
})
