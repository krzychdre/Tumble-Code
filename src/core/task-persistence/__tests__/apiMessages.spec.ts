// cd src && npx vitest run core/task-persistence/__tests__/apiMessages.spec.ts

import * as os from "os"
import * as path from "path"
import * as fs from "fs/promises"

import { readApiMessages } from "../apiMessages"

// Lets a test make every JSON write of the migration fail (for example a full disk), while all other behavior of
// the real module (locking, atomic rename) stays in place.
const writeControl = vi.hoisted(() => ({ failWrites: false }))

vi.mock("@roo-code/core/fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@roo-code/core/fs")>()
	const simulatedFailure = () => Promise.reject(new Error("simulated write failure"))
	return {
		...actual,
		safeWriteJson: (...args: Parameters<typeof actual.safeWriteJson>) =>
			writeControl.failWrites ? simulatedFailure() : actual.safeWriteJson(...args),
		withLockedJsonTransaction: <T>(
			lockTargetPath: string,
			destinationPath: string,
			transaction: (writeJson: import("@roo-code/core/fs").LockedJsonWriter) => Promise<T>,
		) =>
			actual.withLockedJsonTransaction(lockTargetPath, destinationPath, (writeJson) =>
				transaction(writeControl.failWrites ? simulatedFailure : writeJson),
			),
	}
})

let tmpBaseDir: string

async function listCorruptCopies(dir: string, fileName: string): Promise<string[]> {
	return (await fs.readdir(dir)).filter((name) => name.startsWith(`${fileName}.corrupt-`))
}

beforeEach(async () => {
	writeControl.failWrites = false
	tmpBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), "roo-test-api-"))
})

