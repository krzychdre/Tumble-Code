import { exposeSourceMapsForDebugging, initializeSourceMaps } from "../sourceMapInitializer"

describe("initializeSourceMaps", () => {
	afterEach(() => {
		vi.unstubAllEnvs()
		document.head.innerHTML = ""
		document.body.innerHTML = ""
	})

	it("preloads only the source map file the build writes next to each script", () => {
		vi.stubEnv("NODE_ENV", "production")
		vi.spyOn(console, "debug").mockImplementation(() => {})
		const script = document.createElement("script")
		script.src = "https://file+.vscode-resource.vscode-cdn.net/ext/webview-ui/build/assets/index.js"
		document.body.appendChild(script)

		initializeSourceMaps()

		const preloads = Array.from(document.head.querySelectorAll<HTMLLinkElement>("link[rel=preload]"), (l) => l.href)
		expect(preloads).toEqual([`${script.src}.map`])
	})
})

describe("exposeSourceMapsForDebugging", () => {
	afterEach(() => {
		vi.unstubAllEnvs()
		delete (window as any).__applySourceMaps
		vi.restoreAllMocks()
	})

	it("exposes only the manual source-map helper on window", () => {
		vi.stubEnv("NODE_ENV", "production")
		vi.spyOn(console, "debug").mockImplementation(() => {})

		exposeSourceMapsForDebugging()

		expect(typeof (window as any).__applySourceMaps).toBe("function")
		expect((window as any).__testSourceMaps).toBeUndefined()
		expect((window as any).__checkSourceMap).toBeUndefined()
	})
})
