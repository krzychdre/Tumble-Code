import type { ConfigEnv, UserConfig } from "vite"

import viteConfig from "../../vite.config"

// The webview loads the build from a deep vscode-resource path, so a
// root-relative asset URL ("/assets/...") misses it. With the default base
// "/" the lazy KaTeX stylesheet 404'd, its preload rejected and every chat
// formula stayed raw TeX.
describe("vite.config base", () => {
	it.each(["production", "nightly"])("builds relative asset URLs in %s mode", async (mode) => {
		const factory = viteConfig as (env: ConfigEnv) => UserConfig | Promise<UserConfig>
		const config = await factory({ mode, command: "build", isSsrBuild: false, isPreview: false })

		expect(config.base).toBe("./")
	})
})
