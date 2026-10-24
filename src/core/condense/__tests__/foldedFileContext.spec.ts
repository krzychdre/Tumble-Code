// npx vitest run core/condense/__tests__/foldedFileContext.spec.ts

import * as path from "path"

import type { ApiHandler } from "../../../api"
import { parseSourceCodeDefinitionsForFile } from "../../../services/tree-sitter"
import { logger } from "../../../utils/logging"
import { ApiMessage } from "../../task-persistence/apiMessages"
import { generateFoldedFileContext } from "../foldedFileContext"
import { summarizeConversation } from "../index"

vi.mock("../../../services/tree-sitter", () => ({
	parseSourceCodeDefinitionsForFile: vi.fn(),
}))

vi.mock("@tumble-code/telemetry", () => ({
	TelemetryService: {
		hasInstance: vi.fn().mockReturnValue(true),
		instance: { capture: vi.fn() },
	},
}))

const parse = vi.mocked(parseSourceCodeDefinitionsForFile)

const section = (file: string, definitions: string) =>
	`<system-reminder>\n## File Context: ${file}\n${definitions}\n</system-reminder>`

describe("generateFoldedFileContext", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.spyOn(logger, "warn").mockImplementation(() => {})
	})
	afterEach(() => vi.restoreAllMocks())

	it("returns an empty result for no files", async () => {
		expect(await generateFoldedFileContext([], { cwd: "/test" })).toEqual({
			content: "",
			sections: [],
			filesProcessed: 0,
			filesSkipped: 0,
			characterCount: 0,
		})
		expect(parse).not.toHaveBeenCalled()
	})

	it("wraps each file in its own system-reminder block and resolves relative paths against cwd", async () => {
		parse.mockResolvedValueOnce("1--5 | export interface User").mockResolvedValueOnce("1--3 | def greet(name)")

		const result = await generateFoldedFileContext(["src/user.ts", "/abs/person.py"], { cwd: "/test" })

		expect(parse.mock.calls.map(([file]) => file)).toEqual([path.resolve("/test", "src/user.ts"), "/abs/person.py"])
		expect(result.sections).toEqual([
			section("src/user.ts", "1--5 | export interface User"),
			section("/abs/person.py", "1--3 | def greet(name)"),
		])
		expect(result.content).toBe(result.sections.join("\n"))
		expect(result).toMatchObject({ filesProcessed: 2, filesSkipped: 0, characterCount: result.content.length })
	})

	it("skips files tree-sitter cannot fold, without embedding its error text", async () => {
		parse
			.mockResolvedValueOnce("1--3 | export const x = 1")
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce("This file does not exist or you do not have permission to access it.")
			.mockResolvedValueOnce("Unsupported file type: /test/file.xyz")
			.mockRejectedValueOnce(new Error("boom"))

		const result = await generateFoldedFileContext(["ok.ts", "none.txt", "missing.ts", "file.xyz", "bad.ts"], {
			cwd: "/test",
		})

		expect(result.sections).toEqual([section("ok.ts", "1--3 | export const x = 1")])
		expect(result).toMatchObject({ filesProcessed: 1, filesSkipped: 4 })
		expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("skipped 1 file(s) due to errors: bad.ts"))
	})

	it("names at most five failed files in the warning", async () => {
		parse.mockRejectedValue(new Error("boom"))

		await generateFoldedFileContext(["1", "2", "3", "4", "5", "6", "7"], { cwd: "/test" })

		expect(logger.warn).toHaveBeenCalledWith(
			"Folded context generation: skipped 7 file(s) due to errors: 1, 2, 3, 4, 5 and 2 more",
		)
	})

	it("truncates the file that crosses the budget and counts the rest as skipped", async () => {
		const definitions = "1--3 | " + "x".repeat(300)
		parse.mockResolvedValue(definitions)
		const first = section("a.ts", definitions)

		const result = await generateFoldedFileContext(["a.ts", "b.ts", "c.ts"], {
			cwd: "/test",
			maxCharacters: first.length + 300,
		})

		expect(result.sections[0]).toBe(first)
		expect(result.sections[1]).toBe(section("b.ts", definitions.substring(0, 200) + "\n... (truncated)"))
		expect(result).toMatchObject({ filesProcessed: 2, filesSkipped: 1 })
		expect(result.characterCount).toBeLessThanOrEqual(first.length + 300)
	})

	it("stops without truncating when less than 200 characters of budget remain", async () => {
		const definitions = "1--3 | " + "x".repeat(300)
		parse.mockResolvedValue(definitions)
		const first = section("a.ts", definitions)

		const result = await generateFoldedFileContext(["a.ts", "b.ts", "c.ts"], {
			cwd: "/test",
			maxCharacters: first.length + 199,
		})

		expect(result.sections).toEqual([first])
		expect(result).toMatchObject({ filesProcessed: 1, filesSkipped: 2 })
	})
})

describe("summarizeConversation with the files the task read", () => {
	const handler = {
		createMessage: () =>
			(async function* () {
				yield { type: "text" as const, text: "Mock summary" }
			})(),
		countTokens: async () => 0,
		getModel: () => ({ id: "test-model", info: { contextWindow: 100000 } }),
	} as unknown as ApiHandler

	const messages: ApiMessage[] = Array.from({ length: 5 }, (_, i) => ({
		role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
		content: `message ${i}`,
	}))

	const summaryTexts = async (options: { filesReadByRoo?: string[]; cwd?: string }) => {
		const result = await summarizeConversation({
			messages,
			apiHandler: handler,
			systemPrompt: "sys",
			taskId: "t",
			...options,
		})
		return (result.messages.find((m) => m.isSummary)!.content as { text: string }[]).map((b) => b.text)
	}

	beforeEach(() => {
		vi.clearAllMocks()
		vi.spyOn(logger, "error").mockImplementation(() => {})
	})
	afterEach(() => vi.restoreAllMocks())

	it("adds one block per folded file after the summary", async () => {
		parse.mockResolvedValueOnce("1--5 | export interface User").mockResolvedValueOnce("1--3 | fetchData")

		const texts = await summaryTexts({ filesReadByRoo: ["src/user.ts", "src/api.ts"], cwd: "/project" })

		expect(texts).toEqual([
			"## Conversation Summary\nMock summary",
			section("src/user.ts", "1--5 | export interface User"),
			section("src/api.ts", "1--3 | fetchData"),
		])
	})

	it.each<[string, { filesReadByRoo?: string[]; cwd?: string }]>([
		["no files were read", { filesReadByRoo: [], cwd: "/project" }],
		["there is no cwd", { filesReadByRoo: ["src/user.ts"] }],
	])("adds no file blocks when %s", async (_label, options) => {
		expect(await summaryTexts(options)).toEqual(["## Conversation Summary\nMock summary"])
		expect(parse).not.toHaveBeenCalled()
	})
})
