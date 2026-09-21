import { render } from "ink-testing-library"

import type { ToolRendererProps } from "../types.js"
import { FileReadTool } from "../FileReadTool.js"

describe("FileReadTool", () => {
	describe("single file read", () => {
		it("renders ● Read(path) header with result connector", () => {
			const props: ToolRendererProps = {
				toolData: {
					tool: "read_file",
					path: "src/foo.ts",
					content: "line1\nline2\nline3",
				},
			}

			const { lastFrame } = render(<FileReadTool {...props} />)
			const output = lastFrame()

			// ● Read(path) + ⎿ result connector
			expect(output).toContain("Read")
			expect(output).toContain("src/foo.ts")
			expect(output).toContain("⎿")
			expect(output).toContain("3 lines")
		})

		it("shows outside workspace badge when isOutsideWorkspace is true", () => {
			const props: ToolRendererProps = {
				toolData: {
					tool: "read_file",
					path: "/etc/hosts",
					content: "hosts content",
					isOutsideWorkspace: true,
				},
			}

			const { lastFrame } = render(<FileReadTool {...props} />)
			const output = lastFrame()

			expect(output).toContain("Read")
			expect(output).toContain("/etc/hosts")
			expect(output).toContain("outside workspace")
		})

		it("renders List display name for list tools", () => {
			const props: ToolRendererProps = {
				toolData: {
					tool: "listFilesRecursive",
					path: "src/",
					content: "file1\nfile2\nfile3",
				},
			}

			const { lastFrame } = render(<FileReadTool {...props} />)
			const output = lastFrame()

			expect(output).toContain("List")
			expect(output).toContain("src/")
			expect(output).toContain("3 entries")
		})
	})

	describe("batch file reads", () => {
		it("renders ● Read (N files) header for batch reads", () => {
			const props: ToolRendererProps = {
				toolData: {
					tool: "read_file",
					batchFiles: [
						{ path: "a.ts", lineSnippet: "L1" },
						{ path: "b.ts", lineSnippet: "L2" },
						{ path: "c.ts" },
					],
				},
			}

			const { lastFrame } = render(<FileReadTool {...props} />)
			const output = lastFrame()

			expect(output).toContain("Read")
			expect(output).toContain("(3 files)")
			expect(output).toContain("a.ts")
			expect(output).toContain("b.ts")
			expect(output).toContain("c.ts")
		})

		it("shows +N more when batch exceeds 10 files", () => {
			const batch = Array.from({ length: 15 }, (_, i) => ({ path: `file${i}.ts` }))

			const props: ToolRendererProps = {
				toolData: {
					tool: "read_file",
					batchFiles: batch,
				},
			}

			const { lastFrame } = render(<FileReadTool {...props} />)
			const output = lastFrame()

			expect(output).toContain("(15 files)")
			expect(output).toContain("+5 more")
		})

		it("shows outside workspace badge on batch file entries", () => {
			const props: ToolRendererProps = {
				toolData: {
					tool: "read_file",
					batchFiles: [{ path: "/etc/hosts", isOutsideWorkspace: true }],
				},
			}

			const { lastFrame } = render(<FileReadTool {...props} />)
			const output = lastFrame()

			expect(output).toContain("outside workspace")
		})
	})
})
