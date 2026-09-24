import { normalizePath, arePathsEqual } from "../path.js"

// Helper to create platform-specific expected paths
const expectedPath = (...segments: string[]) => {
	// On Windows, path.normalize converts forward slashes to backslashes
	// and paths like /Users become \Users (without a drive letter)
	if (process.platform === "win32") {
		return "\\" + segments.join("\\")
	}

	return "/" + segments.join("/")
}

describe("normalizePath", () => {
	it("should remove trailing slashes", () => {
		expect(normalizePath("/Users/test/project/")).toBe(expectedPath("Users", "test", "project"))
		expect(normalizePath("/Users/test/project//")).toBe(expectedPath("Users", "test", "project"))
	})

	it("should handle paths without trailing slashes", () => {
		expect(normalizePath("/Users/test/project")).toBe(expectedPath("Users", "test", "project"))
	})

	it("should normalize path separators", () => {
		// path.normalize handles this
		expect(normalizePath("/Users//test/project")).toBe(expectedPath("Users", "test", "project"))
	})
})

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

// DEF-C28: the CLI's copy drifted from the extension's arePathsEqual
// (src/utils/path.ts): it treated macOS paths as case-insensitive and two
// missing paths as different, so the CLI and the extension disagreed on which
// task history belongs to a workspace.
describe("arePathsEqual matches the extension's helper", () => {
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
