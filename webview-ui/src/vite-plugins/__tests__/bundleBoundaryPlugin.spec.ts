import path from "path"

import { checkBundleBoundary, type ChunkModules } from "../bundleBoundaryPlugin"

// Built with path so the ids match on Windows too, where "/repo" resolves to "C:\repo".
const REPO = path.resolve("/repo")
const SRC = path.join(REPO, "src")

/** A module id under the repository, in the platform's own separators. */
function id(relative: string): string {
	return path.join(REPO, ...relative.split("/"))
}

/** The same id as the report prints it. */
function shown(relative: string): string {
	return id(relative).replace(/\\/g, "/")
}

/** A chunk holding `modules`, each mapped to its rendered length (default 10 chars). */
function chunk(
	modules: Record<string, number> = {},
	overrides: Partial<Omit<ChunkModules, "modules">> = {},
): ChunkModules {
	const rendered = Object.fromEntries(Object.entries(modules).map(([m, length]) => [m, { renderedLength: length }]))
	return { fileName: "assets/index.js", modules: rendered, imports: [], dynamicImports: [], ...overrides }
}

describe("checkBundleBoundary", () => {
	it("accepts webview code, src/shared, workspace packages and dependencies", () => {
		const report = checkBundleBoundary(
			[
				chunk({
					[id("webview-ui/src/App.tsx")]: 10,
					[id("src/shared/modes.ts")]: 10,
					[id("packages/types/src/index.ts")]: 10,
					[id("node_modules/.pnpm/react@18.3.1/node_modules/react/index.js")]: 10,
				}),
			],
			SRC,
		)

		expect(report).toEqual({ violations: [], treeShaken: [] })
	})

	it("fails on extension-only code that ships, with or without a query suffix", () => {
		const report = checkBundleBoundary(
			[
				chunk(
					{
						[id("src/core/prompts/sections/custom-instructions.ts")]: 120,
						[`${id("src/services/roo-config/index.ts")}?v=1`]: 7,
					},
					{ fileName: "assets/modes-abc.js" },
				),
			],
			SRC,
		)

		expect(report.violations).toEqual([
			`assets/modes-abc.js ships 120 chars of extension-only module ${shown("src/core/prompts/sections/custom-instructions.ts")}`,
			`assets/modes-abc.js ships 7 chars of extension-only module ${shown("src/services/roo-config/index.ts")}`,
		])
	})

	it("only reports extension-only modules that tree-shaking reduced to nothing", () => {
		const report = checkBundleBoundary([chunk({ [id("src/services/roo-config/index.ts")]: 0 })], SRC)

		expect(report).toEqual({ violations: [], treeShaken: [shown("src/services/roo-config/index.ts")] })
	})

	it("matches module ids written with backslashes", () => {
		const windowsStyle = id("src/integrations/terminal/Terminal.ts").replace(/\//g, "\\")

		expect(checkBundleBoundary([chunk({ [windowsStyle]: 10 })], SRC).violations).toHaveLength(1)
	})

	it("does not mistake a sibling directory with the same prefix for extension code", () => {
		// "src/core-like" is not "src/core".
		expect(checkBundleBoundary([chunk({ [id("src/core-like/x.ts")]: 10 })], SRC).violations).toEqual([])
	})

	it("ignores virtual modules", () => {
		expect(checkBundleBoundary([chunk({ "\0vite/preload-helper.js": 10 })], SRC).violations).toEqual([])
	})

	it("fails on static and dynamic imports of vscode", () => {
		const report = checkBundleBoundary(
			[
				chunk({}, { fileName: "a.js", imports: ["vscode"] }),
				chunk({}, { fileName: "b.js", dynamicImports: ["vscode"] }),
			],
			SRC,
		)

		expect(report.violations).toEqual([
			'a.js imports "vscode", which does not exist in the webview',
			'b.js imports "vscode", which does not exist in the webview',
		])
	})
})
