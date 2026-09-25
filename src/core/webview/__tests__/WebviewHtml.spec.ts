// pnpm --filter tumble-code test core/webview/__tests__/WebviewHtml.spec.ts

import axios from "axios"
import type * as vscode from "vscode"

import { getHmrHtml, getProductionHtml, openRouterOrigin, type WebviewHtmlOptions } from "../WebviewHtml"

vi.mock("vscode", () => ({
	Uri: {
		joinPath: vi.fn((base: any, ...parts: string[]) => ({ path: [base?.fsPath, ...parts].join("/") })),
	},
}))

vi.mock("../getNonce", () => ({ getNonce: () => "NONCE" }))

vi.mock("axios", () => ({ default: { get: vi.fn() } }))

const realFs = require("fs") as typeof import("fs")

const webview = {
	cspSource: "CSP",
	asWebviewUri: (uri: any) => `res:${uri.path}`,
} as unknown as vscode.Webview

const base: WebviewHtmlOptions = {
	webview,
	extensionUri: { fsPath: "/ext" } as unknown as vscode.Uri,
	title: "Panel",
}

const cspOf = (html: string) => html.match(/Content-Security-Policy" content="([^"]*)"/)![1]

describe("WebviewHtml", () => {
	const spies: Array<{ mockRestore(): void }> = []

	beforeEach(() => {
		vi.mocked(axios.get).mockReset().mockResolvedValue({})
		spies.push(
			vi.spyOn(realFs, "existsSync").mockReturnValue(false),
			vi.spyOn(console, "log").mockImplementation(() => {}),
		)
	})

	afterEach(() => {
		while (spies.length) spies.pop()!.mockRestore()
	})

	describe("getProductionHtml", () => {
		it("builds the CSP with the extra connect origins before the Requesty origin", () => {
			expect(cspOf(getProductionHtml({ ...base, connectOrigins: ["https://openrouter.ai"] }))).toBe(
				"default-src 'none'; font-src CSP data:; style-src CSP 'unsafe-inline'; img-src CSP https://storage.googleapis.com https://img.clerk.com data:; media-src CSP; script-src CSP 'wasm-unsafe-eval' 'nonce-NONCE' 'strict-dynamic'; connect-src CSP https://openrouter.ai https://api.requesty.ai;",
			)
			expect(cspOf(getProductionHtml(base))).toContain("connect-src CSP https://api.requesty.ai;")
		})

		it("loads the built bundle with the nonce and sets the title", () => {
			const html = getProductionHtml(base)
			expect(html).toContain(
				`<script nonce="NONCE" type="module" src="res:/ext/webview-ui/build/assets/index.js"></script>`,
			)
			expect(html).toContain("<title>Panel</title>")
			expect(html).not.toContain("PLAN_REVIEW_MODE")
		})

		it("flags plan review mode in the boot script", () => {
			expect(getProductionHtml({ ...base, planReviewMode: true })).toContain("window.PLAN_REVIEW_MODE = true")
		})
	})

	describe("getHmrHtml", () => {
		it("points at the dev server and adds the analytics origins to script-src and connect-src", async () => {
			const html = await getHmrHtml({
				...base,
				connectOrigins: ["https://openrouter.ai"],
				hmrAnalyticsOrigins: ["https://*.posthog.com"],
			})
			expect(axios.get).toHaveBeenCalledWith("http://localhost:5173")
			expect(html).toContain(`<script type="module" src="http://localhost:5173/src/index.tsx"></script>`)
			const csp = cspOf(html)
			expect(csp).toContain(
				"script-src 'unsafe-eval' CSP https://* https://*.posthog.com http://localhost:5173 http://0.0.0.0:5173 'nonce-NONCE'",
			)
			expect(csp).toContain(
				"connect-src CSP https://openrouter.ai https://* https://*.posthog.com ws://localhost:5173",
			)
		})

		it("reads the port from the .vite-port file", async () => {
			spies.push(
				vi.spyOn(realFs, "existsSync").mockReturnValue(true),
				vi.spyOn(realFs, "readFileSync").mockReturnValue("6000\n" as any),
			)
			const html = await getHmrHtml(base)
			expect(axios.get).toHaveBeenCalledWith("http://localhost:6000")
			expect(html).toContain("http://localhost:6000/@react-refresh")
		})

		it("falls back to the production HTML and reports it when the dev server is down", async () => {
			vi.mocked(axios.get).mockRejectedValue(new Error("ECONNREFUSED"))
			const onDevServerMissing = vi.fn()
			const html = await getHmrHtml({ ...base, onDevServerMissing })
			expect(onDevServerMissing).toHaveBeenCalledTimes(1)
			expect(html).toBe(getProductionHtml(base))
		})
	})

	it("openRouterOrigin keeps only the scheme and host, defaulting to openrouter.ai", () => {
		expect(openRouterOrigin(undefined)).toBe("https://openrouter.ai")
		expect(openRouterOrigin("")).toBe("https://openrouter.ai")
		expect(openRouterOrigin("https://router.example.com/api/v1")).toBe("https://router.example.com")
		expect(openRouterOrigin("not a url")).toBe("https://openrouter.ai")
	})
})
