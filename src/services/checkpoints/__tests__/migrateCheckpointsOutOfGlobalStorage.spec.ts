import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { migrateCheckpointsOutOfGlobalStorage } from "../migrateCheckpointsOutOfGlobalStorage"
import { getTaskCheckpointsDir } from "../paths"

// Only the home directory is replaced: the real path helpers and the real filesystem run,
// so the test asserts where the checkpoints actually end up.
vi.mock("os", async (importOriginal) => ({
	...(await importOriginal<typeof import("os")>()),
	homedir: vi.fn(),
}))

// The real filesystem does the work; only `rename` is wrapped so one test can force the
// cross-device failure that `customStoragePath` on another disk produces.
vi.mock("fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("fs/promises")>()
	return { ...actual, rename: vi.fn(actual.rename) }
})

describe("migrateCheckpointsOutOfGlobalStorage", () => {
	let home: string
	let globalStorage: string

	const taskCheckpoints = (taskId: string) => path.join(globalStorage, "tasks", taskId, "checkpoints")

	const seedTaskWithCheckpoints = async (taskId: string, marker: string) => {
		const dir = taskCheckpoints(taskId)
		await fs.mkdir(path.join(dir, ".git"), { recursive: true })
		await fs.writeFile(path.join(dir, ".git", "HEAD"), marker)
		await fs.writeFile(path.join(globalStorage, "tasks", taskId, "ui_messages.json"), "[]")
	}

	beforeEach(async () => {
		const base = await fs.mkdtemp(path.join(os.tmpdir(), "checkpoint-migration-"))
		home = path.join(base, "home")
		globalStorage = path.join(base, "globalStorage")
		await fs.mkdir(home, { recursive: true })
		await fs.mkdir(globalStorage, { recursive: true })
		vi.mocked(os.homedir).mockReturnValue(home)
	})

	afterEach(async () => {
		await fs.rm(path.dirname(home), { recursive: true, force: true })
	})

	it("moves each task's checkpoints to ~/.roo/checkpoints and leaves the task folder", async () => {
		await seedTaskWithCheckpoints("task-a", "ref: refs/heads/a")
		await seedTaskWithCheckpoints("task-b", "ref: refs/heads/b")

		const moved = await migrateCheckpointsOutOfGlobalStorage(globalStorage)

		expect(moved).toBe(2)
		expect(await fs.readFile(path.join(getTaskCheckpointsDir("task-a"), ".git", "HEAD"), "utf8")).toBe(
			"ref: refs/heads/a",
		)
		expect(await fs.readFile(path.join(getTaskCheckpointsDir("task-b"), ".git", "HEAD"), "utf8")).toBe(
			"ref: refs/heads/b",
		)
		// Nothing is left in the folder VS Code walks, but the transcript stays.
		await expect(fs.stat(taskCheckpoints("task-a"))).rejects.toThrow()
		expect(await fs.readFile(path.join(globalStorage, "tasks", "task-a", "ui_messages.json"), "utf8")).toBe("[]")
	})

	it("skips a task that already has checkpoints in the new root", async () => {
		await seedTaskWithCheckpoints("task-a", "old")
		await fs.mkdir(path.join(getTaskCheckpointsDir("task-a"), ".git"), { recursive: true })
		await fs.writeFile(path.join(getTaskCheckpointsDir("task-a"), ".git", "HEAD"), "new")

		const moved = await migrateCheckpointsOutOfGlobalStorage(globalStorage)

		expect(moved).toBe(0)
		expect(await fs.readFile(path.join(getTaskCheckpointsDir("task-a"), ".git", "HEAD"), "utf8")).toBe("new")
	})

	it("copies instead of renaming when the move crosses filesystems", async () => {
		await seedTaskWithCheckpoints("task-a", "ref: refs/heads/a")
		vi.mocked(fs.rename).mockRejectedValueOnce(
			Object.assign(new Error("EXDEV: cross-device link not permitted"), { code: "EXDEV" }),
		)

		const moved = await migrateCheckpointsOutOfGlobalStorage(globalStorage)

		expect(moved).toBe(1)
		expect(fs.rename).toHaveBeenCalledOnce()
		expect(await fs.readFile(path.join(getTaskCheckpointsDir("task-a"), ".git", "HEAD"), "utf8")).toBe(
			"ref: refs/heads/a",
		)
		await expect(fs.stat(taskCheckpoints("task-a"))).rejects.toThrow()
	})

	it("does nothing when there is no task history", async () => {
		expect(await migrateCheckpointsOutOfGlobalStorage(globalStorage)).toBe(0)
	})

	it("leaves tasks that never had checkpoints alone", async () => {
		await fs.mkdir(path.join(globalStorage, "tasks", "task-a"), { recursive: true })
		await fs.writeFile(path.join(globalStorage, "tasks", "task-a", "ui_messages.json"), "[]")

		expect(await migrateCheckpointsOutOfGlobalStorage(globalStorage)).toBe(0)
	})
})
