import * as path from "path"
import {
	initMemoryPaths,
	resetMemoryPaths,
	isAutoMemoryEnabled,
	getMemoryBaseDir,
	sanitizeCwd,
	getAutoMemPath,
	getAutoMemEntrypoint,
	isAutoMemPath,
	validateMemoryPath,
} from "../paths"

const GLOBAL_STORAGE = "/home/user/.vscode/ext-storage"
const CWD = "/home/user/my-project"

describe("memory paths", () => {
	afterEach(() => {
		resetMemoryPaths()
		delete process.env.ROO_DISABLE_AUTO_MEMORY
	})

	describe("isAutoMemoryEnabled", () => {
		it("defaults ON when unset", () => {
			initMemoryPaths(GLOBAL_STORAGE, () => ({}))
			expect(isAutoMemoryEnabled()).toBe(true)
		})

		it("respects the config setting", () => {
			initMemoryPaths(GLOBAL_STORAGE, () => ({ autoMemoryEnabled: false }))
			expect(isAutoMemoryEnabled()).toBe(false)
		})

		it("ROO_DISABLE_AUTO_MEMORY=1 overrides everything (OFF)", () => {
			initMemoryPaths(GLOBAL_STORAGE, () => ({ autoMemoryEnabled: true }))
			process.env.ROO_DISABLE_AUTO_MEMORY = "1"
			expect(isAutoMemoryEnabled()).toBe(false)
		})

		it("ROO_DISABLE_AUTO_MEMORY=0 overrides everything (ON)", () => {
			initMemoryPaths(GLOBAL_STORAGE, () => ({ autoMemoryEnabled: false }))
			process.env.ROO_DISABLE_AUTO_MEMORY = "0"
			expect(isAutoMemoryEnabled()).toBe(true)
		})

		it("defaults ON when module is uninitialized (no throw)", () => {
			// Before init, getConfig returns {} so the default is ON.
			resetMemoryPaths()
			// isAutoMemoryEnabled reads `_state?.getConfig() ?? {}` so it's safe.
			expect(isAutoMemoryEnabled()).toBe(true)
		})
	})

	describe("getMemoryBaseDir", () => {
		it("uses globalStorage/memory by default", () => {
			initMemoryPaths(GLOBAL_STORAGE, () => ({}))
			expect(getMemoryBaseDir()).toBe(path.join(GLOBAL_STORAGE, "memory"))
		})

		it("uses autoMemoryDirectory override when set (validated + trailing sep)", () => {
			initMemoryPaths(GLOBAL_STORAGE, () => ({ autoMemoryDirectory: "/custom/mem" }))
			expect(getMemoryBaseDir()).toBe("/custom/mem/")
		})

		it("ignores an empty/whitespace override", () => {
			initMemoryPaths(GLOBAL_STORAGE, () => ({ autoMemoryDirectory: "   " }))
			expect(getMemoryBaseDir()).toBe(path.join(GLOBAL_STORAGE, "memory"))
		})
	})

	describe("sanitizeCwd", () => {
		it("replaces non-alphanumeric chars (keeps hyphens) with _", () => {
			expect(sanitizeCwd("/home/user/my-project")).toBe("_home_user_my-project")
			expect(sanitizeCwd("C:\\Users\\me")).toBe("C__Users_me")
		})
	})

	describe("getAutoMemPath / getAutoMemEntrypoint", () => {
		it("builds per-cwd path under projects/<sanitized>/memory with trailing sep", () => {
			initMemoryPaths(GLOBAL_STORAGE, () => ({}))
			const p = getAutoMemPath(CWD)
			expect(p.endsWith(path.sep)).toBe(true)
			expect(p).toContain(path.join("projects", "_home_user_my-project", "memory"))
		})

		it("is memoized per-cwd", () => {
			initMemoryPaths(GLOBAL_STORAGE, () => ({}))
			const a = getAutoMemPath(CWD)
			const b = getAutoMemPath(CWD)
			expect(a).toBe(b) // same reference via cache
		})

		it("entrypoint is memory dir + MEMORY.md", () => {
			initMemoryPaths(GLOBAL_STORAGE, () => ({}))
			const entry = getAutoMemEntrypoint(CWD)
			expect(entry.endsWith(path.join("memory", "MEMORY.md"))).toBe(true)
		})
	})

	describe("isAutoMemPath", () => {
		it("returns true for a file inside the memory dir", () => {
			initMemoryPaths(GLOBAL_STORAGE, () => ({}))
			const memDir = getAutoMemPath(CWD)
			expect(isAutoMemPath(path.join(memDir, "user_role.md"), CWD)).toBe(true)
		})

		it("returns false for a sibling dir that shares a prefix (team-evil defense)", () => {
			initMemoryPaths(GLOBAL_STORAGE, () => ({ autoMemoryDirectory: "/foo/team" }))
			// /foo/team-evil/file must NOT match /foo/team/
			expect(isAutoMemPath("/foo/team-evil/file.md", CWD)).toBe(false)
		})

		it("returns false when module is uninitialized", () => {
			resetMemoryPaths()
			expect(isAutoMemPath("/anything", CWD)).toBe(false)
		})

		it("returns false when memory is disabled", () => {
			initMemoryPaths(GLOBAL_STORAGE, () => ({ autoMemoryEnabled: false }))
			expect(isAutoMemPath(path.join(getAutoMemPath(CWD), "x.md"), CWD)).toBe(false)
		})

		it("returns false for empty/invalid inputs", () => {
			initMemoryPaths(GLOBAL_STORAGE, () => ({}))
			expect(isAutoMemPath("", CWD)).toBe(false)
			expect(isAutoMemPath("/some/path", "")).toBe(false)
		})
	})

	describe("validateMemoryPath", () => {
		it("rejects empty / null bytes", () => {
			expect(() => validateMemoryPath("")).toThrow()
			expect(() => validateMemoryPath("foo\0bar")).toThrow()
		})

		it("rejects relative paths", () => {
			expect(() => validateMemoryPath("relative/path")).toThrow(/absolute/)
		})

		it("rejects UNC paths", () => {
			expect(() => validateMemoryPath("//host/share")).toThrow(/UNC/)
			expect(() => validateMemoryPath("\\\\host\\share")).toThrow(/UNC/)
		})

		it("rejects filesystem root on posix", () => {
			expect(() => validateMemoryPath("/")).toThrow()
		})

		it("rejects a path that resolves to the home directory", () => {
			expect(() => validateMemoryPath("~")).toThrow(/home directory/)
		})

		it("accepts a normal absolute path, returning it with one trailing sep", () => {
			const result = validateMemoryPath("/var/mem")
			expect(result.endsWith(path.sep)).toBe(true)
			expect(result.replace(/\/+$/, "").replace(/\\+$/, "")).toBe(path.normalize("/var/mem"))
		})

		it("expands ~ to home, then validates the expanded path", () => {
			const result = validateMemoryPath("~/mem")
			expect(path.isAbsolute(result)).toBe(true)
			expect(result).toContain("mem")
		})
	})
})
