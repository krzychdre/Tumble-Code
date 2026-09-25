// cd src && ./node_modules/.bin/vitest run api/transform/__tests__/strict-json-schema.spec.ts

import { toStrictSchema } from "../strict-json-schema"

const deepFreeze = <T>(value: T): T => {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		Object.freeze(value)
		for (const child of Object.values(value)) {
			deepFreeze(child)
		}
	}
	return value
}

const schema = () => ({
	type: "object",
	additionalProperties: true,
	properties: {
		command: { type: "string" },
		cwd: { type: ["string", "null"] },
		either: { type: ["string", "number", "null"] },
		nested: {
			type: ["object", "null"],
			properties: { inner: { type: ["number", "null"] } },
		},
		plain: {
			type: "object",
			properties: { leaf: { type: ["boolean", "null"] } },
			required: [],
		},
		list: {
			type: "array",
			items: { type: "object", properties: { mode: { type: ["string", "null"] } } },
		},
	},
	required: ["command"],
})

describe("toStrictSchema", () => {
	it("stripNull: makes every property required, strips null and closes every object (Chat Completions)", () => {
		expect(toStrictSchema(schema(), { stripNull: true })).toEqual({
			type: "object",
			additionalProperties: false,
			properties: {
				command: { type: "string" },
				cwd: { type: "string" },
				either: { type: ["string", "number"] },
				nested: {
					type: "object",
					properties: { inner: { type: "number" } },
					additionalProperties: false,
					required: ["inner"],
				},
				plain: {
					type: "object",
					properties: { leaf: { type: "boolean" } },
					required: ["leaf"],
					additionalProperties: false,
				},
				list: {
					type: "array",
					items: {
						type: "object",
						properties: { mode: { type: "string" } },
						additionalProperties: false,
						required: ["mode"],
					},
				},
			},
			required: ["command", "cwd", "either", "nested", "plain", "list"],
		})
	})

	it("without stripNull: keeps null unions and does not descend into a nullable object (Responses API)", () => {
		expect(toStrictSchema(schema())).toEqual({
			type: "object",
			additionalProperties: false,
			properties: {
				command: { type: "string" },
				cwd: { type: ["string", "null"] },
				either: { type: ["string", "number", "null"] },
				nested: {
					type: ["object", "null"],
					properties: { inner: { type: ["number", "null"] } },
				},
				plain: {
					type: "object",
					properties: { leaf: { type: ["boolean", "null"] } },
					required: ["leaf"],
					additionalProperties: false,
				},
				list: {
					type: "array",
					items: {
						type: "object",
						properties: { mode: { type: ["string", "null"] } },
						additionalProperties: false,
						required: ["mode"],
					},
				},
			},
			required: ["command", "cwd", "either", "nested", "plain", "list"],
		})
	})

	it("mcp: only closes objects, keeping the server's required list and types", () => {
		expect(toStrictSchema(schema(), { mcp: true })).toEqual({
			type: "object",
			additionalProperties: false,
			properties: {
				command: { type: "string" },
				cwd: { type: ["string", "null"] },
				either: { type: ["string", "number", "null"] },
				nested: {
					type: ["object", "null"],
					properties: { inner: { type: ["number", "null"] } },
				},
				plain: {
					type: "object",
					properties: { leaf: { type: ["boolean", "null"] } },
					required: [],
					additionalProperties: false,
				},
				list: {
					type: "array",
					items: {
						type: "object",
						properties: { mode: { type: ["string", "null"] } },
						additionalProperties: false,
					},
				},
			},
			required: ["command"],
		})
	})

	it("keeps the key order of the input (the schema bytes are part of the cached prompt prefix)", () => {
		const result = toStrictSchema(schema(), { stripNull: true })

		expect(Object.keys(result)).toEqual(["type", "additionalProperties", "properties", "required"])
		expect(Object.keys(result.properties)).toEqual(["command", "cwd", "either", "nested", "plain", "list"])
		expect(Object.keys(toStrictSchema({ type: "object", properties: { a: { type: "string" } } }))).toEqual([
			"type",
			"properties",
			"additionalProperties",
			"required",
		])
	})

	it.each([
		["stripNull", { stripNull: true }],
		["default", {}],
		["mcp", { mcp: true }],
	])("does not mutate its input (%s)", (_name, options) => {
		const input = schema()
		const before = structuredClone(input)
		const expected = toStrictSchema(schema(), options)

		expect(toStrictSchema(input, options)).toEqual(expected)
		expect(input).toEqual(before)
		expect(toStrictSchema(deepFreeze(schema()), options)).toEqual(expected)
	})

	it("returns non-object schemas and empty values unchanged", () => {
		const stringSchema = { type: "string" }

		expect(toStrictSchema(stringSchema, { stripNull: true })).toBe(stringSchema)
		expect(toStrictSchema(undefined)).toBeUndefined()
		expect(toStrictSchema(null)).toBeNull()
	})

	it("tolerates a null property value instead of throwing", () => {
		const result = toStrictSchema({ type: "object", properties: { broken: null, ok: { type: "string" } } })

		expect(result.properties).toEqual({ broken: null, ok: { type: "string" } })
		expect(result.required).toEqual(["broken", "ok"])
	})
})
