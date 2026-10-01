import * as fs from "fs"
import * as os from "os"
import * as path from "path"

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

/**
 * The synchronous calls the store used to make are wrapped in spies that still
 * run the real implementation, so a test can prove the save path never blocks
 * the event loop. (`vi.spyOn` cannot redefine an ESM namespace export.)
 */
vi.mock("fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("fs")>()
	const wrapped = {
		...actual,
		existsSync: vi.fn(actual.existsSync),
		mkdirSync: vi.fn(actual.mkdirSync),
		writeFileSync: vi.fn(actual.writeFileSync),
		renameSync: vi.fn(actual.renameSync),
	}
	return { ...wrapped, default: wrapped }
})

// The atomic write itself lives in @roo-code/core/fs, which imports "fs/promises"; a write failure is
// injected there.
vi.mock("fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("fs/promises")>()
	const wrapped = { ...actual, writeFile: vi.fn(actual.writeFile) }
	return { ...wrapped, default: wrapped }
})

import * as fsPromises from "fs/promises"

import {
	ArtifactStore,
	MAX_ARTIFACT_BYTES,
	artifactCandidatePaths,
	artifactDirForKind,
	artifactFileName,
	artifactKindFromId,
	isValidArtifactId,
} from "../ArtifactStore"

describe("ArtifactStore", () => {
	let taskDir: string

	beforeEach(() => {
		taskDir = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-store-"))
	})

	afterEach(() => {
		fs.rmSync(taskDir, { recursive: true, force: true })
	})

	describe("id format", () => {
		it("keeps the historical cmd artifact naming", async () => {
			expect(artifactFileName("cmd", "1706119234567")).toBe("cmd-1706119234567.txt")
			expect(artifactFileName("tool", 1706119234567)).toBe("tool-1706119234567.txt")
		})

		it("accepts every known kind and rejects path traversal", async () => {
			expect(isValidArtifactId("cmd-1706119234567.txt")).toBe(true)
			expect(isValidArtifactId("tool-1706119234567.txt")).toBe(true)
			expect(isValidArtifactId("prune-1.txt")).toBe(true)
			expect(isValidArtifactId("fetch-1.txt")).toBe(true)

			expect(isValidArtifactId("../../../etc/passwd")).toBe(false)
			expect(isValidArtifactId("cmd-123/../other.txt")).toBe(false)
			expect(isValidArtifactId("cmd-.txt")).toBe(false)
			expect(isValidArtifactId("other-1.txt")).toBe(false)
			expect(isValidArtifactId("tool-1.log")).toBe(false)
		})

		it("reports the kind encoded in an id", async () => {
			expect(artifactKindFromId("tool-1.txt")).toBe("tool")
			expect(artifactKindFromId("cmd-1.txt")).toBe("cmd")
			expect(artifactKindFromId("nope")).toBeUndefined()
		})
	})

	describe("directories", () => {
		it("keeps cmd artifacts in command-output and everything else in artifacts", async () => {
			expect(artifactDirForKind(taskDir, "cmd")).toBe(path.join(taskDir, "command-output"))
			expect(artifactDirForKind(taskDir, "tool")).toBe(path.join(taskDir, "artifacts"))
			expect(artifactDirForKind(taskDir, "prune")).toBe(path.join(taskDir, "artifacts"))
			expect(artifactDirForKind(taskDir, "fetch")).toBe(path.join(taskDir, "artifacts"))
		})

		it("probes the kind's directory first and the other one as a fallback", async () => {
			expect(artifactCandidatePaths(taskDir, "cmd-1.txt")).toEqual([
				path.join(taskDir, "command-output", "cmd-1.txt"),
				path.join(taskDir, "artifacts", "cmd-1.txt"),
			])
			expect(artifactCandidatePaths(taskDir, "tool-1.txt")).toEqual([
				path.join(taskDir, "artifacts", "tool-1.txt"),
				path.join(taskDir, "command-output", "tool-1.txt"),
			])
		})
	})

	describe("save", () => {
		it("writes the full text and returns id, size and path", async () => {
			const store = new ArtifactStore(taskDir)
			const text = "line one\nline two\n"

			const saved = await store.save("tool", text, 1706119234567)

			expect(saved.id).toBe("tool-1706119234567.txt")
			expect(saved.bytes).toBe(Buffer.byteLength(text, "utf8"))
			expect(saved.path).toBe(path.join(taskDir, "artifacts", "tool-1706119234567.txt"))
			expect(fs.readFileSync(saved.path, "utf8")).toBe(text)
		})

		it("creates the artifact directory when it does not exist", async () => {
			const store = new ArtifactStore(taskDir)
			expect(fs.existsSync(path.join(taskDir, "artifacts"))).toBe(false)

			await store.save("tool", "x", 1)

			expect(fs.existsSync(path.join(taskDir, "artifacts"))).toBe(true)
		})

		it("never overwrites when two artifacts land in the same millisecond", async () => {
			const store = new ArtifactStore(taskDir)

			const first = await store.save("tool", "first", 1706119234567)
			const second = await store.save("tool", "second", 1706119234567)
			const third = await store.save("tool", "third", 1706119234567)

			expect(first.id).toBe("tool-1706119234567.txt")
			expect(second.id).toBe("tool-1706119234568.txt")
			expect(third.id).toBe("tool-1706119234569.txt")
			expect(fs.readFileSync(first.path, "utf8")).toBe("first")
			expect(fs.readFileSync(second.path, "utf8")).toBe("second")
			expect(fs.readFileSync(third.path, "utf8")).toBe("third")
		})

		it("caps a pathological payload and says what was dropped", async () => {
			const store = new ArtifactStore(taskDir)
			const oversized = "q".repeat(MAX_ARTIFACT_BYTES + 500_000)

			const saved = await store.save("tool", oversized, 1)
			const written = fs.readFileSync(saved.path, "utf8")

			expect(saved.bytes).toBeLessThan(Buffer.byteLength(oversized, "utf8"))
			expect(saved.bytes).toBe(Buffer.byteLength(written, "utf8"))
			expect(written.startsWith("q".repeat(1000))).toBe(true)
			expect(written).toContain("[Artifact truncated at 10 MB;")
			expect(written).toContain("500000 bytes of the original output were dropped")
		})

		it("counts bytes, not characters", async () => {
			const store = new ArtifactStore(taskDir)
			const saved = await store.save("tool", "zażółć", 1)
			expect(saved.bytes).toBe(Buffer.byteLength("zażółć", "utf8"))
		})
	})

	/**
	 * P10 (ai_plans/2026-09-28_p10-async-file-io.md): the write runs off the
	 * extension host's event loop and is atomic, so a crash or an I/O error in
	 * the middle of it can never leave a half-written file under an artifact id
	 * (the model would read a truncated artifact and treat it as complete).
	 */
	describe("save is asynchronous and atomic", () => {
		const artifactsDir = () => path.join(taskDir, "artifacts")

		afterEach(() => {
			vi.restoreAllMocks()
		})

		it("returns a promise", async () => {
			const store = new ArtifactStore(taskDir)

			const pending = store.save("tool", "x", 1)

			expect(pending).toBeInstanceOf(Promise)
			await pending
		})

		it("makes no synchronous file-system call", async () => {
			const store = new ArtifactStore(taskDir)
			const syncCalls = [fs.existsSync, fs.mkdirSync, fs.writeFileSync, fs.renameSync].map((fn) => vi.mocked(fn))
			syncCalls.forEach((spy) => spy.mockClear())

			await store.save("tool", "payload", 1706119234567)
			await store.save("tool", "payload", 1706119234567)

			for (const spy of syncCalls) {
				expect(spy).not.toHaveBeenCalled()
			}
		})

		it("leaves no partial artifact and no temporary file when the write fails midway", async () => {
			const store = new ArtifactStore(taskDir)
			const realWriteFile = fs.promises.writeFile.bind(fs.promises)
			vi.mocked(fsPromises.writeFile).mockImplementationOnce(async (file, data, options) => {
				// Half the bytes reach the disk, then the device fills up.
				await realWriteFile(file, String(data).slice(0, 5), options)
				throw new Error("ENOSPC: no space left on device")
			})

			await expect(store.save("tool", "0123456789", 1706119234567)).rejects.toThrow("ENOSPC")

			expect(fs.existsSync(artifactsDir()) ? fs.readdirSync(artifactsDir()) : []).toEqual([])
		})

		it("never replaces an existing artifact, even when the new write fails", async () => {
			const store = new ArtifactStore(taskDir)
			const existing = await store.save("tool", "previous artifact", 1706119234567)
			vi.mocked(fsPromises.writeFile).mockRejectedValueOnce(new Error("EIO: i/o error"))

			await expect(store.save("tool", "new artifact", 1706119234567)).rejects.toThrow("EIO")

			expect(fs.readFileSync(existing.path, "utf8")).toBe("previous artifact")
			expect(fs.readdirSync(artifactsDir())).toEqual([existing.id])
		})

		it("gives concurrent saves in the same millisecond distinct ids", async () => {
			const store = new ArtifactStore(taskDir)

			const saved = await Promise.all([
				store.save("tool", "first", 1706119234567),
				store.save("tool", "second", 1706119234567),
				store.save("tool", "third", 1706119234567),
			])

			expect(new Set(saved.map((artifact) => artifact.id)).size).toBe(3)
			expect(saved.map((artifact) => fs.readFileSync(artifact.path, "utf8"))).toEqual([
				"first",
				"second",
				"third",
			])
			expect(fs.readdirSync(artifactsDir()).sort()).toEqual(saved.map((artifact) => artifact.id).sort())
		})

		it("skips an id already taken on disk by another writer", async () => {
			const store = new ArtifactStore(taskDir)
			fs.mkdirSync(artifactsDir(), { recursive: true })
			fs.writeFileSync(path.join(artifactsDir(), "tool-1706119234567.txt"), "someone else")

			const saved = await store.save("tool", "mine", 1706119234567)

			expect(saved.id).toBe("tool-1706119234568.txt")
			expect(fs.readFileSync(path.join(artifactsDir(), "tool-1706119234567.txt"), "utf8")).toBe("someone else")
		})
	})

	describe("cleanup", () => {
		it("removes only artifacts of the requested kinds", async () => {
			const store = new ArtifactStore(taskDir)
			await store.save("tool", "a", 1)
			await store.save("prune", "b", 2)
			const artifactsDir = path.join(taskDir, "artifacts")
			fs.writeFileSync(path.join(artifactsDir, "keep-me.json"), "{}")

			await ArtifactStore.cleanup(artifactsDir, ["tool"])

			expect(fs.readdirSync(artifactsDir).sort()).toEqual(["keep-me.json", "prune-2.txt"])
		})

		it("keeps artifacts whose timestamp is still referenced", async () => {
			const commandOutputDir = path.join(taskDir, "command-output")
			fs.mkdirSync(commandOutputDir, { recursive: true })
			fs.writeFileSync(path.join(commandOutputDir, "cmd-111.txt"), "keep")
			fs.writeFileSync(path.join(commandOutputDir, "cmd-222.txt"), "drop")

			await ArtifactStore.cleanupByIds(commandOutputDir, new Set(["111"]), "cmd")

			expect(fs.readdirSync(commandOutputDir)).toEqual(["cmd-111.txt"])
		})

		it("is a no-op for a directory that does not exist", async () => {
			await expect(ArtifactStore.cleanup(path.join(taskDir, "nope"))).resolves.toBeUndefined()
			await expect(ArtifactStore.cleanupByIds(path.join(taskDir, "nope"), new Set())).resolves.toBeUndefined()
		})
	})
})
