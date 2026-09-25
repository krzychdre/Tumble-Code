import path from "path"
import type { Plugin } from "vite"

/**
 * Directories under the extension's `src/` whose code must never ship in the
 * webview: it runs in a browser sandbox with no Node APIs and no `vscode`
 * module. `src/shared` is the one directory the webview may import from.
 *
 * Until CORE-R10 the build graph passed through `src/shared/modes.ts` into
 * `src/core/prompts/sections/custom-instructions.ts` and
 * `src/services/roo-config/index.ts` (which import `path`, `fs/promises`, `os`)
 * and only tree-shaking kept their code out (0 rendered characters). Since
 * SVC-16 an extension-only module anywhere in the graph fails the build, even
 * when it renders to nothing: "happens to be shaken out" is one refactor away
 * from shipping Node code, and Vite has already stubbed its Node imports.
 * The same list guards src/shared at lint time (src/eslint.config.mjs) and in
 * src/__tests__/layering.spec.ts.
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
	/** Extension-only modules in the build graph, or `vscode` imports: the build must fail. */
	violations: string[]
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
	const report: BoundaryReport = { violations: [] }

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
				report.violations.push(
					`${chunk.fileName} has extension-only module ${id} in its build graph (tree-shaken to 0 chars)`,
				)
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

/** Fails the build when the webview build graph reaches extension-only code. */
export function bundleBoundaryPlugin(extensionSrcDir: string): Plugin {
	return {
		name: "webview-bundle-boundary",
		apply: "build",
		generateBundle(_options, bundle) {
			const chunks = Object.values(bundle).flatMap((output) => (output.type === "chunk" ? [output] : []))
			const { violations } = checkBundleBoundary(chunks, extensionSrcDir)

			if (violations.length > 0) {
				this.error(
					`The webview build reaches extension-only code:\n${violations.join("\n")}\n` +
						"Move what the webview needs into src/shared or a package, or stop importing it.",
				)
			}
		},
	}
}
