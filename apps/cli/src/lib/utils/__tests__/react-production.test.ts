import { execFileSync } from "child_process"
import path from "path"
import { pathToFileURL } from "url"

const CLI_ROOT = path.resolve(__dirname, "../../../..")
const HELPER = path.resolve(__dirname, "../react-production.ts")

// Renders an ink component whose prop changes 20 times, in a process of its
// own because React picks its build once per process. Reports the performance
// measures left behind and the NODE_ENV the process ends with.
const RENDER_PROBE = `
if (process.env.PROBE_HELPER) {
	const { loadReactProductionBuilds } = await import(process.env.PROBE_HELPER)
	await loadReactProductionBuilds()
}
const { createElement } = await import("react")
const { render, Text } = await import("ink")
const { Writable } = await import("node:stream")
const stdout = Object.assign(new Writable({ write: (_chunk, _encoding, done) => done() }), { columns: 80, rows: 24 })
const Row = ({ content }) => createElement(Text, null, content)
const app = render(createElement(Row, { content: "x" }), { stdout, debug: true, patchConsole: false, exitOnCtrlC: false })
for (let i = 0; i < 20; i++) {
	app.rerender(createElement(Row, { content: "x".repeat(i + 2) }))
	await new Promise((resolve) => setTimeout(resolve, 5))
}
app.unmount()
console.log(JSON.stringify({ measures: performance.getEntriesByType("measure").length, nodeEnv: process.env.NODE_ENV ?? null }))
process.exit(0)
`

function renderProbe(options: { helper: boolean; nodeEnv?: string }): { measures: number; nodeEnv: string | null } {
	// vitest runs with NODE_ENV=test, so the child's value is always explicit.
	const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: options.nodeEnv }

	if (options.nodeEnv === undefined) {
		delete env.NODE_ENV
	}

	if (options.helper) {
		// import() takes a URL: a bare "D:\..." path reads as scheme "d:" on Windows.
		env.PROBE_HELPER = pathToFileURL(HELPER).href
	}

	const output = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", RENDER_PROBE], {
		cwd: CLI_ROOT,
		env,
		encoding: "utf8",
	})

	return JSON.parse(output.trim().split("\n").at(-1)!)
}

describe("loadReactProductionBuilds", () => {
	// The control: without the helper the development reconciler records a
	// measure per commit. If this starts failing, React stopped doing that and
	// the helper may no longer be needed.
	it("leaves the development builds recording a measure per render without it", () => {
		expect(renderProbe({ helper: false }).measures).toBeGreaterThan(0)
	})

	it("renders with the production builds, which record no measures", () => {
		expect(renderProbe({ helper: true })).toEqual({ measures: 0, nodeEnv: null })
	})

	it("uses the production builds even when the shell exports NODE_ENV=development, and restores it", () => {
		expect(renderProbe({ helper: true, nodeEnv: "development" })).toEqual({ measures: 0, nodeEnv: "development" })
	})
})
