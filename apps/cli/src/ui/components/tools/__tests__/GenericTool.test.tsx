import { render } from "ink-testing-library"

import { GenericTool } from "../GenericTool.js"

const json = JSON.stringify({ id: 1257452, fields: { "System.State": "In Progress" } }, null, 2)

describe("GenericTool", () => {
	describe("an MCP result", () => {
		const toolData = { tool: "use_mcp_server", path: "azure-devops › wit_work_item", content: json }

		it("hides the result behind a line counter when collapsed", () => {
			const rows = (render(<GenericTool toolData={toolData} />).lastFrame() ?? "").split("\n")

			expect(rows).toHaveLength(2)
			expect(rows[0]).toContain("MCP(azure-devops › wit_work_item)")
			expect(rows[1]).toMatch(/⎿ {2}… \+6 lines \(ctrl\+o\)$/)
			expect(rows.join("\n")).not.toContain("1257452")
		})

		it("prints the whole result when expanded", () => {
			const output = render(<GenericTool toolData={toolData} expanded />).lastFrame()

			expect(output).toContain('"id": 1257452')
			expect(output).toContain('"System.State": "In Progress"')
			expect(output).not.toContain("ctrl+o")
		})
	})

	it("keeps a preview of other tools' results when collapsed", () => {
		const output = render(
			<GenericTool toolData={{ tool: "browser_action", content: "page loaded\ntitle: Example" }} />,
		).lastFrame()

		expect(output).toContain("page loaded")
		expect(output).toContain("title: Example")
	})
})
