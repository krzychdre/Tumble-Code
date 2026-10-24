// pnpm --filter tumble-code test core/webview/__tests__/PlanReviewPanel.html.spec.ts
//
// The HTML itself is pinned in WebviewHtml.spec; this pins what the plan review
// panel passes to it in production and development (HMR) mode.

import * as vscode from "vscode"
import axios from "axios"

import { PlanReviewPanel } from "../PlanReviewPanel"

vi.mock("vscode", () => ({
	Uri: {
		joinPath: vi.fn((base: any, ...parts: string[]) => ({ path: [base?.fsPath, ...parts].join("/") })),
		file: vi.fn((fsPath: string) => ({ fsPath })),
	},
	ViewColumn: { Active: -1 },
	window: {
		createWebviewPanel: vi.fn(),
		showErrorMessage: vi.fn(),
	},
	workspace: { createFileSystemWatcher: vi.fn() },
	commands: { executeCommand: vi.fn() },
	env: { language: "en" },
	RelativePattern: vi.fn(),
}))

vi.mock("../ClineProvider", () => ({ ClineProvider: {} }))

vi.mock("../getNonce", () => ({ getNonce: () => "TESTNONCE0123456789abcdefghijklm" }))

vi.mock("axios", () => ({ default: { get: vi.fn() }, get: vi.fn() }))

// The HMR path may load axios and the port file through `require`, which
// bypasses vi.mock; the CJS objects are shared, so spies on them cover it.
const cjsAxios = require("axios") as { get: (...args: unknown[]) => Promise<unknown> }
const realFs = require("fs") as typeof import("fs")

const makePanel = () => {
	let onDispose: (() => void) | undefined
	const panel = {
		webview: {
			html: "",
			cspSource: "vscode-webview://test-csp-source",
			asWebviewUri: vi.fn((uri: any) => `vscode-resource:${uri.path}`),
			onDidReceiveMessage: vi.fn(),
			postMessage: vi.fn(),
		},
		onDidDispose: vi.fn((cb: () => void) => {
			onDispose = cb
		}),
		reveal: vi.fn(),
		dispose: () => onDispose?.(),
	}
	return panel
}

const context = { extensionUri: { fsPath: "/ext" } } as unknown as vscode.ExtensionContext

describe("PlanReviewPanel webview HTML", () => {
	const spies: Array<{ mockRestore(): void }> = []
	let panel: ReturnType<typeof makePanel>
	let devServerUp = true

	const stubPortFile = (port: string | undefined) => {
		const originalExistsSync = realFs.existsSync
		const originalReadFileSync = realFs.readFileSync
		const isPortFile = (p: unknown) => typeof p === "string" && p.endsWith(".vite-port")
		spies.push(
			vi
				.spyOn(realFs, "existsSync")
				.mockImplementation((p) => (isPortFile(p) ? port !== undefined : originalExistsSync(p))),
			vi
				.spyOn(realFs, "readFileSync")
				.mockImplementation(((p: any, ...rest: any[]) =>
					isPortFile(p) ? port : (originalReadFileSync as any)(p, ...rest)) as any),
		)
	}

	const render = async (development: boolean) => {
		if (development) {
			process.env.VITE_PORT = "1"
		}
		await PlanReviewPanel.open(context, { markdown: "# Plan" })
		return panel.webview.html
	}

	beforeEach(() => {
		devServerUp = true
		const get = async (url: unknown) => {
			if (!devServerUp) throw new Error("ECONNREFUSED")
			return { url }
		}
		vi.mocked(axios.get).mockImplementation(get as any)
		spies.push(vi.spyOn(cjsAxios, "get").mockImplementation(get))
		stubPortFile(undefined)
		panel = makePanel()
		vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(panel as any)
		vi.mocked(vscode.window.showErrorMessage).mockClear()
	})

	afterEach(() => {
		// Content mode keeps one shared panel; dispose it so the next test opens a fresh one.
		panel.dispose()
		delete process.env.VITE_PORT
		while (spies.length) spies.pop()!.mockRestore()
	})

	test("production loads the built bundle in plan review mode under the Plan Review title", async () => {
		const html = await render(false)

		expect(html).toContain("<title>Plan Review</title>")
		expect(html).toContain("window.PLAN_REVIEW_MODE = true")
		expect(html).toContain('src="vscode-resource:/ext/webview-ui/build/assets/index.js"')
	})

	test("development is served by the dev server", async () => {
		const html = await render(true)

		expect(html).toContain("http://localhost:5173/src/index.tsx")
		expect(html).toContain("window.PLAN_REVIEW_MODE = true")
	})

	test("development without a dev server falls back to production silently", async () => {
		devServerUp = false

		const html = await render(true)

		expect(html).toContain('src="vscode-resource:/ext/webview-ui/build/assets/index.js"')
		expect(vscode.window.showErrorMessage).not.toHaveBeenCalled()
	})
})
