import fs from "fs/promises"
import os from "os"
import path from "path"

import {
	executeExtractMemories,
	drainPendingExtraction,
	hasMemoryWritesSince,
	resetExtractionState,
	parseMemoryDrafts,
	_inFlightExtractionsCount,
	_cursorKeys,
} from "../extractMemories"
import { initMemoryPaths, resetMemoryPaths, getAutoMemPath } from "../paths"
import { getReadablePath } from "../../../utils/path"

/**
 * A file-write tool ask exactly as it lands in `task.clineMessages`: the write
 * tools (write_to_file, apply_diff, edit, search_replace, edit_file,
 * apply_patch) ask for approval with `type: "ask"`, `ask: "tool"` and a JSON
 * `text` whose `path` is `getReadablePath(cwd, relPath)`. `isAnswered` is set
 * once the ask is approved (auto-approval or the user's Save click); a
 * rejected ask keeps it unset.
 */
function writeAsk(
	cwd: string,
	absPath: string,
	opts: { tool?: string; partial?: boolean; isAnswered?: boolean } = {},
): Record<string, unknown> {
	return {
		ts: Date.now(),
		type: "ask",
		ask: "tool",
		text: JSON.stringify({
			tool: opts.tool ?? "newFileCreated",
			path: getReadablePath(cwd, absPath),
			content: "---\nname: x\n---\nbody",
			isOutsideWorkspace: true,
		}),
		partial: opts.partial ?? false,
		isAnswered: "isAnswered" in opts ? opts.isAnswered : true,
	}
}

