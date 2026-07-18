import * as actualFsPromises from "fs/promises"
import * as fsSyncActual from "fs"
import { Writable } from "stream"
import * as path from "path"
import * as os from "os"

import * as lockfile from "proper-lockfile"

import { safeWriteJson, withLockedJsonTransaction, type LockedJsonWriter } from "../safeWriteJson"

const originalFsPromisesWriteFile = actualFsPromises.writeFile
const _originalFsPromisesAccess = actualFsPromises.access
const originalFsPromisesMkdir = actualFsPromises.mkdir

vi.mock("fs/promises", async () => {
	const actual = await vi.importActual<typeof import("fs/promises")>("fs/promises")
	// Start with all actual implementations.
	const mockedFs = { ...actual }
	// Selectively wrap functions with vi.fn() if they are spied on
	// or have their implementations changed in tests.
	// This ensures that other fs.promises functions used by the SUT
	// (like proper-lockfile's internals) will use their actual implementations.
	mockedFs.writeFile = vi.fn(actual.writeFile) as any
	mockedFs.readFile = vi.fn(actual.readFile) as any
	mockedFs.rename = vi.fn(actual.rename) as any
	mockedFs.unlink = vi.fn(actual.unlink) as any
	mockedFs.access = vi.fn(actual.access) as any
	mockedFs.mkdtemp = vi.fn(actual.mkdtemp) as any
	mockedFs.rm = vi.fn(actual.rm) as any
	mockedFs.readdir = vi.fn(actual.readdir) as any
	mockedFs.mkdir = vi.fn(actual.mkdir) as any
	// fs.stat and fs.lstat will be available via { ...actual }

	return mockedFs
})

// Mock the 'fs' module for fsSync.createWriteStream
vi.mock("fs", async () => {
	const actualFs = await vi.importActual<typeof import("fs")>("fs")
	return {
		...actualFs, // Spread actual implementations
		createWriteStream: vi.fn(actualFs.createWriteStream) as any, // Default to actual, but mockable
	}
})

import * as fs from "fs/promises" // This will now be the mocked version

