// The problems text the agent sees, built from VS Code diagnostics. The vscode API (the shared
// mock plus a fake file system answer per file) is the only stand-in.

import * as path from "path"
import * as vscode from "vscode"

import { diagnosticsToProblemsString, getNewDiagnostics } from "../index"

const { Error, Warning, Information, Hint } = vscode.DiagnosticSeverity
const ALL = [Error, Warning, Information, Hint]
const CWD = path.resolve(path.sep, "project")

const uri = (relPath: string) => {
	const fsPath = path.join(CWD, relPath)
	return { fsPath, toString: () => fsPath } as unknown as vscode.Uri
}
const diag = (line: number, message: string, severity: number, source?: string) =>
	({ range: { start: { line, character: 0 } }, message, severity, source }) as unknown as vscode.Diagnostic

// What the fake file system answers per file: its lines, "dir", or "gone" (stat throws).
let files: Record<string, string[] | "dir" | "gone">
let openTextDocument: ReturnType<typeof vi.fn>

beforeEach(() => {
	files = {}
	vi.spyOn(vscode.workspace.fs, "stat").mockImplementation(async (u: vscode.Uri) => {
		const entry = files[u.fsPath]
		if (entry === "gone" || entry === undefined) throw new globalThis.Error("ENOENT")
		return { type: entry === "dir" ? vscode.FileType.Directory : vscode.FileType.File } as vscode.FileStat
	})
	openTextDocument = vi.fn(async (u: vscode.Uri) => ({
		lineAt: (line: number) => ({ text: (files[u.fsPath] as string[])[line] }),
	}))
	;(vscode.workspace as any).openTextDocument = openTextDocument
})

afterEach(() => {
	vi.restoreAllMocks()
	delete (vscode.workspace as any).openTextDocument
})

const problems = (diagnostics: [vscode.Uri, vscode.Diagnostic[]][], severities = ALL, include = true, max?: number) =>
	diagnosticsToProblemsString(diagnostics, severities, CWD, include, max)

describe("diagnosticsToProblemsString", () => {
	const a = uri("src/a.ts")
	const b = uri("b.ts")

	beforeEach(() => {
		files[a.fsPath] = ["const x", "let y", "z()", "w"]
		files[b.fsPath] = ["only line"]
	})

	it("lists each file's problems by line, with label, source and the line's text", async () => {
		const result = await problems(
			[
				[
					a,
					[
						diag(3, "hint", Hint),
						diag(0, "broken", Error, "ts"),
						diag(1, "unused", Warning, "eslint"),
						diag(2, "note", Information),
						diag(2, "odd", 9),
					],
				],
				[b, [diag(0, "warn b", Warning)]],
			],
			[...ALL, 9 as vscode.DiagnosticSeverity],
		)

		expect(result).toBe(
			[
				"src/a.ts",
				"- [ts Error] 1 | const x : broken",
				"- [eslint Warning] 2 | let y : unused",
				"- [Information] 3 | z() : note",
				"- [Diagnostic] 3 | z() : odd",
				"- [Hint] 4 | w : hint",
				"",
				"b.ts",
				"- [Warning] 1 | only line : warn b",
			].join("\n"),
		)
		// One document per file, however many problems it has.
		expect(openTextDocument).toHaveBeenCalledTimes(2)
	})

	it.each([
		["a directory", "dir", "- [Error] 1 | (directory) : bad"],
		["a file that cannot be read", "gone", "- [Error] 6 | (unavailable) : bad"],
	])("marks %s", async (_, entry, line) => {
		files[a.fsPath] = entry as "dir" | "gone"

		expect(await problems([[a, [diag(5, "bad", Error)]]])).toBe(`src/a.ts\n${line}`)
		expect(await problems([[a, [diag(5, "bad", Error)]]], ALL, true, 5)).toBe(`src/a.ts\n${line}`)
	})

	it.each([
		["no problem of the asked severity", [Error], true],
		["diagnostics turned off", ALL, false],
	])("is empty for %s", async (_, severities, include) => {
		expect(await problems([[a, [diag(0, "w", Warning)]]], severities, include)).toBe("")
	})

	it("keeps the most severe problems within the limit and says how many were left out", async () => {
		const result = await problems(
			[
				[a, [diag(3, "warn late", Warning), diag(2, "error a", Error), diag(0, "info", Information)]],
				[b, [diag(0, "error b", Error), diag(0, "hint", Hint)]],
			],
			ALL,
			true,
			3,
		)

		expect(result).toBe(
			[
				// Errors first, then by line, across files; each file listed where its first kept problem falls.
				"b.ts",
				"- [Error] 1 | only line : error b",
				"",
				"src/a.ts",
				"- [Error] 3 | z() : error a",
				"- [Warning] 4 | w : warn late",
				"",
				"... 2 more problems omitted to prevent context overflow",
			].join("\n"),
		)
	})

	it.each([[undefined], [0]])("has no limit for a maximum of %s", async (max) => {
		const many = Array.from({ length: 4 }, (_, i) => diag(i, `e${i}`, Error))

		const result = await problems([[a, many]], ALL, true, max)

		expect(result.split("\n")).toHaveLength(5)
		expect(result).not.toContain("omitted")
	})
})

describe("getNewDiagnostics", () => {
	it("returns only the problems that were not there before, per file", () => {
		const a = uri("a.ts")
		const b = uri("b.ts")
		const old: [vscode.Uri, vscode.Diagnostic[]][] = [[a, [diag(0, "old", Error)]]]

		const fresh = getNewDiagnostics(old, [
			[a, [diag(0, "old", Error), diag(1, "new", Error)]],
			[b, [diag(0, "new in b", Warning)]],
		])

		expect(fresh).toEqual([
			[a, [diag(1, "new", Error)]],
			[b, [diag(0, "new in b", Warning)]],
		])
		expect(getNewDiagnostics(old, old)).toEqual([])
	})
})
