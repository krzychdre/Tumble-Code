import type { ModeConfig, CustomModePrompts } from "@tumble-code/types"

import { FileRestrictionError, modes, getModeSelection, getModeAllowedMcpServers } from "../modes"

describe("FileRestrictionError", () => {
	it.each([
		[undefined, undefined, "This mode (Markdown Editor) can only edit files matching pattern: \\.md$. Got: a.js"],
		[
			"write_to_file",
			undefined,
			"Tool 'write_to_file' in mode 'Markdown Editor' can only edit files matching pattern: \\.md$. Got: a.js",
		],
		[
			undefined,
			"Markdown files only",
			"This mode (Markdown Editor) can only edit files matching pattern: \\.md$ (Markdown files only). Got: a.js",
		],
	])("names the tool %s and the description %s", (tool, description, message) => {
		const error = new FileRestrictionError("Markdown Editor", "\\.md$", description, "a.js", tool)

		expect(error.message).toBe(message)
		expect(error.name).toBe("FileRestrictionError")
	})
})

describe("getModeSelection", () => {
	const builtIn = (slug: string) => modes.find((m) => m.slug === slug)!
	const custom = (slug: string, fields: Partial<ModeConfig> = {}): ModeConfig => ({
		slug,
		name: slug,
		roleDefinition: `${slug} role`,
		customInstructions: `${slug} instructions`,
		description: `${slug} description`,
		groups: ["read"],
		...fields,
	})
	const prompt = { roleDefinition: "prompt role", customInstructions: "prompt instructions" }

	it.each([
		[
			"a built-in mode as it is",
			"ask",
			undefined,
			undefined,
			builtIn("ask").roleDefinition,
			builtIn("ask").customInstructions,
		],
		["a built-in mode with the prompt override", "ask", prompt, undefined, "prompt role", "prompt instructions"],
		[
			"a built-in mode with a partial override",
			"ask",
			{ roleDefinition: "prompt role" },
			undefined,
			"prompt role",
			builtIn("ask").customInstructions,
		],
		[
			"a built-in mode with an empty override",
			"ask",
			{},
			undefined,
			builtIn("ask").roleDefinition,
			builtIn("ask").customInstructions,
		],
		[
			"a custom mode over the built-in one and the override",
			"code",
			prompt,
			[custom("code")],
			"code role",
			"code instructions",
		],
		["a new custom mode", "mine", prompt, [custom("mine")], "mine role", "mine instructions"],
		[
			"a custom mode's empty fields as empty",
			"mine",
			prompt,
			[custom("mine", { roleDefinition: "", customInstructions: undefined })],
			"",
			"",
		],
		[
			"the default mode for an unknown slug",
			"nope",
			undefined,
			[custom("mine")],
			modes[0].roleDefinition,
			modes[0].customInstructions ?? "",
		],
	])("uses %s", (_, slug, promptComponent, customModes, roleDefinition, baseInstructions) => {
		expect(getModeSelection(slug, promptComponent, customModes)).toMatchObject({ roleDefinition, baseInstructions })
	})

	it("takes the description from the custom mode, else from the built-in one", () => {
		expect(getModeSelection("mine", undefined, [custom("mine")]).description).toBe("mine description")
		expect(getModeSelection("mine", undefined, [custom("mine", { description: undefined })]).description).toBe("")
		expect(getModeSelection("ask").description).toBe(builtIn("ask").description ?? "")
	})
})

describe("getModeAllowedMcpServers", () => {
	// A custom mode carries its allowlist on the ModeConfig.
	const customMode: ModeConfig = {
		slug: "custom-mode",
		name: "Custom Mode",
		roleDefinition: "role",
		groups: ["mcp"],
		allowedMcpServers: ["cfg-srv"],
		source: "global",
	}

	it.each<[string, string, CustomModePrompts | undefined, string[] | undefined]>([
		// Built-in modes have no ModeConfig allowlist; the prompt override channel carries it.
		["a built-in mode's override", "code", { code: { allowedMcpServers: ["srv"] } }, ["srv"]],
		["an empty override, which restricts to no servers", "code", { code: { allowedMcpServers: [] } }, []],
		[
			"the override over a custom mode's own list",
			"custom-mode",
			{ "custom-mode": { allowedMcpServers: ["o"] } },
			["o"],
		],
		["the custom mode's own list without an override", "custom-mode", undefined, ["cfg-srv"]],
		[
			"the custom mode's own list when the override has none",
			"custom-mode",
			{ "custom-mode": { roleDefinition: "x" } },
			["cfg-srv"],
		],
		["no restriction for a built-in mode without override", "code", undefined, undefined],
		["no restriction for an unknown mode", "nope", undefined, undefined],
	])("returns %s", (_, slug, prompts, expected) => {
		expect(getModeAllowedMcpServers(slug, [customMode], prompts)).toEqual(expected)
	})
})
