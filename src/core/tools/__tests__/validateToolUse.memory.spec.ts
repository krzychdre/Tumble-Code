import { type ModeConfig } from "@roo-code/types"

import { isToolAllowedForMode } from "../validateToolUse"
import { FileRestrictionError } from "../../../shared/modes"
import { initMemoryPaths, resetMemoryPaths } from "../../memory/paths"

// A custom mode whose edit group is restricted to .md files (mirrors the
// built-in "markdown-editor" mode). The memory carve-out must bypass this
// restriction for writes inside the per-workspace memory dir.
const mdOnlyMode: ModeConfig[] = [
	{
		slug: "md-only",
		name: "Markdown Only",
		roleDefinition: "Only edits .md files",
		groups: ["read", ["edit", { fileRegex: "\\.md$", description: "Only .md files" }]] as any,
	},
]

const GLOBAL_STORAGE = "/home/user/.vscode/ext-storage"
const CWD = "/home/user/my-project"

describe("validateToolUse memory carve-out", () => {
	beforeEach(() => {
		initMemoryPaths(GLOBAL_STORAGE, () => ({}))
	})

	afterEach(() => {
		resetMemoryPaths()
	})

	it("allows a write_to_file inside the memory dir even when mode fileRegex would reject it", () => {
		// Construct a path inside the per-cwd memory dir.
		// getAutoMemPath is memoized; we compute the expected dir manually to
		// match isAutoMemPath's resolution.
		const memDir = `/home/user/.vscode/ext-storage/memory/projects/_home_user_my-project/memory/`
		const memFile = `${memDir}user_role.md`
		const allowed = isToolAllowedForMode(
			"write_to_file",
			"md-only",
			mdOnlyMode,
			undefined,
			{ path: memFile, content: "x" },
			undefined,
			undefined,
			CWD,
		)
		expect(allowed).toBe(true)
	})

	it("still rejects a write outside the memory dir that doesn't match fileRegex", () => {
		expect(() =>
			isToolAllowedForMode(
				"write_to_file",
				"md-only",
				mdOnlyMode,
				undefined,
				{ path: "/workspace/src/foo.ts", content: "x" },
				undefined,
				undefined,
				CWD,
			),
		).toThrow(FileRestrictionError)
	})

	it("allows a .md write outside the memory dir (matches fileRegex normally)", () => {
		const allowed = isToolAllowedForMode(
			"write_to_file",
			"md-only",
			mdOnlyMode,
			undefined,
			{ path: "/workspace/notes.md", content: "x" },
			undefined,
			undefined,
			CWD,
		)
		expect(allowed).toBe(true)
	})

	it("does NOT carve out when cwd is not provided (backward-compatible call sites)", () => {
		// Without the cwd arg, isAutoMemPath can't resolve → carve-out is a no-op.
		const memFile = `/home/user/.vscode/ext-storage/memory/projects/_home_user_my-project/memory/user_role.md`
		// The .md file matches fileRegex anyway, so it's allowed regardless.
		const allowed = isToolAllowedForMode("write_to_file", "md-only", mdOnlyMode, undefined, {
			path: memFile,
			content: "x",
		})
		expect(allowed).toBe(true)
	})

	it("does not carve out a non-.md file outside the memory dir (fileRegex still applies)", () => {
		expect(() =>
			isToolAllowedForMode(
				"write_to_file",
				"md-only",
				mdOnlyMode,
				undefined,
				{ path: "/workspace/image.png", content: "x" },
				undefined,
				undefined,
				CWD,
			),
		).toThrow(FileRestrictionError)
	})
})
