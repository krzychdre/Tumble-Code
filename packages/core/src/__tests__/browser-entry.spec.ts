// npx vitest run src/__tests__/browser-entry.spec.ts
//
// `@roo-code/core/browser` is bundled into the webview (a browser sandbox with
// no Node APIs) and into the CLI. Every module it reaches, directly or through
// relative imports, must stay free of Node built-ins and of runtime
// dependencies other than the ones listed below. The walk reads the import
// specifiers of the source text, type-only imports included.

import fs from "fs"
import { builtinModules } from "module"
import path from "path"

const srcDir = path.resolve(__dirname, "..")

/** Bare packages a browser-safe module may import. */
const ALLOWED_PACKAGES = new Set(["@roo-code/types"])

function importSpecifiers(file: string): string[] {
	const text = fs.readFileSync(file, "utf8")
	const specifiers: string[] = []
	const patterns = [
		/\bfrom\s+["']([^"']+)["']/g,
		/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
		/^\s*import\s+["']([^"']+)["']/gm,
	]

	for (const pattern of patterns) {
		for (const match of text.matchAll(pattern)) {
			specifiers.push(match[1]!)
		}
	}

	return specifiers
}

/** Resolves "./x.js" to the TypeScript file on disk ("./x.ts" or "./x/index.ts"). */
function resolveRelative(fromFile: string, specifier: string): string {
	const base = path.resolve(path.dirname(fromFile), specifier.replace(/\.js$/, ""))

	for (const candidate of [`${base}.ts`, path.join(base, "index.ts")]) {
		if (fs.existsSync(candidate)) {
			return candidate
		}
	}

	throw new Error(`Cannot resolve ${specifier} from ${fromFile}`)
}

/** Every file reachable from `entry` and every bare specifier they import. */
function walk(entry: string): { files: string[]; packages: string[] } {
	const seen = new Set<string>()
	const packages = new Set<string>()
	const queue = [entry]

	while (queue.length > 0) {
		const file = queue.pop()!

		if (seen.has(file)) {
			continue
		}

		seen.add(file)

		for (const specifier of importSpecifiers(file)) {
			if (specifier.startsWith(".")) {
				queue.push(resolveRelative(file, specifier))
			} else {
				packages.add(specifier)
			}
		}
	}

	return { files: [...seen], packages: [...packages].sort() }
}

describe("@roo-code/core/browser", () => {
	const { files, packages } = walk(path.join(srcDir, "browser.ts"))

	it("reaches its modules (guards against a vacuous pass)", () => {
		expect(files.length).toBeGreaterThan(1)
	})

	it("imports no Node built-in", () => {
		const nodeImports = packages.filter(
			(specifier) => specifier.startsWith("node:") || builtinModules.includes(specifier.split("/")[0]!),
		)

		expect(nodeImports).toEqual([])
	})

	it("imports only the allowed packages", () => {
		expect(packages.filter((specifier) => !ALLOWED_PACKAGES.has(specifier))).toEqual([])
	})
})
