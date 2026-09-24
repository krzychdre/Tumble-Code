import os from "os"
import path from "path"

import { render } from "ink-testing-library"

import type { McpServer } from "@roo-code/types"

import McpPanel, { type McpPanelProps } from "../McpPanel.js"

/** Hand the event loop over between keystrokes, the way a terminal delivers them. */
function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 10))
}

/**
 * Wait until `assertion` holds. A key that changes the selection re-renders in
 * a task React schedules, not synchronously, so a fixed sleep raced that render
 * and lost on a loaded machine (CI). Keys that only call a callback (r, space,
 * R) are handled synchronously and need no wait: the handler reads the
 * selection through refs.
 */
function until(assertion: () => void): Promise<void> {
	return vi.waitFor(assertion, { timeout: 10_000, interval: 5 })
}

const GLOBAL_PATH = path.join(os.homedir(), ".roo", "mcp.json")
// The panel keeps the native separator after "~" ("~\.roo\mcp.json" on Windows).
const GLOBAL_PATH_SHOWN = path.join("~", ".roo", "mcp.json")
const PROJECT_PATH = "/work/app/.roo/mcp.json"

function server(overrides: Partial<McpServer> = {}): McpServer {
	return { name: "s", config: "{}", status: "connected", source: "global", tools: [], ...overrides }
}

const SERVERS: McpServer[] = [
	server({
		name: "searxNcrawl",
		tools: [
			{ name: "search", description: "" },
			{ name: "crawl", description: "" },
		],
	}),
	server({ name: "aws", status: "disconnected", disabled: true }),
	server({ name: "broken", source: "project", status: "disconnected", error: "stderr noise\nspawn xyz ENOENT" }),
]

function renderPanel(overrides: Partial<McpPanelProps> = {}) {
	const calls = { restart: [] as string[], toggle: [] as string[], reload: 0 }
	const view = render(
		<McpPanel
			servers={SERVERS}
			globalConfigPath={GLOBAL_PATH}
			projectConfigPath={PROJECT_PATH}
			onRestart={(s) => calls.restart.push(s.name)}
			onToggleDisabled={(s) => calls.toggle.push(s.name)}
			onReload={() => calls.reload++}
			{...overrides}
		/>,
	)
	return { ...view, calls }
}

describe("McpPanel", () => {
	it("lists project servers first, each with its source and state", () => {
		const frame = renderPanel().lastFrame() ?? ""
		const rows = frame.split("\n")

		const broken = rows.findIndex((row) => row.includes("broken"))
		const searx = rows.findIndex((row) => row.includes("searxNcrawl"))
		expect(broken).toBeGreaterThan(-1)
		expect(broken).toBeLessThan(searx)

		expect(rows[broken]).toMatch(/project\s+failed/)
		expect(rows[searx]).toMatch(/global\s+connected · 2 tools/)
		expect(frame).toMatch(/aws\s+global\s+disabled/)
	})

	it("shows the selected server's config file and its last error line", () => {
		const frame = renderPanel().lastFrame() ?? ""
		expect(frame).toContain(`broken · project · ${PROJECT_PATH}`)
		expect(frame).toContain("Error: spawn xyz ENOENT")
		expect(frame).not.toContain("stderr noise")
	})

	it("moves the selection with the arrows and shows the tools of a connected server", async () => {
		const { stdin, lastFrame } = renderPanel()
		stdin.write("\u001B[B") // down: broken -> searxNcrawl
		await until(() => expect(lastFrame() ?? "").toContain(`searxNcrawl · global · ${GLOBAL_PATH_SHOWN}`))
		expect(lastFrame() ?? "").toContain("Tools: search, crawl")
	})

	it("restarts, toggles and reloads with r, space and R", async () => {
		const { stdin, calls } = renderPanel()
		stdin.write("r")
		await flush()
		stdin.write(" ")
		await flush()
		stdin.write("R")
		await flush()
		expect(calls).toEqual({ restart: ["broken"], toggle: ["broken"], reload: 1 })
	})

	it("does not restart a disabled server, but can enable it", async () => {
		const { stdin, calls } = renderPanel()
		stdin.write("\u001B[B")
		await flush()
		stdin.write("\u001B[B") // -> aws (disabled)
		await flush()
		stdin.write("r")
		await flush()
		stdin.write(" ")
		await flush()
		expect(calls.restart).toEqual([])
		expect(calls.toggle).toEqual(["aws"])
	})

	it("follows two arrows that arrive before a re-render (a held key)", async () => {
		const { stdin, calls } = renderPanel()
		stdin.write("\u001B[B")
		stdin.write("\u001B[B")
		await flush()
		stdin.write(" ")
		await flush()
		expect(calls.toggle).toEqual(["aws"])
	})

	it("ignores keys while inactive", async () => {
		const { stdin, calls } = renderPanel({ isActive: false })
		stdin.write("R")
		await flush()
		expect(calls.reload).toBe(0)
	})

	it("says where to add servers when there are none", () => {
		const frame = renderPanel({ servers: [] }).lastFrame() ?? ""
		expect(frame).toContain("No MCP servers configured")
		expect(frame).toContain(`${GLOBAL_PATH_SHOWN} (every project)`)
		expect(frame).toContain(`${PROJECT_PATH} (this project)`)
	})

	it("shows at most eight servers and says how many more there are", () => {
		const many = Array.from({ length: 12 }, (_, i) => server({ name: `srv${String(i).padStart(2, "0")}` }))
		const frame = renderPanel({ servers: many }).lastFrame() ?? ""
		expect(frame).toContain("srv07")
		expect(frame).not.toContain("srv08")
		expect(frame).toContain("↓ 4 more")
	})
})
