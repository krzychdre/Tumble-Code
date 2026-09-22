import { render } from "ink-testing-library"

import type { ToolRendererProps } from "../types.js"
import { FileWriteTool } from "../FileWriteTool.js"

const SEARCH_REPLACE = [
	"<<<<<<< SEARCH",
	":start_line:17",
	"-------",
	"    rsa_keygen_bits:1024",
	"=======",
	"    rsa_keygen_bits:2048",
	">>>>>>> REPLACE",
].join("\n")

describe("FileWriteTool", () => {
	describe("apply_diff (SEARCH/REPLACE payload)", () => {
		const props: ToolRendererProps = {
			toolData: {
				tool: "appliedDiff",
				path: "tls_util/make_self_signed_certs.sh",
				diff: SEARCH_REPLACE,
				diffStats: { added: 1, removed: 1 },
			},
		}

		it("renders the changed lines with +/- gutters", () => {
			const output = render(<FileWriteTool {...props} />).lastFrame()

			expect(output).toContain("-    rsa_keygen_bits:1024")
			expect(output).toContain("+    rsa_keygen_bits:2048")
		})

		it("hides the SEARCH/REPLACE scaffolding", () => {
			const output = render(<FileWriteTool {...props} />).lastFrame()

			expect(output).not.toContain("<<<<<<< SEARCH")
			expect(output).not.toContain("=======")
			expect(output).not.toContain(">>>>>>> REPLACE")
			expect(output).not.toContain(":start_line:")
		})

		it("shows the start line of each block", () => {
			const output = render(<FileWriteTool {...props} />).lastFrame()

			expect(output).toContain("@@ line 17 @@")
		})

		it("keeps the header, path and diff stats", () => {
			const output = render(<FileWriteTool {...props} />).lastFrame()

			expect(output).toContain("Edit")
			expect(output).toContain("tls_util/make_self_signed_certs.sh")
			expect(output).toContain("+1")
			expect(output).toContain("-1")
		})
	})

	describe("diffs that arrive in `content` instead of `diff`", () => {
		it("renders the unified diff editedExistingFile sends", () => {
			const props: ToolRendererProps = {
				toolData: {
					tool: "editedExistingFile",
					path: "memory/notes.md",
					content: ["@@ -1,3 +1,3 @@", " name: notes", "-description: old", "+description: new"].join("\n"),
					diffStats: { added: 1, removed: 1 },
				},
			}

			const output = render(<FileWriteTool {...props} />).lastFrame()

			expect(output).toContain("-description: old")
			expect(output).toContain("+description: new")
		})

		it("leaves plain file content alone instead of reading it as a diff", () => {
			const props: ToolRendererProps = {
				toolData: {
					tool: "newFileCreated",
					path: "notes.md",
					content: "# Title\n\nPlain prose, no diff here.",
					diffStats: { added: 3, removed: 0 },
				},
			}

			const output = render(<FileWriteTool {...props} />).lastFrame()

			expect(output).toContain("Create File")
			expect(output).not.toContain("Plain prose")
		})
	})

	describe("preview caps", () => {
		const longDiff = [
			"<<<<<<< SEARCH",
			":start_line:1",
			"-------",
			...Array.from({ length: 12 }, (_, i) => `old ${i}`),
			"=======",
			"new",
			">>>>>>> REPLACE",
		].join("\n")

		const secondBlock = ["<<<<<<< SEARCH", ":start_line:40", "-------", "x", "=======", "y", ">>>>>>> REPLACE"]

		it("caps a hunk at 8 lines and counts the rest", () => {
			const props: ToolRendererProps = {
				toolData: { tool: "appliedDiff", path: "a.txt", diff: longDiff },
			}

			const output = render(<FileWriteTool {...props} />).lastFrame()

			expect(output).toContain("old 7")
			expect(output).not.toContain("old 8")
			expect(output).toContain("+5 more lines")
		})

		it("caps the preview at 2 hunks and counts the rest", () => {
			const diff = [SEARCH_REPLACE, ...secondBlock, ...secondBlock].join("\n")
			const props: ToolRendererProps = {
				toolData: { tool: "appliedDiff", path: "a.txt", diff },
			}

			const output = render(<FileWriteTool {...props} />).lastFrame()

			expect(output).toContain("+1 more hunks")
		})

		it("lifts both caps when expanded", () => {
			const props: ToolRendererProps = {
				toolData: { tool: "appliedDiff", path: "a.txt", diff: longDiff },
				expanded: true,
			}

			const output = render(<FileWriteTool {...props} />).lastFrame()

			expect(output).toContain("old 11")
			expect(output).not.toContain("more lines")
		})
	})

	describe("fallbacks", () => {
		it("prints a payload that is not a diff raw", () => {
			const props: ToolRendererProps = {
				toolData: { tool: "appliedDiff", path: "a.txt", diff: "something went sideways" },
			}

			const output = render(<FileWriteTool {...props} />).lastFrame()

			expect(output).toContain("something went sideways")
		})

		it("prints nothing but the header while a block is still streaming", () => {
			const props: ToolRendererProps = {
				toolData: { tool: "appliedDiff", path: "a.txt", diff: "<<<<<<< SEARCH\n:start_line:5\n-------" },
			}

			const output = render(<FileWriteTool {...props} />).lastFrame()

			expect(output).toContain("a.txt")
			expect(output).not.toContain("<<<<<<<")
			expect(output).not.toContain(":start_line:")
		})

		it("still renders the batch-diff summary", () => {
			const props: ToolRendererProps = {
				toolData: {
					tool: "appliedDiff",
					batchDiffs: [
						{ path: "a.ts", diffStats: { added: 2, removed: 1 } },
						{ path: "b.ts", diffStats: { added: 5, removed: 0 } },
					],
				},
			}

			const output = render(<FileWriteTool {...props} />).lastFrame()

			expect(output).toContain("(2 files)")
			expect(output).toContain("a.ts")
			expect(output).toContain("+2 -1")
		})
	})
})