describe("extractMemories", () => {
	let tmpBase: string
	const cwd = "/fake/cwd"

	beforeEach(async () => {
		tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "roo-extract-"))
		initMemoryPaths(tmpBase, () => ({}))
		// Pre-create the memory dir so scanMemoryFiles doesn't no-op on ENOENT.
		await fs.mkdir(getAutoMemPath(cwd), { recursive: true })
		resetExtractionState()
	})

	afterEach(async () => {
		resetExtractionState()
		resetMemoryPaths()
		await fs.rm(tmpBase, { recursive: true, force: true })
	})

	describe("hasMemoryWritesSince", () => {
		it.each(["newFileCreated", "editedExistingFile", "appliedDiff"])(
			"returns true for an approved %s ask into the memory dir",
			(tool) => {
				const memDir = getAutoMemPath(cwd)
				const messages = [writeAsk(cwd, path.join(memDir, "x.md"), { tool })]
				expect(hasMemoryWritesSince(messages as any, cwd, 0)).toBe(true)
			},
		)

		it("resolves a cwd-relative readable path (memory dir inside the workspace)", () => {
			// getReadablePath stores a path inside the workspace relative to cwd
			// with POSIX separators. The memory base lives under tmpBase, so with
			// cwd = tmpBase the memory dir is inside the workspace.
			const workspace = path.resolve(tmpBase)
			const file = path.join(getAutoMemPath(workspace), "user.md")
			const relative = path.relative(workspace, file).split(path.sep).join("/")
			expect(path.isAbsolute(relative)).toBe(false)
			const message = {
				ts: 1,
				type: "ask",
				ask: "tool",
				text: JSON.stringify({ tool: "newFileCreated", path: relative, content: "x" }),
				partial: false,
				isAnswered: true,
			}
			expect(hasMemoryWritesSince([message] as any, workspace, 0)).toBe(true)
		})

		it("detects writes into the directory shared with Claude Code", () => {
			const claudeDir = path.join(tmpBase, "claude-config")
			vi.stubEnv("CLAUDE_CONFIG_DIR", claudeDir)
			try {
				resetMemoryPaths()
				initMemoryPaths(tmpBase, () => ({ autoMemoryShareWithClaudeCode: true }))
				const memDir = getAutoMemPath(cwd)
				expect(memDir.startsWith(path.join(claudeDir, "projects"))).toBe(true)
				const messages = [writeAsk(cwd, path.join(memDir, "feedback.md"), { tool: "appliedDiff" })]
				expect(hasMemoryWritesSince(messages as any, cwd, 0)).toBe(true)
			} finally {
				vi.unstubAllEnvs()
			}
		})

		it("returns false for writes outside the memory dir", () => {
			const messages = [writeAsk(cwd, path.resolve(cwd, "src", "foo.ts"), { tool: "editedExistingFile" })]
			expect(hasMemoryWritesSince(messages as any, cwd, 0)).toBe(false)
		})

		it("ignores a rejected ask (never answered) into the memory dir", () => {
			const memDir = getAutoMemPath(cwd)
			const messages = [writeAsk(cwd, path.join(memDir, "x.md"), { isAnswered: undefined })]
			expect(hasMemoryWritesSince(messages as any, cwd, 0)).toBe(false)
		})

		it("ignores a partial (still streaming) ask into the memory dir", () => {
			const memDir = getAutoMemPath(cwd)
			const messages = [writeAsk(cwd, path.join(memDir, "x.md"), { tool: "appliedDiff", partial: true })]
			expect(hasMemoryWritesSince(messages as any, cwd, 0)).toBe(false)
		})

		it("ignores non-write tool asks (a read of a memory file is not a write)", () => {
			const memDir = getAutoMemPath(cwd)
			const read = writeAsk(cwd, path.join(memDir, "x.md"), { tool: "readFile" })
			expect(hasMemoryWritesSince([read] as any, cwd, 0)).toBe(false)
		})

		it("only looks at messages from the cursor on", () => {
			const memDir = getAutoMemPath(cwd)
			const messages = [
				writeAsk(cwd, path.join(memDir, "x.md")),
				{ ts: 2, type: "say", say: "text", text: "done" },
			]
			expect(hasMemoryWritesSince(messages as any, cwd, 0)).toBe(true)
			expect(hasMemoryWritesSince(messages as any, cwd, 1)).toBe(false)
		})

		it("tolerates messages without text or with non-JSON text", () => {
			const messages = [
				{ ts: 1, type: "ask", ask: "tool", isAnswered: true },
				{ ts: 2, type: "ask", ask: "tool", text: "not json", isAnswered: true },
				{ ts: 3, type: "ask", ask: "tool", text: "null", isAnswered: true },
			]
			expect(hasMemoryWritesSince(messages as any, cwd, 0)).toBe(false)
			expect(hasMemoryWritesSince([] as any, cwd, 0)).toBe(false)
		})
	})

	describe("executeExtractMemories", () => {
		it("skips for sub-agents (isMainAgent=false)", async () => {
			const runner = vi.fn(async () => "NONE")
			await executeExtractMemories({
				cwd,
				isMainAgent: false,
				taskId: "a",
				messages: [{ type: "say", text: "hi" }],
				transcript: "User: hi",
				query: runner,
			})
			expect(runner).not.toHaveBeenCalled()
		})

		it("skips when the main agent already wrote a memory (mutual exclusion)", async () => {
			const memDir = getAutoMemPath(cwd)
			const runner = vi.fn(async () => "NONE")
			const messages = [writeAsk(cwd, path.join(memDir, "user.md"))]
			await executeExtractMemories({
				cwd,
				isMainAgent: true,
				taskId: "a",
				messages: messages as any,
				transcript: "User: hi",
				query: runner,
			})
			expect(runner).not.toHaveBeenCalled() // skipped due to direct write
		})

		it("writes a new memory file and its index line from the model's answer", async () => {
			const memDir = getAutoMemPath(cwd)
			const runner = vi.fn(
				async () =>
					"## feedback: real_db_in_tests\nIntegration tests must use a real database.\nWhy: mocks hid a broken migration.",
			)
			let saved = 0
			let savedPaths: string[] = []
			await executeExtractMemories({
				cwd,
				isMainAgent: true,
				taskId: "a",
				messages: [{ type: "say", text: "hi" }] as any,
				transcript: "User: never mock the database in tests",
				query: runner,
				onSaved: (n, p) => {
					saved = n
					savedPaths = p
				},
			})
			await drainPendingExtraction(1000)
			const file = path.join(memDir, "feedback_real_db_in_tests.md")
			expect(saved).toBe(1)
			expect(savedPaths).toEqual([file])
			const content = await fs.readFile(file, "utf-8")
			expect(content).toContain("description: Integration tests must use a real database.")
			expect(content).toContain("type: feedback")
			expect(content).toContain("Why: mocks hid a broken migration.")
			const index = await fs.readFile(path.join(memDir, "MEMORY.md"), "utf-8")
			expect(index).toContain("(feedback_real_db_in_tests.md)")
		})

		it("appends to an existing memory the answer names instead of creating a duplicate", async () => {
			const memDir = getAutoMemPath(cwd)
			const existing = path.join(memDir, "user_role.md")
			await fs.writeFile(existing, "---\nname: user_role\ndescription: Backend engineer\ntype: user\n---\n\nWrites Go.\n")
			const runner = vi.fn(async () => "## user: user_role.md\nAlso maintains the Kotlin plugins.")
			await executeExtractMemories({
				cwd,
				isMainAgent: true,
				taskId: "a",
				messages: [{ type: "say", text: "hi" }] as any,
				transcript: "User: I also maintain the Kotlin plugins",
				query: runner,
			})
			await drainPendingExtraction(1000)
			const content = await fs.readFile(existing, "utf-8")
			expect(content).toContain("Writes Go.")
			expect(content).toMatch(/Update \d{4}-\d{2}-\d{2}: Also maintains the Kotlin plugins\./)
			expect((await fs.readdir(memDir)).filter((f) => f.endsWith(".md"))).toEqual(["user_role.md"])
		})

		it("asks one small prompt: the instruction, the manifest and the transcript, nothing else", async () => {
			const memDir = getAutoMemPath(cwd)
			await fs.writeFile(path.join(memDir, "user_role.md"), "---\ndescription: Backend engineer\ntype: user\n---\nbody\n")
			const runner = vi.fn(async (_system: string, _user: string, _signal: AbortSignal) => "NONE")
			await executeExtractMemories({
				cwd,
				isMainAgent: true,
				taskId: "a",
				messages: [{ type: "say", text: "hi" }] as any,
				transcript: "User: remember my name is Ada\n\nAssistant: noted",
				query: runner,
			})
			await drainPendingExtraction(1000)
			expect(runner).toHaveBeenCalledTimes(1)
			const [system, user] = runner.mock.calls[0]
			expect(system).toContain("NONE")
			expect(user).toContain("- user_role.md: Backend engineer")
			expect(user).toContain("remember my name is Ada")
			expect(system.length + user.length).toBeLessThan(3000)
			expect(await fs.readdir(memDir)).toEqual(["user_role.md"]) // NONE writes nothing
		})

		it("makes no model call when the transcript holds no user prose", async () => {
			const runner = vi.fn(async () => "NONE")
			await executeExtractMemories({
				cwd,
				isMainAgent: true,
				taskId: "a",
				messages: [{ type: "say", text: "hi" }] as any,
				transcript: "",
				query: runner,
			})
			expect(runner).not.toHaveBeenCalled()
		})

		it("per-task cursor: short task after long task still extracts (regression)", async () => {
			const runner = vi.fn(async () => "NONE")
			// Task "a" with 60 messages extracts successfully (cursor → 60).
			const longMessages = Array.from({ length: 60 }, () => ({ toolUses: [{ name: "read_file" }] }))
			await executeExtractMemories({
				cwd,
				isMainAgent: true,
				taskId: "a",
				messages: longMessages as any,
				transcript: "User: hi",
				query: runner,
			})
			expect(runner).toHaveBeenCalledTimes(1)
			// Task "b" with 25 messages — old code computed 25 − 60 ≤ 0 and skipped.
			const shortMessages = Array.from({ length: 25 }, () => ({ toolUses: [{ name: "read_file" }] }))
			await executeExtractMemories({
				cwd,
				isMainAgent: true,
				taskId: "b",
				messages: shortMessages as any,
				transcript: "User: hi",
				query: runner,
			})
			expect(runner).toHaveBeenCalledTimes(2)
		})

		it("same-task double-fire: second call with unchanged messages early-returns", async () => {
			const runner = vi.fn(async () => "NONE")
			const messages = [{ toolUses: [{ name: "read_file" }] }]
			await executeExtractMemories({
				cwd,
				isMainAgent: true,
				taskId: "a",
				messages: messages as any,
				transcript: "User: hi",
				query: runner,
			})
			await executeExtractMemories({
				cwd,
				isMainAgent: true,
				taskId: "a",
				messages: messages as any,
				transcript: "User: hi",
				query: runner,
			})
			expect(runner).toHaveBeenCalledTimes(1)
		})

		it("mutual-exclusion advance is per-task: advancing task a does not block task b", async () => {
			const memDir = getAutoMemPath(cwd)
			const runner = vi.fn(async () => "NONE")
			// Task "a" wrote a memory directly → cursor advances, runner not called.
			const messagesA = [writeAsk(cwd, path.join(memDir, "user.md"))]
			await executeExtractMemories({
				cwd,
				isMainAgent: true,
				taskId: "a",
				messages: messagesA as any,
				transcript: "User: hi",
				query: runner,
			})
			expect(runner).not.toHaveBeenCalled()
			// Task "b" has no direct writes → still extracts.
			const messagesB = [{ toolUses: [{ name: "read_file" }] }]
			await executeExtractMemories({
				cwd,
				isMainAgent: true,
				taskId: "b",
				messages: messagesB as any,
				transcript: "User: hi",
				query: runner,
			})
			expect(runner).toHaveBeenCalledTimes(1)
		})

		it("cursor snapshots message length at T0, not T1 (messages added mid-run are not skipped)", async () => {
			// Use a live array that gets a message appended mid-run.
			const messages: any[] = [{ toolUses: [{ name: "read_file" }] }]
			const lengthBefore = messages.length
			const runner = vi.fn(async () => {
				// Simulate a message arriving while the sub-task runs.
				messages.push({ toolUses: [{ name: "read_file" }] })
				return "NONE"
			})
			await executeExtractMemories({
				cwd,
				isMainAgent: true,
				taskId: "cursor-snap",
				messages: messages as any,
				transcript: "User: hi",
				query: runner,
			})
			// The cursor should be the PRE-run length (1), not the post-run length (2).
			// Re-invoke with the same messages — if cursor was set to 2, newMessageCount
			// would be 0 and the runner would NOT be called. If cursor was set to 1,
			// newMessageCount is 1 and the runner IS called.
			const runner2 = vi.fn(async () => "NONE")
			await executeExtractMemories({
				cwd,
				isMainAgent: true,
				taskId: "cursor-snap",
				messages: messages as any,
				transcript: "User: hi",
				query: runner2,
			})
			expect(runner2).toHaveBeenCalledTimes(1)
			expect(lengthBefore).toBe(1)
			expect(messages.length).toBe(2)
		})

		it("LRU eviction: recently-read cursor survives when newer cursors fill the map", async () => {
			const runner = vi.fn(async () => "NONE")
			// Task "A" with 10 messages extracts successfully (cursor → 10).
			const messagesA = Array.from({ length: 10 }, () => ({ toolUses: [{ name: "read_file" }] }))
			await executeExtractMemories({
				cwd,
				isMainAgent: true,
				taskId: "A",
				messages: messagesA as any,
				transcript: "User: hi",
				query: runner,
			})
			expect(runner).toHaveBeenCalledTimes(1)

			// Task "B" with 1 message extracts (cursor → 1). Now B is more recent than A.
			await executeExtractMemories({
				cwd,
				isMainAgent: true,
				taskId: "B",
				messages: [{ toolUses: [{ name: "read_file" }] }] as any,
				transcript: "User: hi",
				query: runner,
			})

			// Touch/READ A's cursor by running another extraction for A (messages
			// unchanged → early-returns, but getCursor refreshes recency).
			// After this, A is the MRU and B is the LRU.
			await executeExtractMemories({
				cwd,
				isMainAgent: true,
				taskId: "A",
				messages: messagesA as any,
				transcript: "User: hi",
				query: runner,
			})

			// Fill the map to capacity: A + B + 62 others = 64 entries.
			for (let i = 0; i < 62; i++) {
				await executeExtractMemories({
					cwd,
					isMainAgent: true,
					taskId: `other-${i}`,
					messages: [{ toolUses: [{ name: "read_file" }] }] as any,
					transcript: "User: hi",
					query: runner,
				})
			}
			// Map is now full (64). A was touched after B, so B is the LRU.
			// Add one more → eviction. LRU evicts B; FIFO evicts A.
			await executeExtractMemories({
				cwd,
				isMainAgent: true,
				taskId: "overflow",
				messages: [{ toolUses: [{ name: "read_file" }] }] as any,
				transcript: "User: hi",
				query: runner,
			})

			// A's cursor must have SURVIVED — it was recently read (LRU), so B
			// (the true LRU) was evicted instead. Pre-fix (FIFO), A was evicted
			// because it was inserted first despite the recent read.
			expect(_cursorKeys()).toContain("A")
			expect(_cursorKeys()).not.toContain("B")
		})
	})

	describe("parseMemoryDrafts", () => {
		it("returns nothing for NONE or plain prose", () => {
			expect(parseMemoryDrafts("NONE")).toEqual([])
			expect(parseMemoryDrafts("Nothing in this chat is worth saving.")).toEqual([])
		})

		it("reads blocks behind a <think> section and inside a code fence, with bold headers", () => {
			const answer = [
				"<think>The user said to use pnpm.</think>",
				"```",
				"**feedback: pnpm_only**",
				"Use pnpm, never npm, in this repo.",
				"Why: the lockfile is pnpm-lock.yaml.",
				"### Project: Release freeze",
				"description: Merge freeze until 2026-10-01",
				"```",
			].join("\n")
			expect(parseMemoryDrafts(answer)).toEqual([
				{
					type: "feedback",
					name: "pnpm_only",
					description: "Use pnpm, never npm, in this repo.",
					body: "Why: the lockfile is pnpm-lock.yaml.",
				},
				{
					type: "project",
					name: "Release freeze",
					description: "Merge freeze until 2026-10-01",
					body: "Merge freeze until 2026-10-01",
				},
			])
		})

		it("ignores unknown types, unprefixed look-alike lines and blocks past the cap", () => {
			const block = (n: number) => `## user: note_${n}\nfact ${n}\nproject: not a header`
			const drafts = parseMemoryDrafts(["## opinion: x\nskip me", block(1), block(2), block(3), block(4)].join("\n"))
			expect(drafts.map((d) => d.name)).toEqual(["note_1", "note_2", "note_3"])
			expect(drafts[0].body).toBe("project: not a header")
		})
	})

	describe("drainPendingExtraction", () => {
		it("resolves immediately when nothing is in flight", async () => {
			await expect(drainPendingExtraction(1000)).resolves.toBeUndefined()
		})

		it("aborts in-flight controllers when the timeout fires", async () => {
			let aborted = false
			// Runner that never resolves on its own — only the abort signal can end it.
			const runner = vi.fn(
				(_system: string, _user: string, signal: AbortSignal) =>
					new Promise<string>((_resolve, reject) => {
						signal.addEventListener("abort", () => {
							aborted = true
							reject(new Error("aborted"))
						})
					}),
			)
			void executeExtractMemories({
				cwd,
				isMainAgent: true,
				taskId: "a",
				messages: [{ toolUses: [{ name: "read_file" }] }] as any,
				transcript: "User: hi",
				query: runner,
			})
			// Give the extraction a tick to register the controller.
			await new Promise((r) => setTimeout(r, 10))
			await drainPendingExtraction(20)
			expect(aborted).toBe(true)
		})

		it("does not abort when extractions complete before the timeout", async () => {
			let aborted = false
			const runner = vi.fn(async (_system: string, _user: string, signal: AbortSignal) => {
				signal.addEventListener("abort", () => {
					aborted = true
				})
				return "NONE"
			})
			void executeExtractMemories({
				cwd,
				isMainAgent: true,
				taskId: "a",
				messages: [{ toolUses: [{ name: "read_file" }] }] as any,
				transcript: "User: hi",
				query: runner,
			})
			// Wait long enough for the runner to resolve naturally.
			await new Promise((r) => setTimeout(r, 50))
			await drainPendingExtraction(1000)
			expect(aborted).toBe(false)
		})

		it("awaited post-abort settle: registry is empty when drain returns (abort-responsive work)", async () => {
			// Runner that resolves ONLY when its abort signal fires — simulating
			// abort-responsive work. Pre-fix the drain returned while the registry
			// was still non-empty (the finally cleanup hadn't run yet).
			const runner = vi.fn(
				(_system: string, _user: string, signal: AbortSignal) =>
					new Promise<string>((_resolve, reject) => {
						signal.addEventListener("abort", () => {
							reject(new Error("aborted"))
						})
					}),
			)
			void executeExtractMemories({
				cwd,
				isMainAgent: true,
				taskId: "a",
				messages: [{ toolUses: [{ name: "read_file" }] }] as any,
				transcript: "User: hi",
				query: runner,
			})
			// Give the extraction a tick to register the controller.
			await new Promise((r) => setTimeout(r, 10))
			expect(_inFlightExtractionsCount()).toBe(1)

			// Main timeout (20ms) fires → abort → grace period lets it settle.
			await drainPendingExtraction(20)

			// Post-fix: the grace await gives the finally block time to run,
			// so the registry is empty when drain returns.
			expect(_inFlightExtractionsCount()).toBe(0)
		})

		it("never hangs forever: drain returns even if a promise never settles after abort", async () => {
			// Runner that NEVER settles — not even on abort. The drain must
			// still return after main-timeout + grace (it must not hang).
			const runner = vi.fn(
				(_system: string, _user: string, _signal: AbortSignal) =>
					new Promise<string>(() => {
						// intentionally never resolves or rejects
					}),
			)
			void executeExtractMemories({
				cwd,
				isMainAgent: true,
				taskId: "a",
				messages: [{ toolUses: [{ name: "read_file" }] }] as any,
				transcript: "User: hi",
				query: runner,
			})
			// Give the extraction a tick to register.
			await new Promise((r) => setTimeout(r, 10))

			// Use short real timeouts to keep the test fast: 20ms main + 50ms grace.
			const start = Date.now()
			await drainPendingExtraction(20, 50)
			const elapsed = Date.now() - start
			// Drain returned — it didn't hang. Elapsed should be roughly
			// main-timeout + grace (within a generous tolerance).
			expect(elapsed).toBeGreaterThanOrEqual(20)
			expect(elapsed).toBeLessThan(500)
		})
	})
})
