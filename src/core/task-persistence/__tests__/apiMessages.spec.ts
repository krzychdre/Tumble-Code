// cd src && npx vitest run core/task-persistence/__tests__/apiMessages.spec.ts

import * as os from "os"
import * as path from "path"
import * as fs from "fs/promises"

import { readApiMessages } from "../apiMessages"

let tmpBaseDir: string

async function listCorruptCopies(dir: string, fileName: string): Promise<string[]> {
	return (await fs.readdir(dir)).filter((name) => name.startsWith(`${fileName}.corrupt-`))
}

beforeEach(async () => {
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

	// The Cline-era claude_messages.json read path was deleted
	// (ai_plans/2026-09-28_delete-old-config-migrations.md): the file is neither read nor removed.
	it("ignores a Cline-era claude_messages.json and leaves it on disk", async () => {
		const taskId = "task-cline-era"
		const taskDir = path.join(tmpBaseDir, "tasks", taskId)
		await fs.mkdir(taskDir, { recursive: true })
		const oldPath = path.join(taskDir, "claude_messages.json")
		await fs.writeFile(oldPath, JSON.stringify([{ role: "user", content: "old" }]), "utf8")

		expect(await readApiMessages({ taskId, globalStoragePath: tmpBaseDir })).toEqual([])
		expect(await fs.readFile(oldPath, "utf8")).toBe(JSON.stringify([{ role: "user", content: "old" }]))
		await expect(fs.access(path.join(taskDir, "api_conversation_history.json"))).rejects.toThrow()
	})
})
