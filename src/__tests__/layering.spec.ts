// npx vitest run __tests__/layering.spec.ts
//
// CORE-R10: import edges that must not come back.
//
// 1. ClineProvider must not import from src/activate: activate/registerCommands
//    constructs ClineProvider, so the edge back is a real runtime cycle. The
//    panel references live in core/webview/panelRegistry instead.
// 2. src/shared is bundled into the webview (the `@roo/*` alias), so no file
//    in it may import `vscode` or extension code (CORE-R10 fixed shared/modes.ts,
//    SVC-16 moved the last two vscode-bound files out and widened the check).
// 3. Services depend on narrow provider/task interfaces, not on the
//    ClineProvider and Task classes.
//
// The check reads the import specifiers of the source text (static imports,
// re-exports and dynamic imports, type-only ones included).

import fs from "fs"
import path from "path"

const srcDir = path.resolve(__dirname, "..")

function importSpecifiers(relativeFile: string): string[] {
	const text = fs.readFileSync(path.join(srcDir, relativeFile), "utf8")
	const specifiers: string[] = []
	const patterns = [
		/\bfrom\s+["']([^"']+)["']/g,
		/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
		/^\s*import\s+["']([^"']+)["']/gm,
	]

	for (const pattern of patterns) {
		for (const match of text.matchAll(pattern)) {
			specifiers.push(match[1])
		}
	}

	return specifiers
}

/** Resolves a relative specifier to a path under src/, e.g. "core/webview/ClineProvider". */
function resolved(relativeFile: string, specifier: string): string {
	if (!specifier.startsWith(".")) {
		return specifier
	}

	return path
		.relative(srcDir, path.resolve(path.dirname(path.join(srcDir, relativeFile)), specifier))
		.replace(/\\/g, "/")
}

function resolvedImports(relativeFile: string): string[] {
	return importSpecifiers(relativeFile).map((specifier) => resolved(relativeFile, specifier))
}

/** Top-level src/ directories that never reach the webview bundle (mirrors webview-ui's bundleBoundaryPlugin). */
const EXTENSION_ONLY = /^(activate|api|core|extension|i18n|integrations|services|utils|workers)(\/|$)/

describe("layering (CORE-R10)", () => {
	it("ClineProvider does not import from src/activate", () => {
		const offending = resolvedImports("core/webview/ClineProvider.ts").filter((target) =>
			target.startsWith("activate/"),
		)

		expect(offending).toEqual([])
	})

	it("no src/shared file imports vscode or extension code", () => {
		const sharedFiles = fs
			.readdirSync(path.join(srcDir, "shared"), { recursive: true, encoding: "utf8" })
			.map((file) => `shared/${file.replace(/\\/g, "/")}`)
			.filter((file) => /\.tsx?$/.test(file) && !file.includes("__tests__/"))

		// Guards against a vacuous pass if the directory walk ever finds nothing.
		expect(sharedFiles).toContain("shared/modes.ts")

		const offending = sharedFiles.flatMap((file) =>
			resolvedImports(file)
				.filter((target) => target === "vscode" || EXTENSION_ONLY.test(target))
				.map((target) => `${file} -> ${target}`),
		)

		expect(offending).toEqual([])
	})

	it.each([
		"services/mcp/McpHub.ts",
		"services/mcp/McpServerManager.ts",
		"integrations/workspace/WorkspaceTracker.ts",
		"integrations/editor/DiffViewProvider.ts",
		"integrations/editor/DiagnosticsCollector.ts",
	])("%s does not import the ClineProvider or Task classes", (file) => {
		const offending = resolvedImports(file).filter(
			(target) => target === "core/webview/ClineProvider" || target === "core/task/Task",
		)

		expect(offending).toEqual([])
	})
})
