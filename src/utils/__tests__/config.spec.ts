import { injectVariables } from "../config"
import { logger } from "../logging"

describe("injectVariables", () => {
	beforeEach(() => {
		vi.spyOn(logger, "warn").mockImplementation(() => {})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	const env = { API_KEY: "12345", ENDPOINT: "https://example.com", EMPTY: "" }

	it("replaces variables everywhere in an object without touching the original", async () => {
		const config = {
			key: "${env:API_KEY}",
			nested: {
				string: "Keep this ${env:API_KEY}",
				number: 123,
				boolean: true,
				list: ["${env:API_KEY}", "${env:ENDPOINT}", 5, false, null],
				deeper: { url: "${env:ENDPOINT}/v1" },
			},
		}
		const copy = structuredClone(config)

		const result = await injectVariables(config, { env })

		expect(result).toEqual({
			key: "12345",
			nested: {
				string: "Keep this 12345",
				number: 123,
				boolean: true,
				list: ["12345", "https://example.com", 5, false, null],
				deeper: { url: "https://example.com/v1" },
			},
		})
		expect(config).toEqual(copy)
	})

	it.each([
		["a plain variable", "Hello ${v}", { v: "Hola" }, undefined, "Hello Hola"],
		["an undefined variable, left as is", "Hello ${v}", { v: undefined }, undefined, "Hello ${v}"],
		["an empty variable", "Hello ${v}", { v: "" }, undefined, "Hello "],
		["a nested variable", "Hello ${env:API_KEY}", { env }, undefined, "Hello 12345"],
		["an empty nested variable", "x${env:EMPTY}y", { env }, undefined, "xy"],
		["a missing nested variable, left as is", "${env:MISSING}", { env }, undefined, "${env:MISSING}"],
		["a missing nested variable, replaced", "${env:MISSING}", { env }, "", ""],
		["text without variables", "no variables here", { env }, undefined, "no variables here"],
		["an empty string", "", { env }, undefined, ""],
		// Paths are written with forward slashes, whatever the platform.
		[
			"a Windows path",
			"${workspaceFolder}\\scripts",
			{ workspaceFolder: "C:\\Users\\project" },
			undefined,
			"C:/Users/project\\scripts",
		],
		["a nested Windows path", "${env:HOME}", { env: { HOME: "C:\\Users\\me" } }, undefined, "C:/Users/me"],
	])("replaces %s", async (_, config, variables, notFound, expected) => {
		expect(await injectVariables(config, variables, notFound)).toBe(expected)
	})

	it("normalizes path variables inside JSON values", async () => {
		const result = await injectVariables(
			{ args: ["${workspaceFolder}", "${dataPath}"] },
			{ workspaceFolder: "C:\\Program Files\\My Project", dataPath: "D:\\data" },
		)

		expect(result).toEqual({ args: ["C:/Program Files/My Project", "D:/data"] })
	})

	it("warns about a missing nested variable", async () => {
		await injectVariables("${env:MISSING}", { env })

		expect(logger.warn).toHaveBeenCalledWith(
			'[injectVariables] variable "MISSING" referenced but not found in "env"',
		)
	})

	it("returns an empty object unchanged", async () => {
		expect(await injectVariables({}, { env })).toEqual({})
	})
})