describe("safeWriteJson", () => {
	let originalConsoleError: typeof console.error

	beforeAll(() => {
		// Store original console.error
		originalConsoleError = console.error
	})

	afterAll(() => {
		// Restore original console.error
		console.error = originalConsoleError
	})

	let tempDir: string
	let currentTestFilePath: string

	beforeEach(async () => {
		// Create a temporary directory for each test
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "safeWriteJson-test-"))

		// Create a unique file path for each test
		currentTestFilePath = path.join(tempDir, "test-file.json")

		// Pre-create the file with initial content to ensure it exists
		// This allows proper-lockfile to acquire a lock on an existing file.
		await fs.writeFile(currentTestFilePath, JSON.stringify({ initial: "content" }))
	})

	afterEach(async () => {
		// Clean up the temporary directory after each test
		await fs.rm(tempDir, { recursive: true, force: true })

		// Reset all mocks to their actual implementations
		vi.restoreAllMocks()
	})

	// Helper function to read file content
	async function readFileContent(filePath: string): Promise<any> {
		const readContent = await fs.readFile(filePath, "utf-8")
		return JSON.parse(readContent)
	}

	// Helper function to check if a file exists
	async function fileExists(filePath: string): Promise<boolean> {
		try {
			await fs.access(filePath)
			return true
		} catch {
			return false
		}
	}

	// Success Scenarios
	// Note: Since we pre-create the file in beforeEach, this test will overwrite it.
	// If "creation from non-existence" is critical and locking prevents it, safeWriteJson or locking strategy needs review.
	test("should successfully write a new file (overwriting initial content from beforeEach)", async () => {
		const data = { message: "Hello, new world!" }

		await safeWriteJson(currentTestFilePath, data)

		const content = await readFileContent(currentTestFilePath)
		expect(content).toEqual(data)
	})

	test("should successfully overwrite an existing file", async () => {
		const initialData = { message: "Initial content" }
		const newData = { message: "Updated content" }

		// Write initial data (overwriting the pre-created file from beforeEach)
		await originalFsPromisesWriteFile(currentTestFilePath, JSON.stringify(initialData))

		await safeWriteJson(currentTestFilePath, newData)

		const content = await readFileContent(currentTestFilePath)
		expect(content).toEqual(newData)
	})

	test("always acquires an inter-process lock", async () => {
		const releaseExternalLock = await lockfile.lock(currentTestFilePath, {
			realpath: false,
			retries: 0,
		})

		try {
			await expect(safeWriteJson(currentTestFilePath, { locked: true })).rejects.toMatchObject({
				code: "ELOCKED",
			})
		} finally {
			await releaseExternalLock()
		}

		expect(await readFileContent(currentTestFilePath)).toEqual({ initial: "content" })
	})

	test("exports no lock-bypass option or raw atomic writer", async () => {
		const api = await import("../safeWriteJson")

		expect(api).not.toHaveProperty("writeJsonAtomically")
		expect(api).not.toHaveProperty("alreadyLocked")
		expect(api).not.toHaveProperty("skipLock")
	})

	test("transaction writer runs while locked and rejects use after the callback", async () => {
		const destinationPath = path.join(tempDir, "transaction.json")
		const lockTargetPath = path.join(tempDir, "locks", "transaction.lock-target")
		let retainedWriter: LockedJsonWriter | undefined
		let competingLockError: NodeJS.ErrnoException | undefined

		await fs.mkdir(path.dirname(destinationPath), { recursive: true })
		await withLockedJsonTransaction(lockTargetPath, destinationPath, async (writeJson) => {
			retainedWriter = writeJson
			await writeJson({ transaction: true })
			try {
				const releaseCompetingLock = await lockfile.lock(lockTargetPath, {
					realpath: false,
					retries: 0,
				})
				await releaseCompetingLock()
			} catch (error) {
				competingLockError = error as NodeJS.ErrnoException
			}
		})

		expect(competingLockError?.code).toBe("ELOCKED")
		expect(await readFileContent(destinationPath)).toEqual({ transaction: true })
		await expect(retainedWriter?.({ afterUnlock: true })).rejects.toThrow(
			"Locked JSON writer cannot be used after its transaction callback",
		)
		expect(await readFileContent(destinationPath)).toEqual({ transaction: true })
	})

	test.runIf(process.platform !== "win32")(
		"transaction writer preserves an existing destination's POSIX mode",
		async () => {
			const destinationPath = path.join(tempDir, "transaction-mode.json")
			const lockTargetPath = path.join(tempDir, "locks", "mode.lock-target")
			await fs.writeFile(destinationPath, JSON.stringify({ initial: true }))
			await fs.chmod(destinationPath, 0o640)

			await withLockedJsonTransaction(lockTargetPath, destinationPath, (writeJson) =>
				writeJson({ updated: true }),
			)

			expect((await fs.stat(destinationPath)).mode & 0o777).toBe(0o640)
		},
	)

	test.runIf(process.platform !== "win32")("preserves an existing destination's POSIX mode", async () => {
		await fs.chmod(currentTestFilePath, 0o600)

		await safeWriteJson(currentTestFilePath, { protected: true })

		expect((await fs.stat(currentTestFilePath)).mode & 0o777).toBe(0o600)
	})

	test.runIf(process.platform !== "win32")("does not broaden permissions for a new file", async () => {
		const filePath = path.join(tempDir, "new-mode.json")

		await safeWriteJson(filePath, { fresh: true })

		const mode = (await fs.stat(filePath)).mode & 0o777
		expect(mode).toBe(0o666 & ~process.umask())
	})

	test.runIf(process.platform !== "win32")(
		"keeps the original file when chmod on the temporary file fails",
		async () => {
			const original = await readFileContent(currentTestFilePath)
			await fs.chmod(currentTestFilePath, 0o600)
			const chmod = vi.spyOn(fs, "chmod").mockRejectedValueOnce(new Error("chmod failed"))

			await expect(safeWriteJson(currentTestFilePath, { replacement: true })).rejects.toThrow("chmod failed")

			expect(await readFileContent(currentTestFilePath)).toEqual(original)
			const files = await fs.readdir(tempDir)
			expect(files.some((name) => name.includes(".new_"))).toBe(false)
			chmod.mockRestore()
		},
	)

	// Failure Scenarios
	test("should handle failure when writing to tempNewFilePath", async () => {
		// currentTestFilePath exists due to beforeEach, allowing lock acquisition.
		const data = { message: "test write failure" }

		const mockErrorStream = new Writable() as any
		mockErrorStream._write = (_chunk: any, _encoding: any, callback: any) => {
			callback(new Error("Write stream error"))
		}
		// Add missing WriteStream properties
		mockErrorStream.close = vi.fn()
		mockErrorStream.bytesWritten = 0
		mockErrorStream.path = ""
		mockErrorStream.pending = false

		// Mock createWriteStream to return a stream that errors on write
		;(fsSyncActual.createWriteStream as any).mockImplementationOnce((_path: any, _options: any) => {
			return mockErrorStream
		})

		await expect(safeWriteJson(currentTestFilePath, data)).rejects.toThrow("Write stream error")

		// Verify the original file still exists and is unchanged
		const exists = await fileExists(currentTestFilePath)
		expect(exists).toBe(true)

		// Verify content is unchanged (should still have the initial content from beforeEach)
		const content = await readFileContent(currentTestFilePath)
		expect(content).toEqual({ initial: "content" })
	})

	test("should handle failure when renaming filePath to tempBackupFilePath (filePath exists)", async () => {
		const initialData = { message: "Initial content, should remain" }
		const newData = { message: "New content, should not be written" }

		// Overwrite the pre-created file with specific initial data
		await originalFsPromisesWriteFile(currentTestFilePath, JSON.stringify(initialData))

		const renameSpy = vi.spyOn(fs, "rename")

		// Mock rename to fail on the first call (filePath -> tempBackupFilePath)
		renameSpy.mockImplementationOnce(async () => {
			throw new Error("Rename to backup failed")
		})

		await expect(safeWriteJson(currentTestFilePath, newData)).rejects.toThrow("Rename to backup failed")

		// Verify the original file still exists with initial content
		const content = await readFileContent(currentTestFilePath)
		expect(content).toEqual(initialData)
	})

	test("should handle failure when atomically renaming tempNewFilePath to filePath", async () => {
		const initialData = { message: "Initial content, should be restored" }
		const newData = { message: "New content" }

		// Overwrite the pre-created file with specific initial data
		await originalFsPromisesWriteFile(currentTestFilePath, JSON.stringify(initialData))

		const renameSpy = vi.spyOn(fs, "rename")

		renameSpy.mockRejectedValueOnce(new Error("Rename from temp to final failed"))

		await expect(safeWriteJson(currentTestFilePath, newData)).rejects.toThrow("Rename from temp to final failed")

		// Verify the file was restored to initial content
		const content = await readFileContent(currentTestFilePath)
		expect(content).toEqual(initialData)
	})

	// Tests for directory creation functionality
	test("should create parent directory if it doesn't exist", async () => {
		// Create a path in a non-existent subdirectory of the temp dir
		const subDir = path.join(tempDir, "new-subdir")
		const filePath = path.join(subDir, "file.json")
		const data = { test: "directory creation" }

		// Verify directory doesn't exist
		await expect(fs.access(subDir)).rejects.toThrow()

		// Write file
		await safeWriteJson(filePath, data)

		// Verify directory was created
		await expect(fs.access(subDir)).resolves.toBeUndefined()

		// Verify file was written
		const content = await readFileContent(filePath)
		expect(content).toEqual(data)
	})

	test("should handle multi-level directory creation", async () => {
		// Create a new non-existent subdirectory path with multiple levels
		const deepDir = path.join(tempDir, "level1", "level2", "level3")
		const filePath = path.join(deepDir, "deep-file.json")
		const data = { nested: "deeply" }

		// Verify none of the directories exist
		await expect(fs.access(path.join(tempDir, "level1"))).rejects.toThrow()

		// Write file
		await safeWriteJson(filePath, data)

		// Verify all directories were created
		await expect(fs.access(path.join(tempDir, "level1"))).resolves.toBeUndefined()
		await expect(fs.access(path.join(tempDir, "level1", "level2"))).resolves.toBeUndefined()
		await expect(fs.access(deepDir)).resolves.toBeUndefined()

		// Verify file was written
		const content = await readFileContent(filePath)
		expect(content).toEqual(data)
	})

	test("should handle directory creation permission errors", async () => {
		// Mock mkdir to simulate a permission error
		const mkdirSpy = vi.spyOn(fs, "mkdir")
		mkdirSpy.mockImplementationOnce(async () => {
			const error = new Error("EACCES: permission denied") as any
			error.code = "EACCES"
			throw error
		})

		const subDir = path.join(tempDir, "forbidden-dir")
		const filePath = path.join(subDir, "file.json")
		const data = { test: "permission error" }

		// Should throw the permission error
		await expect(safeWriteJson(filePath, data)).rejects.toThrow("EACCES: permission denied")

		// Verify directory was not created
		await expect(fs.access(subDir)).rejects.toThrow()
	})

	test("should successfully write to a non-existent file in an existing directory", async () => {
		// Create directory but not the file
		const subDir = path.join(tempDir, "existing-dir")
		await fs.mkdir(subDir)

		const filePath = path.join(subDir, "new-file.json")
		const data = { fresh: "file" }

		// Verify file doesn't exist yet
		await expect(fs.access(filePath)).rejects.toThrow()

		// Write file
		await safeWriteJson(filePath, data)

		// Verify file was created with correct content
		const content = await readFileContent(filePath)
		expect(content).toEqual(data)
	})

	test("should handle failure when renaming tempNewFilePath to filePath (filePath initially exists)", async () => {
		// currentTestFilePath exists due to beforeEach.
		const initialData = { message: "Initial content" }
		const newData = { message: "New content" }

		await originalFsPromisesWriteFile(currentTestFilePath, JSON.stringify(initialData))

		const renameSpy = vi.spyOn(fs, "rename")
		// Mock rename to fail on the second call (tempNewFilePath -> filePath)
		// This test assumes that the first rename (filePath -> tempBackupFilePath) succeeds,
		// which is the expected behavior when the file exists.
		// The existing complex mock in `test("should handle failure when renaming tempNewFilePath to filePath (filePath exists, backup succeeded)"`
		// might be more relevant or adaptable here.

		renameSpy.mockRejectedValueOnce(new Error("Rename failed"))

		await expect(safeWriteJson(currentTestFilePath, newData)).rejects.toThrow("Rename failed")

		// The file should be restored to its initial content
		const content = await readFileContent(currentTestFilePath)
		expect(content).toEqual(initialData)
	})

	test("should throw an error if an inter-process lock is already held for the filePath", async () => {
		vi.resetModules() // Clear module cache to ensure fresh imports for this test

		const data = { message: "test lock failure" }

		// Create a new file path for this specific test to avoid conflicts
		const lockTestFilePath = path.join(tempDir, "lock-test-file.json")
		await fs.writeFile(lockTestFilePath, JSON.stringify({ initial: "lock test content" }))

		vi.doMock("proper-lockfile", () => ({
			...vi.importActual("proper-lockfile"),
			lock: vi.fn().mockRejectedValueOnce(new Error("Failed to get lock.")),
		}))

		// Re-import safeWriteJson to use the mocked proper-lockfile
		const { safeWriteJson: mockedSafeWriteJson } = await import("../safeWriteJson")

		await expect(mockedSafeWriteJson(lockTestFilePath, data)).rejects.toThrow("Failed to get lock.")

		// Clean up
		await fs.unlink(lockTestFilePath).catch(() => {}) // Ignore errors if file doesn't exist
		vi.unmock("proper-lockfile") // Ensure the mock is removed after this test
	})
	test("should release lock even if an error occurs mid-operation", async () => {
		const data = { message: "test lock release on error" }

		// Mock createWriteStream to throw an error
		const createWriteStreamSpy = vi.spyOn(fsSyncActual, "createWriteStream")
		createWriteStreamSpy.mockImplementationOnce((_path: any, _options: any) => {
			const errorStream = new Writable() as any
			errorStream._write = (_chunk: any, _encoding: any, callback: any) => {
				callback(new Error("Stream write error"))
			}
			// Add missing WriteStream properties
			errorStream.close = vi.fn()
			errorStream.bytesWritten = 0
			errorStream.path = _path
			errorStream.pending = false
			return errorStream
		})

		// This should throw but still release the lock
		await expect(safeWriteJson(currentTestFilePath, data)).rejects.toThrow("Stream write error")

		// Reset the mock to allow the second call to work normally
		createWriteStreamSpy.mockRestore()

		// If the lock wasn't released, this second attempt would fail with a lock error
		// Instead, it should succeed (proving the lock was released)
		await expect(safeWriteJson(currentTestFilePath, data)).resolves.toBeUndefined()
	})

	test("should handle fs.access error that is not ENOENT", async () => {
		const data = { message: "access error test" }
		const accessSpy = vi.spyOn(fs, "access").mockImplementationOnce(async () => {
			const error = new Error("EACCES: permission denied") as any
			error.code = "EACCES"
			throw error
		})

		// Create a path that will trigger the access check
		const testPath = path.join(tempDir, "access-error-test.json")

		await expect(safeWriteJson(testPath, data)).rejects.toThrow("EACCES: permission denied")

		// Verify access was called
		expect(accessSpy).toHaveBeenCalled()
	})
})
