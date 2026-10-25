/**
 * Validates the generated schemas/roomodes.json against sample configurations
 * using AJV. The schema itself is dynamically generated from the Zod types in
 * packages/types/src/mode.ts -- see packages/types/scripts/generate-roomodes-schema.ts.
 *
 * A separate drift-detection test (roomodes-schema-sync.spec.ts) ensures the
 * checked-in schema stays in sync with the Zod source of truth.
 */
import { describe, it, expect, beforeAll } from "vitest"
import Ajv, { type ValidateFunction } from "ajv"
import * as fs from "fs"
import * as path from "path"
import { fileURLToPath } from "url"

const mode = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
	slug: "my-mode",
	name: "My Mode",
	roleDefinition: "You are a helpful assistant.",
	groups: ["read"],
	...overrides,
})

const without = (key: string) => {
	const { [key]: _omitted, ...rest } = mode()
	return rest
}

describe("roomodes JSON schema", () => {
	let validate: ValidateFunction

	beforeAll(() => {
		const __dirname = path.dirname(fileURLToPath(import.meta.url))
		const schemaPath = path.resolve(__dirname, "../../../../schemas/roomodes.json")
		const ajv = new Ajv.default({ strict: false })
		validate = ajv.compile(JSON.parse(fs.readFileSync(schemaPath, "utf-8")))
	})

	it.each<[string, unknown[]]>([
		["no modes", []],
		["a minimal mode", [mode()]],
		[
			"every optional property",
			[
				mode({
					whenToUse: "Use when you need everything.",
					description: "A mode with all properties.",
					customInstructions: "Follow these additional rules.",
					groups: ["read", "edit", "command", "mcp", "modes"],
					source: "project",
				}),
			],
		],
		[
			"a tuple group with a file regex and description",
			[mode({ groups: [["edit", { fileRegex: "\\.md$", description: "Markdown" }]] })],
		],
		["a tuple group with empty options", [mode({ groups: [["edit", {}]] })]],
		[
			"the deprecated browser group, plain and as a tuple",
			[mode({ groups: ["browser", ["browser", { fileRegex: "\\.html$" }]] })],
		],
		[
			"rules files, with or without content",
			[
				mode({
					rulesFiles: [{ relativePath: "rule1.md", content: "# Rule 1" }, { relativePath: "sub/rule2.md" }],
				}),
			],
		],
		["an empty rules file list", [mode({ rulesFiles: [] })]],
		["several modes", [mode({ slug: "mode-a" }), mode({ slug: "mode-b" })]],
	])("accepts %s", (_name, customModes) => {
		expect(validate({ customModes })).toBe(true)
		expect(validate.errors).toBeNull()
	})

	it.each<[string, unknown]>([
		["a file without customModes", {}],
		["a mode without a slug", { customModes: [without("slug")] }],
		["a mode without groups", { customModes: [without("groups")] }],
		["a slug with invalid characters", { customModes: [mode({ slug: "invalid slug!" })] }],
		["an unknown group", { customModes: [mode({ groups: ["nonexistent"] })] }],
		["an unknown mode property", { customModes: [mode({ unknownField: true })] }],
		[
			"an unknown group option",
			{ customModes: [mode({ groups: [["edit", { fileRegex: "x", unknownOpt: true }]] })] },
		],
		["a group tuple of three", { customModes: [mode({ groups: [["edit", { fileRegex: "x" }, "extra"]] })] }],
		["an unknown source", { customModes: [mode({ source: "unknown" })] }],
		["a rules file without a path", { customModes: [mode({ rulesFiles: [{ content: "x" }] })] }],
		[
			"an unknown rules file property",
			{ customModes: [mode({ rulesFiles: [{ relativePath: "r.md", extra: true }] })] },
		],
	])("rejects %s", (_name, config) => {
		expect(validate(config)).toBe(false)
	})
})
