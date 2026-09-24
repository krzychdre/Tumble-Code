import path from "path"
import type { Plugin } from "vite"

/**
 * Directories under the extension's `src/` whose code must never ship in the
 * webview: it runs in a browser sandbox with no Node APIs and no `vscode`
 * module. `src/shared` is the one directory the webview may import from.
 *
 * Today the build graph does pass through `src/shared/modes.ts` into
 * `src/core/prompts/sections/custom-instructions.ts` and
 * `src/services/roo-config/index.ts` (which import `path`, `fs/promises`, `os`),
 * and only tree-shaking keeps their code out: both land in the chunk with 0
 * rendered characters. This guard turns "happens to be shaken out" into "fails
 * the build as soon as any of it ships", and warns about the shaken-out ones.
 */
const EXTENSION_ONLY_DIRS = [
	"activate",
	"api",
	"core",
	"extension",
	"i18n",
	"integrations",
	"services",
	"utils",
	"workers",
]

/** The parts of a Rollup/Rolldown output chunk this check reads. */
export interface ChunkModules {
	fileName: string
	/** Every module placed in the chunk, with how much of its code survived tree-shaking. */
	modules: Readonly<Record<string, { renderedLength: number }>>
	imports: readonly string[]
	dynamicImports: readonly string[]
}

export interface BoundaryReport {
	/** Extension code or `vscode` imports that ship in the bundle: the build must fail. */
	violations: string[]
	/** Extension-only modules that are in the build graph but render to nothing. */
	treeShaken: string[]
}

function toPosix(p: string): string {
	return p.replace(/\\/g, "/")
}

/**
 * Checks the given chunks against the webview boundary.
 *
 * @param extensionSrcDir absolute path of the extension's `src/` directory
 */
export function checkBundleBoundary(chunks: readonly ChunkModules[], extensionSrcDir: string): BoundaryReport {
	const forbiddenPrefixes = EXTENSION_ONLY_DIRS.map((dir) => toPosix(path.join(extensionSrcDir, dir)) + "/")
	const report: BoundaryReport = { violations: [], treeShaken: [] }

	for (const chunk of chunks) {
		for (const [rawId, { renderedLength }] of Object.entries(chunk.modules)) {
			// Virtual modules start with "\0"; ids can carry a "?query" suffix.
			if (rawId.startsWith("\0")) {
				continue
			}

			const id = toPosix(rawId.split("?")[0])

			if (!forbiddenPrefixes.some((prefix) => id.startsWith(prefix))) {
				continue
			}

			if (renderedLength > 0) {
				report.violations.push(`${chunk.fileName} ships ${renderedLength} chars of extension-only module ${id}`)
			} else {
				report.treeShaken.push(id)
			}
		}

		for (const external of [...chunk.imports, ...chunk.dynamicImports]) {
			if (external === "vscode") {
				report.violations.push(`${chunk.fileName} imports "vscode", which does not exist in the webview`)
			}
		}
	}

	return report
}

/** Fails the build when the webview bundle ships extension-only code. */
export function bundleBoundaryPlugin(extensionSrcDir: string): Plugin {
	return {
		name: "webview-bundle-boundary",
		apply: "build",
		generateBundle(_options, bundle) {
			const chunks = Object.values(bundle).flatMap((output) => (output.type === "chunk" ? [output] : []))
			const { violations, treeShaken } = checkBundleBoundary(chunks, extensionSrcDir)

			if (treeShaken.length > 0) {
				this.warn(
					`${treeShaken.length} extension-only module(s) are in the webview build graph and only ` +
						`tree-shaking keeps their code out:\n${treeShaken.join("\n")}`,
				)
			}

			if (violations.length > 0) {
				this.error(
					`The webview bundle ships extension-only code:\n${violations.join("\n")}\n` +
						"Move what the webview needs into src/shared or a package, or stop importing it.",
				)
			}
		},
	}
}
