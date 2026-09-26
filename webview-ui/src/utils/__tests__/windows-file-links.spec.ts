import { describe, expect, it } from "vitest"

import { decodeFilePath, isWindowsAbsolutePath, toOpenFileLinkText } from "../windows-file-links"

describe("isWindowsAbsolutePath", () => {
	it.each([
		"C:/Users/test/app/a.ts",
		"C:\\Users\\test\\app\\a.ts",
		"c:/Users/test/app/a.ts",
		"c:\\Users\\test\\app\\a.ts",
		"\\\\server\\share\\a.ts",
		// Markdown percent-encodes backslashes in link destinations.
		"C:%5CUsers%5Ctest%5Capp%5Ca.ts",
		"%5C%5Cserver%5Cshare%5Ca.ts",
	])("accepts %j", (p) => {
		expect(isWindowsAbsolutePath(p)).toBe(true)
	})

	it.each([
		"/home/u/a.ts",
		"src/a.ts",
		"./src/a.ts",
		"CD:/weird/a.ts",
		"C:",
		"C",
		"",
		"https://x.com",
		"README.md:6",
	])("rejects %j", (p) => {
		expect(isWindowsAbsolutePath(p)).toBe(false)
	})
})

describe("decodeFilePath", () => {
	it("decodes percent-encoded backslashes", () => {
		expect(decodeFilePath("C:%5CUsers%5Ctest%5Capp%5Ca.ts")).toBe("C:\\Users\\test\\app\\a.ts")
	})

	it("returns invalid percent-encoding unchanged", () => {
		expect(decodeFilePath("src/50%/of/x.ts")).toBe("src/50%/of/x.ts")
	})

	it("returns plain paths unchanged", () => {
		expect(decodeFilePath("/home/u/a.ts")).toBe("/home/u/a.ts")
	})
})

describe("toOpenFileLinkText", () => {
	// Windows drive paths must reach the extension untouched: the openFile
	// handler's path.isAbsolute must see them as absolute on Windows.
	it("passes Windows drive paths through unchanged", () => {
		expect(toOpenFileLinkText("C:/Users/test/app/a.ts")).toBe("C:/Users/test/app/a.ts")
		expect(toOpenFileLinkText("C:\\Users\\test\\app\\a.ts")).toBe("C:\\Users\\test\\app\\a.ts")
	})

	it("passes UNC paths through unchanged", () => {
		expect(toOpenFileLinkText("\\\\server\\share\\a.ts")).toBe("\\\\server\\share\\a.ts")
	})

	it("keeps POSIX absolute paths unchanged", () => {
		expect(toOpenFileLinkText("/home/u/a.ts")).toBe("/home/u/a.ts")
	})

	it("keeps already-relative paths that start with ./ unchanged", () => {
		expect(toOpenFileLinkText("./src/a.ts")).toBe("./src/a.ts")
	})

	it("prefixes bare relative paths with ./", () => {
		expect(toOpenFileLinkText("src/a.ts")).toBe("./src/a.ts")
		expect(toOpenFileLinkText("README.md")).toBe("./README.md")
	})
})
