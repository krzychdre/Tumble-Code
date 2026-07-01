import {
	selectRelevantMemories,
	parseSelectedMemories,
	collectRecentSuccessfulTools,
	findRelevantMemories,
	type SideQuery,
	type RecentToolMessageView,
} from "../relevance"
import { initMemoryPaths, resetMemoryPaths } from "../paths"
import { scanMemoryFiles } from "../memoryScan"
import * as surfacing from "../surfacing"

describe("relevance", () => {
	describe("parseSelectedMemories", () => {
		it("parses a clean JSON object", () => {
			expect(parseSelectedMemories('{"selected_memories":["a.md","b.md"]}')).toEqual(["a.md", "b.md"])
		})

		it("strips a ```json fence", () => {
			expect(parseSelectedMemories('```json\n{"selected_memories":["a.md"]}\n```')).toEqual(["a.md"])
		})

		it("extracts the {...} block from surrounding prose", () => {
			expect(parseSelectedMemories('Here you go: {"selected_memories":["x.md"]} thanks')).toEqual(["x.md"])
		})

		it("returns null for non-JSON / missing array", () => {
			expect(parseSelectedMemories("no json here")).toBeNull()
			expect(parseSelectedMemories('{"foo":"bar"}')).toBeNull()
			expect(parseSelectedMemories('{"selected_memories":"not-an-array"}')).toBeNull()
		})

		it("filters non-string entries from the array", () => {
			expect(parseSelectedMemories('{"selected_memories":["a.md", 42, null, "b.md"]}')).toEqual(["a.md", "b.md"])
		})
	})

	describe("selectRelevantMemories", () => {
		const memories = [
			{
				filename: "user_role.md",
				filePath: "/mem/user_role.md",
				mtimeMs: 1,
				description: "d1",
				type: "user" as const,
			},
			{
				filename: "feedback.md",
				filePath: "/mem/feedback.md",
				mtimeMs: 2,
				description: "d2",
				type: "feedback" as const,
			},
		]

		it("returns the intersection of model selection and valid filenames", async () => {
			const sideQuery: SideQuery = vi.fn(async () => '{"selected_memories":["user_role.md","ghost.md"]}')
			const result = await selectRelevantMemories("q", memories, new AbortController().signal, [], sideQuery)
			expect(result).toEqual(["user_role.md"]) // ghost.md filtered out
		})

		it("returns [] on abort", async () => {
			const sideQuery: SideQuery = vi.fn(async () => {
				throw new Error("aborted")
			})
			const controller = new AbortController()
			controller.abort()
			const result = await selectRelevantMemories("q", memories, controller.signal, [], sideQuery)
			expect(result).toEqual([])
		})

		it("returns [] when the model returns no memories", async () => {
			const sideQuery: SideQuery = vi.fn(async () => '{"selected_memories":[]}')
			const result = await selectRelevantMemories("q", memories, new AbortController().signal, [], sideQuery)
			expect(result).toEqual([])
		})
	})

	describe("collectRecentSuccessfulTools", () => {
		it("collects tools that succeeded since the last user message", () => {
			const messages: RecentToolMessageView[] = [
				{ type: "user" }, // previous human turn (stop boundary)
				{ type: "assistant", toolUses: [{ id: "1", name: "read_file" }] },
				{ type: "user", toolResults: [{ tool_use_id: "1", is_error: false }] },
				{ type: "assistant", toolUses: [{ id: "2", name: "search_files" }] },
				{ type: "user", toolResults: [{ tool_use_id: "2", is_error: false }] },
				{ type: "user" }, // the last user message (index 5)
			]
			// lastUserMessageIndex = 5
			expect([...collectRecentSuccessfulTools(messages, 5)].sort()).toEqual(["read_file", "search_files"])
		})

		it("'any error → excluded': a tool that errored even once is NOT in the result", () => {
			const messages: RecentToolMessageView[] = [
				{
					type: "assistant",
					toolUses: [
						{ id: "1", name: "read_file" },
						{ id: "2", name: "read_file" },
					],
				},
				{
					type: "user",
					toolResults: [
						{ tool_use_id: "1", is_error: false },
						{ tool_use_id: "2", is_error: true },
					],
				},
				{ type: "user" },
			]
			// read_file errored once → excluded entirely.
			expect(collectRecentSuccessfulTools(messages, 2)).toEqual([])
		})

		it("'no result yet → excluded': outcome unknown", () => {
			const messages: RecentToolMessageView[] = [
				{ type: "assistant", toolUses: [{ id: "1", name: "read_file" }] },
				// no matching tool_result yet
				{ type: "user" },
			]
			expect(collectRecentSuccessfulTools(messages, 1)).toEqual([])
		})

		it("stops at the previous human turn", () => {
			const messages: RecentToolMessageView[] = [
				{ type: "assistant", toolUses: [{ id: "old", name: "execute_command" }] },
				{ type: "user", toolResults: [{ tool_use_id: "old", is_error: false }] },
				{ type: "user" }, // previous human turn (index 2) — anything before is out of scope
				{ type: "assistant", toolUses: [{ id: "new", name: "read_file" }] },
				{ type: "user", toolResults: [{ tool_use_id: "new", is_error: false }] },
				{ type: "user" }, // last user message (index 5)
			]
			const result = collectRecentSuccessfulTools(messages, 5)
			expect(result).toEqual(["read_file"])
			expect(result).not.toContain("execute_command")
		})
	})

	describe("findRelevantMemories", () => {
		let tmpBase: string
		const cwd = "/fake/cwd"

		beforeEach(async () => {
			const fs = await import("fs/promises")
			const os = await import("os")
			const path = await import("path")
			tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "roo-rel-"))
			initMemoryPaths(tmpBase, () => ({}))
			const memDir = path.join(tmpBase, "memory", "projects", "_fake_cwd", "memory")
			await fs.mkdir(memDir, { recursive: true })
			await fs.writeFile(
				path.join(memDir, "user_role.md"),
				"---\nname: Role\ndescription: backend engineer\ntype: user\n---\nbody",
			)
		})

		afterEach(async () => {
			resetMemoryPaths()
			const fs = await import("fs/promises")
			await fs.rm(tmpBase, { recursive: true, force: true })
		})

		it("returns [] for an empty memory dir (scan yields no headers)", async () => {
			// Point at a different cwd with no memory files.
			const result = await findRelevantMemories(
				"q",
				"/nonexistent/cwd",
				new AbortController().signal,
				[],
				new Set(),
				vi.fn(async () => '{"selected_memories":[]}'),
			)
			expect(result).toEqual([])
		})

		it("filters out already-surfaced paths before ranking", async () => {
			const memDir = await scanMemoryFiles(
				// scan the seeded dir
				`${tmpBase}/memory/projects/_fake_cwd/memory`,
			)
			const already = new Set(memDir.map((m) => m.filePath))
			const result = await findRelevantMemories(
				"q",
				`${tmpBase}/memory/projects/_fake_cwd/memory`,
				new AbortController().signal,
				[],
				already,
				vi.fn(async () => '{"selected_memories":["user_role.md"]}'),
			)
			// alreadySurfaced filters the only candidate → empty.
			expect(result).toEqual([])
		})
	})
})
