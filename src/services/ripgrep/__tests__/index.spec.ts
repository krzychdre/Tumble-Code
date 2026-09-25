// npx vitest run src/services/ripgrep/__tests__/index.spec.ts

import path from "path"
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest"

import { truncateLine, getBinPath, regexSearchFiles, REGEX_SEARCH_TIMEOUT_MS } from "../index"
import { fileExistsAtPath } from "../../../utils/fs"

import { fakeRg } from "./fake-rg-process"

vi.mock("../../../utils/fs", () => ({
	fileExistsAtPath: vi.fn(),
}))

vi.mock("child_process", () => ({
	spawn: vi.fn(),
}))

import * as childProcess from "child_process"

const mockFileExists = vi.mocked(fileExistsAtPath)

describe("Ripgrep line truncation", () => {
	// The default MAX_LINE_LENGTH is 500 in the implementation
	const MAX_LINE_LENGTH = 500

	it("should truncate lines longer than MAX_LINE_LENGTH", () => {
		const longLine = "a".repeat(600) // Line longer than MAX_LINE_LENGTH
		const truncated = truncateLine(longLine)

		expect(truncated).toContain("[truncated...]")
		expect(truncated.length).toBeLessThan(longLine.length)
		expect(truncated.length).toEqual(MAX_LINE_LENGTH + " [truncated...]".length)
	})

	it("should not truncate lines shorter than MAX_LINE_LENGTH", () => {
		const shortLine = "Short line of text"
		const truncated = truncateLine(shortLine)

		expect(truncated).toEqual(shortLine)
		expect(truncated).not.toContain("[truncated...]")
	})

	it("should correctly truncate a line at exactly MAX_LINE_LENGTH characters", () => {
		const exactLine = "a".repeat(MAX_LINE_LENGTH)
		const exactPlusOne = exactLine + "x"

		// Should not truncate when exactly MAX_LINE_LENGTH
		expect(truncateLine(exactLine)).toEqual(exactLine)

		// Should truncate when exceeding MAX_LINE_LENGTH by even 1 character
		expect(truncateLine(exactPlusOne)).toContain("[truncated...]")
	})

	it("should handle empty lines without errors", () => {
		expect(truncateLine("")).toEqual("")
	})

	it("should allow custom maximum length", () => {
		const customLength = 100
		const line = "a".repeat(customLength + 50)

		const truncated = truncateLine(line, customLength)

		expect(truncated.length).toEqual(customLength + " [truncated...]".length)
		expect(truncated).toContain("[truncated...]")
	})
})

describe("getBinPath", () => {
	const appRoot = "/fake/vscode/appRoot"
	const binName = process.platform.startsWith("win") ? "rg.exe" : "rg"
	const platformDir = `${process.platform}-${process.arch}`

	beforeEach(() => {
		mockFileExists.mockReset()
		mockFileExists.mockResolvedValue(false)
	})

	it("resolves ripgrep from the classic @vscode/ripgrep layout", async () => {
		const rg = path.join(appRoot, "node_modules/@vscode/ripgrep/bin", binName)
		mockFileExists.mockImplementation(async (p: string) => p === rg)

		expect(await getBinPath(appRoot)).toBe(rg)
	})

	it("prefers the CLI-provided ripgrep path over appRoot candidates", async () => {
		const previous = process.env.ROO_RIPGREP_PATH
		const bundledRg = path.join("/fake/tumble-cli", "bin", binName)
		process.env.ROO_RIPGREP_PATH = bundledRg
		mockFileExists.mockImplementation(async (p: string) => p === bundledRg)

		try {
			expect(await getBinPath(appRoot)).toBe(bundledRg)
			expect(mockFileExists).toHaveBeenCalledTimes(1)
		} finally {
			if (previous === undefined) {
				delete process.env.ROO_RIPGREP_PATH
			} else {
				process.env.ROO_RIPGREP_PATH = previous
			}
		}
	})

	it("resolves ripgrep from the @vscode/ripgrep-universal layout (VS Code Insiders)", async () => {
		const rg = path.join(appRoot, "node_modules/@vscode/ripgrep-universal/bin", platformDir, binName)
		mockFileExists.mockImplementation(async (p: string) => p === rg)

		expect(await getBinPath(appRoot)).toBe(rg)
	})

	it("resolves ripgrep from the unpacked `@vscode/ripgrep-universal` layout", async () => {
		const rg = path.join(appRoot, "node_modules.asar.unpacked/@vscode/ripgrep-universal/bin", platformDir, binName)
		mockFileExists.mockImplementation(async (p: string) => p === rg)

		expect(await getBinPath(appRoot)).toBe(rg)
	})

	// @vscode/ripgrep >=1.18 (VS Code 1.130+) no longer ships a bin/ folder of its own:
	// the binary lives in a per-platform optional package such as @vscode/ripgrep-linux-x64.
	it("resolves ripgrep from the @vscode/ripgrep >=1.18 platform-package layout", async () => {
		const rg = path.join(appRoot, `node_modules/@vscode/ripgrep-${platformDir}/bin`, binName)
		mockFileExists.mockImplementation(async (p: string) => p === rg)

		expect(await getBinPath(appRoot)).toBe(rg)
	})

	it("resolves ripgrep from the unpacked @vscode/ripgrep >=1.18 platform-package layout", async () => {
		const rg = path.join(appRoot, `node_modules.asar.unpacked/@vscode/ripgrep-${platformDir}/bin`, binName)
		mockFileExists.mockImplementation(async (p: string) => p === rg)

		expect(await getBinPath(appRoot)).toBe(rg)
	})

	it("returns undefined when ripgrep cannot be found", async () => {
		mockFileExists.mockResolvedValue(false)

		expect(await getBinPath(appRoot)).toBeUndefined()
	})
})

