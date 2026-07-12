import fs from "fs/promises"
import os from "os"
import path from "path"

import { startRelevantMemoryPrefetch, type PrefetchMessage } from "../prefetch"
import { initMemoryPaths, resetMemoryPaths, getAutoMemPath } from "../paths"
import { MAX_SESSION_BYTES } from "../surfacing"

describe("startRelevantMemoryPrefetch", () => {
	let tmpBase: string
	const cwd = "/fake/cwd"
	const sideQuery = vi.fn(async () => '{"selected_memories":[]}')

	beforeEach(async () => {
		tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "roo-prefetch-"))
		initMemoryPaths(tmpBase, () => ({}))
		// Create the memory dir so the scan inside the prefetch doesn't no-op.
		await fs.mkdir(getAutoMemPath(cwd), { recursive: true })
		await fs.writeFile(
			path.join(getAutoMemPath(cwd), "user.md"),
			"---\nname: U\ndescription: d\ntype: user\n---\nbody",
		)
		sideQuery.mockClear()
	})

	afterEach(async () => {
		resetMemoryPaths()
		await fs.rm(tmpBase, { recursive: true, force: true })
	})

	const ctx = (opts?: { recallEnabled?: boolean; parent?: AbortController }) => ({
		cwd,
		recallEnabled: opts?.recallEnabled ?? true,
		readFileState: new Map(),
		sideQuery,
		parentAbortController: opts?.parent,
	})

	it("returns undefined when recall is disabled", () => {
		const handle = startRelevantMemoryPrefetch(
			[{ type: "user", text: "multi word prompt" }],
			ctx({ recallEnabled: false }),
		)
		expect(handle).toBeUndefined()
	})

	it("returns undefined for a single-word prompt", () => {
		const handle = startRelevantMemoryPrefetch([{ type: "user", text: "hi" }], ctx())
		expect(handle).toBeUndefined()
	})

	it("returns undefined when there is no user message", () => {
		const handle = startRelevantMemoryPrefetch([], ctx())
		expect(handle).toBeUndefined()
	})

	it("returns undefined when the session byte cap is already reached", () => {
		// Build messages that already surfaced MAX_SESSION_BYTES.
		const big = "x".repeat(MAX_SESSION_BYTES + 1)
		const messages: PrefetchMessage[] = [
			{
				type: "attachment",
				attachment: {
					type: "relevant_memories",
					memories: [{ path: "/a.md", content: big, mtimeMs: 0, header: "h" } as any],
				},
			},
			{ type: "user", text: "another multi word prompt" },
		]
		const handle = startRelevantMemoryPrefetch(messages, ctx())
		expect(handle).toBeUndefined()
	})

	it("returns a handle for a normal multi-word prompt", () => {
		const handle = startRelevantMemoryPrefetch([{ type: "user", text: "fix the database tests" }], ctx())
		expect(handle).toBeDefined()
		expect(handle?.settledAt).toBeNull()
		expect(handle?.consumedOnIteration).toBe(-1)
	})

	it("the handle's promise resolves to an array (never rejects)", async () => {
		const handle = startRelevantMemoryPrefetch([{ type: "user", text: "fix the database tests" }], ctx())
		expect(handle).toBeDefined()
		const result = await handle!.promise
		expect(Array.isArray(result)).toBe(true)
	})

	it("dispose aborts the in-flight query", async () => {
		const handle = startRelevantMemoryPrefetch([{ type: "user", text: "fix the database tests" }], ctx())
		expect(handle).toBeDefined()
		handle!.dispose()
		// The promise still resolves (to []) due to the .catch in the prefetch.
		await expect(handle!.promise).resolves.toEqual([])
	})

	it("chains abort to the parent controller", () => {
		const parent = new AbortController()
		const handle = startRelevantMemoryPrefetch([{ type: "user", text: "fix the database tests" }], ctx({ parent }))
		expect(handle).toBeDefined()
		parent.abort()
		// Disposing after parent abort is idempotent.
		expect(() => handle!.dispose()).not.toThrow()
	})
})
