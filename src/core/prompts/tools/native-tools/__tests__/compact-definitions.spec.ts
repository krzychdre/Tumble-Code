// cd src && npx vitest run core/prompts/tools/native-tools/__tests__/compact-definitions.spec.ts
//
// The compact tool definitions (native-tools/compact): short, minimal schemas
// that the existing argument parsers accept with only the required fields.

import type OpenAI from "openai"

import { getToolDescriptor } from "../../../../tools/toolDescriptors"
import { getNativeTools } from ".."
import { getCompactNativeTools } from "../compact"

type Schema = {
	type: string
	properties: Record<string, { type: unknown; description?: string; items?: unknown }>
	required: string[]
	additionalProperties?: boolean
}

const compactTools = getCompactNativeTools()
const fullTools = new Map(
	getNativeTools().map((tool) => [(tool as OpenAI.Chat.ChatCompletionFunctionTool).function.name, tool]),
)

function schemaOf(tool: OpenAI.Chat.ChatCompletionFunctionTool): Schema {
	return tool.function.parameters as unknown as Schema
}

/** A plausible value for a schema node, so a parser sees real types. */
function sampleValue(node: { type: unknown }): unknown {
	switch (node.type) {
		case "integer":
			return 1
		case "boolean":
			return true
		case "array":
			return ["one"]
		default:
			return "x"
	}
}

function argsFor(tool: OpenAI.Chat.ChatCompletionFunctionTool, fields: string[]): Record<string, unknown> {
	const { properties } = schemaOf(tool)
	return Object.fromEntries(fields.map((field) => [field, sampleValue(properties[field])]))
}

describe.each(compactTools.map((tool) => [tool.function.name, tool] as const))("compact %s", (name, tool) => {
	const schema = schemaOf(tool)

	it("is a plain, non-strict object schema whose required fields exist", () => {
		expect(schema.type).toBe("object")
		expect(schema.additionalProperties).toBe(false)
		expect("strict" in tool.function).toBe(false)
		for (const field of schema.required) {
			expect(schema.properties).toHaveProperty(field)
		}
		// No nullable unions: an optional parameter is simply left out of `required`.
		for (const node of Object.values(schema.properties)) {
			expect(typeof node.type).toBe("string")
		}
	})

	it("keeps descriptions short and free of en and em dashes", () => {
		expect(tool.function.description!.length).toBeLessThanOrEqual(300)
		expect(tool.function.description).not.toMatch(/[\u2013\u2014]/)
		for (const node of Object.values(schema.properties)) {
			expect(node.description?.length ?? 0).toBeLessThanOrEqual(100)
			expect(node.description ?? "").not.toMatch(/[\u2013\u2014]/)
		}
	})

	it("only uses parameter names the full definition (and so its parser) knows", () => {
		const full = fullTools.get(name) as OpenAI.Chat.ChatCompletionFunctionTool
		expect(full).toBeDefined()
		expect(Object.keys(schemaOf(full).properties)).toEqual(expect.arrayContaining(Object.keys(schema.properties)))
	})

	it("parses a complete call with only the required fields, and with every field", () => {
		const parse = getToolDescriptor(name)!.parseArgs

		expect(parse(argsFor(tool, schema.required), { partial: false })?.nativeArgs).toBeDefined()
		expect(parse(argsFor(tool, Object.keys(schema.properties)), { partial: false })?.nativeArgs).toBeDefined()
	})
})

describe("compact read_file and edit", () => {
	it("offers read_file only path, offset and limit, and parses a bare path", () => {
		const readFile = compactTools.find((tool) => tool.function.name === "read_file")!
		expect(Object.keys(schemaOf(readFile).properties)).toEqual(["path", "offset", "limit"])
		expect(schemaOf(readFile).required).toEqual(["path"])

		const parsed = getToolDescriptor("read_file")!.parseArgs({ path: "notes.md" }, { partial: false })
		expect(parsed?.nativeArgs).toEqual({
			path: "notes.md",
			mode: undefined,
			offset: undefined,
			limit: undefined,
			indentation: undefined,
		})
	})

	it("keeps the edit parameters of the existing edit tool, replace_all optional", () => {
		const edit = compactTools.find((tool) => tool.function.name === "edit")!
		expect(Object.keys(schemaOf(edit).properties)).toEqual(["file_path", "old_string", "new_string", "replace_all"])
		expect(schemaOf(edit).required).toEqual(["file_path", "old_string", "new_string"])
	})

	it("takes plain strings as follow_up suggestions, which the tool accepts", () => {
		const ask = compactTools.find((tool) => tool.function.name === "ask_followup_question")!
		expect(schemaOf(ask).properties.follow_up.items).toEqual({ type: "string" })

		const parsed = getToolDescriptor("ask_followup_question")!.parseArgs(
			{ question: "Which file?", follow_up: ["a.md", "b.md"] },
			{ partial: false },
		)
		expect(parsed?.nativeArgs).toEqual({ question: "Which file?", follow_up: ["a.md", "b.md"] })
	})
})
