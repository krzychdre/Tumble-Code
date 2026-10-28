// cd src && npx vitest run utils/__tests__/storage.taskId.spec.ts

import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import { getTaskDirectoryPath, isSafeTaskId } from "../storage"

describe("task ids that name a directory", () => {
	it.each(["0190c6d5-8b5a-7c3e-9f00-112233445566", "1700000000000", "task-123", "abc.def_1"])("accepts %j", (id) => {
		expect(isSafeTaskId(id)).toBe(true)
	})

	it.each(["../../../../tmp/pwn", "../../.ssh", "a/b", "a\\b", ".hidden", "..", "", "x".repeat(129), 42, undefined])(
		"refuses %j",
		(id) => {
			expect(isSafeTaskId(id)).toBe(false)
		},
	)

	it("never creates a task directory outside the storage", async () => {
		const storage = await fs.mkdtemp(path.join(os.tmpdir(), "task-id-spec-"))
		try {
			await expect(getTaskDirectoryPath(storage, "../../escaped")).rejects.toThrow(/Invalid task id/)
			await expect(fs.access(path.join(storage, "..", "..", "escaped"))).rejects.toThrow()

			const dir = await getTaskDirectoryPath(storage, "0190c6d5-8b5a-7c3e-9f00-112233445566")
			expect(dir).toBe(path.join(storage, "tasks", "0190c6d5-8b5a-7c3e-9f00-112233445566"))
		} finally {
			await fs.rm(storage, { recursive: true, force: true })
		}
	})
})
