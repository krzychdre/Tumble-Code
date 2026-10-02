// npx vitest run __tests__/user-visible-brand.spec.ts
//
// D14: the product is "Tumble Code". Text a user can see (notifications,
// errors, panel and terminal titles, code action titles, settings
// descriptions, translations, the name the extension gives itself to MCP
// servers and OpenRouter) must not say "Roo Code" any more.
//
// The check reads the source text: every string literal in the production
// TypeScript of the extension, the webview, the CLI and the shared packages,
// every value of the settings descriptions (package.nls*.json) and of the
// translation files, and the webview's index.html. Internal names are not
// string literals that contain "Roo Code" (package ids are "@tumble-code/...",
// variables ROO_*, identifiers such as getTumbleCodeApiUrl), so they are untouched by this check.
// The old CamelCase name is guarded separately in no-old-product-name.spec.ts.

import fs from "fs"
import path from "path"

import { DEFAULT_HEADERS } from "../api/providers/constants"
import { TITLES } from "../activate/CodeActionProvider"

const repoRoot = path.resolve(__dirname, "..", "..")

const OLD_BRAND = "Roo Code"

// Files that name the old product on purpose.
const ALLOWED_FILES = new Set([
	// The one-shot import of a previous Roo Code installation's settings.
	"src/utils/migrateFromRooCline.ts",
	// Git author of the hidden shadow repository that stores checkpoints; the
	// user never sees it, and existing shadow repositories already carry it.
	"src/services/checkpoints/ShadowCheckpointService.ts",
])

// Translation keys whose text is about the fork's lineage.
const ALLOWED_TRANSLATION_KEY = /^announcement\.handoff\./

const SOURCE_ROOTS = ["src", "webview-ui/src", "apps/cli/src", "packages/cloud/src", "packages/core/src"]

function toPosix(file: string): string {
	return path.relative(repoRoot, file).split(path.sep).join("/")
}

function isTestPath(relative: string): boolean {
	return (
		/(^|\/)(__tests__|__mocks__|test-utils|node_modules|dist|out)(\/|$)/.test(relative) ||
		/\.(spec|test)\.tsx?$/.test(relative)
	)
}

function walk(dir: string, accept: (relative: string) => boolean, out: string[] = []): string[] {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name)
		const relative = toPosix(full)
		if (entry.isDirectory()) {
			if (!isTestPath(relative + "/")) {
				walk(full, accept, out)
			}
		} else if (accept(relative)) {
			out.push(full)
		}
	}
	return out
}

// A string literal on one line: "...", '...' or `...`.
const STRING_LITERAL = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\\n]|\\.)*`/g

function literalOffenders(): string[] {
	const offenders: string[] = []
	for (const root of SOURCE_ROOTS) {
		const files = walk(
			path.join(repoRoot, root),
			(relative) => /\.tsx?$/.test(relative) && !relative.endsWith(".d.ts") && !isTestPath(relative),
		)
		for (const file of files) {
			const relative = toPosix(file)
			if (ALLOWED_FILES.has(relative)) {
				continue
			}
			fs.readFileSync(file, "utf8")
				.split("\n")
				.forEach((line, index) => {
					for (const literal of line.match(STRING_LITERAL) ?? []) {
						if (literal.includes(OLD_BRAND)) {
							offenders.push(`${relative}:${index + 1}: ${literal}`)
						}
					}
				})
		}
	}
	return offenders
}

function jsonValueOffenders(file: string, allowKey?: RegExp): string[] {
	const offenders: string[] = []
	const visit = (value: unknown, key: string) => {
		if (typeof value === "string") {
			if (value.includes(OLD_BRAND) && !(allowKey && allowKey.test(key))) {
				offenders.push(`${toPosix(file)}: ${key}`)
			}
		} else if (value && typeof value === "object") {
			for (const [child, nested] of Object.entries(value)) {
				visit(nested, key ? `${key}.${child}` : child)
			}
		}
	}
	visit(JSON.parse(fs.readFileSync(file, "utf8")), "")
	return offenders
}

describe("user-visible text says Tumble Code, not Roo Code (D14)", () => {
	it("no string literal in production source names Roo Code", () => {
		expect(literalOffenders()).toEqual([])
	})

	it("no settings description (package.nls*.json) names Roo Code", () => {
		const srcDir = path.join(repoRoot, "src")
		const files = fs
			.readdirSync(srcDir)
			.filter((name) => /^package\.nls(\.[\w-]+)?\.json$/.test(name))
			.map((name) => path.join(srcDir, name))

		expect(files.length).toBeGreaterThan(1)
		expect(files.flatMap((file) => jsonValueOffenders(file))).toEqual([])
	})

	it("no translation names Roo Code outside the lineage announcement", () => {
		const files = ["src/i18n/locales", "webview-ui/src/i18n/locales"].flatMap((root) =>
			walk(path.join(repoRoot, root), (relative) => relative.endsWith(".json")),
		)

		expect(files.length).toBeGreaterThan(10)
		expect(files.flatMap((file) => jsonValueOffenders(file, ALLOWED_TRANSLATION_KEY))).toEqual([])
	})

	it("the webview page title is Tumble Code", () => {
		const html = fs.readFileSync(path.join(repoRoot, "webview-ui", "index.html"), "utf8")

		expect(html).toContain("<title>Tumble Code</title>")
	})

	it("code actions and the OpenRouter app title use the Tumble Code name", () => {
		expect(TITLES.EXPLAIN).toBe("Explain with Tumble Code")
		expect(TITLES.NEW_TASK).toBe("New Tumble Code Task")
		expect(DEFAULT_HEADERS["X-Title"]).toBe("Tumble Code")
	})
})
