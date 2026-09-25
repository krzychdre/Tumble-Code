// Moved from the CLI (apps/cli/src/lib/utils/path.ts, CLI-5): the extension
// (src/utils/path.ts) and the CLI now share this helper.
import { arePathsEqual } from "../index.js"

describe("arePathsEqual", () => {
	it("should return true for identical paths", () => {
		expect(arePathsEqual("/Users/test/project", "/Users/test/project")).toBe(true)
	})

	it("should return true for paths differing only by trailing slash", () => {
		expect(arePathsEqual("/Users/test/project", "/Users/test/project/")).toBe(true)
		expect(arePathsEqual("/Users/test/project/", "/Users/test/project")).toBe(true)
	})

	it("should return false when only one path is missing or empty", () => {
		expect(arePathsEqual(undefined, "/Users/test/project")).toBe(false)
		expect(arePathsEqual("/Users/test/project", undefined)).toBe(false)
		expect(arePathsEqual("", "/Users/test/project")).toBe(false)
		expect(arePathsEqual("/Users/test/project", "")).toBe(false)
	})

	it("should return false for different paths", () => {
		expect(arePathsEqual("/Users/test/project1", "/Users/test/project2")).toBe(false)
		expect(arePathsEqual("/Users/test/project", "/Users/other/project")).toBe(false)
	})

	// Case sensitivity behavior depends on platform
	if (process.platform === "win32") {
		it("should be case-insensitive on Windows", () => {
			expect(arePathsEqual("/Users/Test/Project", "/users/test/project")).toBe(true)
			expect(arePathsEqual("/USERS/TEST/PROJECT", "/Users/test/project")).toBe(true)
		})
	} else {
		it("should be case-sensitive on Linux and macOS", () => {
			expect(arePathsEqual("/Users/Test/Project", "/users/test/project")).toBe(false)
		})
	}

	it("should handle paths with multiple trailing slashes", () => {
		expect(arePathsEqual("/Users/test/project///", "/Users/test/project")).toBe(true)
	})
})

// DEF-C28: the CLI's former copy treated macOS paths as case-insensitive and
// two missing paths as different, so the CLI and the extension disagreed on
// which task history belongs to a workspace.
describe("arePathsEqual platform rules", () => {
	const originalPlatform = process.platform

	afterEach(() => {
		Object.defineProperty(process, "platform", { value: originalPlatform })
	})

	it("treats two missing paths as equal", () => {
		expect(arePathsEqual(undefined, undefined)).toBe(true)
		expect(arePathsEqual("", "")).toBe(true)
	})

	it("is case-sensitive on macOS, like the extension", () => {
		Object.defineProperty(process, "platform", { value: "darwin" })

		expect(arePathsEqual("/Users/Test/Project", "/Users/test/project")).toBe(false)
	})

	it("is case-insensitive on Windows", () => {
		Object.defineProperty(process, "platform", { value: "win32" })

		expect(arePathsEqual("C:\\Users\\Test", "c:\\users\\test")).toBe(true)
	})
})

// CLI-5: the CLI's former normalizePath stripped every trailing separator in
// a loop; the shared rule strips one. On Linux and macOS a backslash is a file name
// character, so "/a/b" followed by two backslashes is not "/a/b" for the extension.
if (process.platform !== "win32") {
	describe("arePathsEqual keeps the extension's trailing-separator rule", () => {
		it("strips a single trailing separator only", () => {
			expect(arePathsEqual("/work/project\\\\", "/work/project")).toBe(false)
			expect(arePathsEqual("/work/project\\", "/work/project")).toBe(true)
		})
	})
}