describe("regexSearchFiles", () => {
	const mockSpawn = vi.mocked(childProcess.spawn)
	const cwd = path.resolve("/work")
	const file = path.join(cwd, "src", "a.ts")
	const rgPath = path.resolve("/fake/tumble-cli/bin/rg")
	let previousRgPath: string | undefined

	const begin = () => JSON.stringify({ type: "begin", data: { path: { text: file } } }) + "\n"
	const match = (line: number, text: string) =>
		JSON.stringify({
			type: "match",
			data: { path: { text: file }, lines: { text }, line_number: line, absolute_offset: 0 },
		}) + "\n"
	const end = () => JSON.stringify({ type: "end", data: { path: { text: file } } }) + "\n"

	beforeEach(() => {
		mockSpawn.mockReset()
		mockFileExists.mockReset()
		mockFileExists.mockResolvedValue(true)
		previousRgPath = process.env.ROO_RIPGREP_PATH
		process.env.ROO_RIPGREP_PATH = rgPath
	})

	afterEach(() => {
		vi.useRealTimers()
		if (previousRgPath === undefined) {
			delete process.env.ROO_RIPGREP_PATH
		} else {
			process.env.ROO_RIPGREP_PATH = previousRgPath
		}
	})

	it("returns matches when ripgrep prints a warning on stderr but exits 0", async () => {
		mockSpawn.mockReturnValue(
			fakeRg({
				stdout: [begin(), match(3, "// TODO: fix\n"), end()],
				stderr: ["rg: ./dangling-link: No such file or directory (os error 2)\n"],
				exitCode: 0,
			}) as any,
		)

		const result = await regexSearchFiles(cwd, cwd, "TODO")

		expect(result).toContain("Found 1 result.")
		expect(result).toContain("# src/a.ts")
		expect(result).toContain("TODO: fix")
	})

	it("surfaces a bad regex as a short, actionable error instead of 'No results found'", async () => {
		mockSpawn.mockReturnValue(
			fakeRg({
				stderr: ["rg: regex parse error:\n    (?:foo()\n    ^\nerror: unclosed group\n"],
				exitCode: 2,
			}) as any,
		)

		const error = await regexSearchFiles(cwd, cwd, "foo(").catch((e: unknown) => e)

		expect(error).toBeInstanceOf(Error)
		const message = (error as Error).message
		expect(message).toContain("Invalid regex")
		expect(message).toContain("foo(")
		expect(message).toContain("unclosed group")
		expect(message).toMatch(/escape/i)
		expect(message.length).toBeLessThan(400)
	})

	it("returns 'Found 0 results' when ripgrep exits 1 (no matches)", async () => {
		mockSpawn.mockReturnValue(fakeRg({ exitCode: 1 }) as any)

		expect(await regexSearchFiles(cwd, cwd, "nothing-matches")).toBe("Found 0 results.")
	})

	it("stops reading at the output limit and kills ripgrep", async () => {
		const lines = [begin()]
		for (let i = 1; i <= 3000; i++) lines.push(match(i * 10, `hit ${i}\n`))
		lines.push(end())
		const proc = fakeRg({ stdout: [lines.join("")], hang: true })
		mockSpawn.mockReturnValue(proc as any)

		const result = await regexSearchFiles(cwd, cwd, "hit")

		expect(proc.kill).toHaveBeenCalled()
		expect(result).toContain("Showing first 300 of 300+ results")
		// A file cut off by the limit (no "end" event) still contributes its matches,
		// and the cap counts results, not files.
		const shown = result.split("\n").filter((line) => line === "----").length
		expect(shown).toBe(300)
	})

	it("kills a hanging ripgrep after the timeout and says the results are partial", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
		const proc = fakeRg({ stdout: [begin(), match(1, "hit\n")], hang: true })
		mockSpawn.mockReturnValue(proc as any)

		const pending = regexSearchFiles(cwd, cwd, "hit")
		for (let i = 0; i < 20 && mockSpawn.mock.calls.length === 0; i++) {
			await new Promise((resolve) => setImmediate(resolve))
		}
		expect(mockSpawn).toHaveBeenCalled()
		await vi.advanceTimersByTimeAsync(REGEX_SEARCH_TIMEOUT_MS + 1)

		const result = await pending
		expect(proc.kill).toHaveBeenCalled()
		expect(result).toMatch(/timed out/i)
	})
})