describe("apiMessages.readApiMessages", () => {
	it("returns empty array when api_conversation_history.json contains invalid JSON", async () => {
		const taskId = "task-corrupt-api"
		const taskDir = path.join(tmpBaseDir, "tasks", taskId)
		await fs.mkdir(taskDir, { recursive: true })
		const filePath = path.join(taskDir, "api_conversation_history.json")
		await fs.writeFile(filePath, "<<<corrupt data>>>", "utf8")

		const result = await readApiMessages({
			taskId,
			globalStoragePath: tmpBaseDir,
		})

		expect(result).toEqual([])
	})

	// Regression (R1): the task saves its new history over this path next, so the damaged file must be moved
	// aside first, keeping the original bytes for recovery.
	it("moves an unparseable api_conversation_history.json aside instead of leaving it to be overwritten", async () => {
		const taskId = "task-corrupt-api-quarantine"
		const taskDir = path.join(tmpBaseDir, "tasks", taskId)
		await fs.mkdir(taskDir, { recursive: true })
		const filePath = path.join(taskDir, "api_conversation_history.json")
		await fs.writeFile(filePath, '[{"role":"user","content":"trunc', "utf8")

		await readApiMessages({ taskId, globalStoragePath: tmpBaseDir })

		await expect(fs.access(filePath)).rejects.toThrow()
		const copies = await listCorruptCopies(taskDir, "api_conversation_history.json")
		expect(copies).toHaveLength(1)
		expect(await fs.readFile(path.join(taskDir, copies[0]), "utf8")).toBe('[{"role":"user","content":"trunc')
	})

	it("moves a non-array api_conversation_history.json aside", async () => {
		const taskId = "task-non-array-api-quarantine"
		const taskDir = path.join(tmpBaseDir, "tasks", taskId)
		await fs.mkdir(taskDir, { recursive: true })
		await fs.writeFile(path.join(taskDir, "api_conversation_history.json"), '{"a":1}', "utf8")

		expect(await readApiMessages({ taskId, globalStoragePath: tmpBaseDir })).toEqual([])
		expect(await listCorruptCopies(taskDir, "api_conversation_history.json")).toHaveLength(1)
	})

	it("leaves a valid api_conversation_history.json in place", async () => {
		const taskId = "task-valid-api"
		const taskDir = path.join(tmpBaseDir, "tasks", taskId)
		await fs.mkdir(taskDir, { recursive: true })
		const messages = [{ role: "user", content: "hi" }]
		await fs.writeFile(path.join(taskDir, "api_conversation_history.json"), JSON.stringify(messages), "utf8")

		expect(await readApiMessages({ taskId, globalStoragePath: tmpBaseDir })).toEqual(messages)
		expect(await listCorruptCopies(taskDir, "api_conversation_history.json")).toEqual([])
	})

	it("returns empty array when claude_messages.json fallback contains invalid JSON", async () => {
		const taskId = "task-corrupt-fallback"
		const taskDir = path.join(tmpBaseDir, "tasks", taskId)
		await fs.mkdir(taskDir, { recursive: true })

		// Only write the old fallback file (claude_messages.json), NOT the new one
		const oldPath = path.join(taskDir, "claude_messages.json")
		await fs.writeFile(oldPath, "not json at all {[!", "utf8")

		const result = await readApiMessages({
			taskId,
			globalStoragePath: tmpBaseDir,
		})

		expect(result).toEqual([])

		// The corrupted fallback file should NOT be deleted
		const stillExists = await fs
			.access(oldPath)
			.then(() => true)
			.catch(() => false)
		expect(stillExists).toBe(true)
	})

	it("returns [] when file contains valid JSON that is not an array", async () => {
		const taskId = "task-non-array-api"
		const taskDir = path.join(tmpBaseDir, "tasks", taskId)
		await fs.mkdir(taskDir, { recursive: true })
		const filePath = path.join(taskDir, "api_conversation_history.json")
		await fs.writeFile(filePath, JSON.stringify("hello"), "utf8")

		const result = await readApiMessages({
			taskId,
			globalStoragePath: tmpBaseDir,
		})

		expect(result).toEqual([])
	})

	it("returns [] when fallback file contains valid JSON that is not an array", async () => {
		const taskId = "task-non-array-fallback"
		const taskDir = path.join(tmpBaseDir, "tasks", taskId)
		await fs.mkdir(taskDir, { recursive: true })

		// Only write the old fallback file, NOT the new one
		const oldPath = path.join(taskDir, "claude_messages.json")
		await fs.writeFile(oldPath, JSON.stringify({ key: "value" }), "utf8")

		const result = await readApiMessages({
			taskId,
			globalStoragePath: tmpBaseDir,
		})

		expect(result).toEqual([])
	})

	describe("Cline-era claude_messages.json", () => {
		const legacyMessages = [
			{ role: "user", content: "old task question" },
			{ role: "assistant", content: [{ type: "text", text: "old task answer" }] },
		]

		async function writeLegacyTask(taskId: string): Promise<string> {
			const taskDir = path.join(tmpBaseDir, "tasks", taskId)
			await fs.mkdir(taskDir, { recursive: true })
			await fs.writeFile(path.join(taskDir, "claude_messages.json"), JSON.stringify(legacyMessages), "utf8")
			return taskDir
		}

		const exists = (filePath: string) =>
			fs
				.access(filePath)
				.then(() => true)
				.catch(() => false)

		// Regression: the first read deleted claude_messages.json without writing api_conversation_history.json,
		// so every read-only caller (search_task_history, the delegation re-attach check, the second read in
		// TaskResumption) destroyed the conversation for good.
		it("returns the same messages on a second read-only call", async () => {
			const taskId = "task-legacy-reread"
			await writeLegacyTask(taskId)

			expect(await readApiMessages({ taskId, globalStoragePath: tmpBaseDir })).toEqual(legacyMessages)
			expect(await readApiMessages({ taskId, globalStoragePath: tmpBaseDir })).toEqual(legacyMessages)
		})

		it("writes api_conversation_history.json in the save format before removing the old file", async () => {
			const taskId = "task-legacy-migrated"
			const taskDir = await writeLegacyTask(taskId)

			await readApiMessages({ taskId, globalStoragePath: tmpBaseDir })

			const newPath = path.join(taskDir, "api_conversation_history.json")
			expect(JSON.parse(await fs.readFile(newPath, "utf8"))).toEqual(legacyMessages)
			// Same bytes saveApiMessages writes: compact JSON, no pretty printing.
			expect(await fs.readFile(newPath, "utf8")).toBe(JSON.stringify(legacyMessages))
			expect(await exists(path.join(taskDir, "claude_messages.json"))).toBe(false)
		})

		it("keeps claude_messages.json when the new file cannot be written", async () => {
			const taskId = "task-legacy-write-fails"
			const taskDir = await writeLegacyTask(taskId)
			writeControl.failWrites = true

			expect(await readApiMessages({ taskId, globalStoragePath: tmpBaseDir })).toEqual(legacyMessages)
			expect(await exists(path.join(taskDir, "claude_messages.json"))).toBe(true)
			expect(await exists(path.join(taskDir, "api_conversation_history.json"))).toBe(false)

			// Once writing works again, the next read migrates as usual.
			writeControl.failWrites = false
			expect(await readApiMessages({ taskId, globalStoragePath: tmpBaseDir })).toEqual(legacyMessages)
			expect(await readApiMessages({ taskId, globalStoragePath: tmpBaseDir })).toEqual(legacyMessages)
		})

		it("gives every concurrent reader the messages and leaves the history readable", async () => {
			const taskId = "task-legacy-concurrent"
			const taskDir = await writeLegacyTask(taskId)

			const results = await Promise.all([
				readApiMessages({ taskId, globalStoragePath: tmpBaseDir }),
				readApiMessages({ taskId, globalStoragePath: tmpBaseDir }),
				readApiMessages({ taskId, globalStoragePath: tmpBaseDir }),
			])

			for (const result of results) {
				expect(result).toEqual(legacyMessages)
			}
			expect(await readApiMessages({ taskId, globalStoragePath: tmpBaseDir })).toEqual(legacyMessages)
			expect(await exists(path.join(taskDir, "claude_messages.json"))).toBe(false)
		})
	})
})
