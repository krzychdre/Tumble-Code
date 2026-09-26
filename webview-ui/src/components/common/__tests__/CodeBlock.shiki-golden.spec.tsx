// Golden renders of CodeBlock and highlightHunks with the REAL Shiki (every
// other CodeBlock spec mocks it), so a Shiki bump shows its visible effect as
// a diff to review: token colors per theme, grammar changes, the classes our
// transformers set, language aliases and the list of bundled languages and
// themes we can reach.
//
// The expected output lives in __golden__/CodeBlock.shiki.golden.json.
// Regenerate it with UPDATE_GOLDEN=1 and review the diff before committing.

import fs from "fs"
import path from "path"
import { renderToStaticMarkup } from "react-dom/server"
import { bundledLanguages, bundledThemes } from "shiki"
import { render, waitFor } from "@/utils/test-utils"

import { highlightHunks } from "@src/utils/highlightDiff"
import { normalizeLanguage } from "@src/utils/highlighter"

import CodeBlock from "../CodeBlock"

vi.mock("../../../i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

const CASES: Array<{ name: string; language: string; source: string }> = [
	{
		name: "typescript",
		language: "typescript",
		source: "const a: number = 1\nexport function f(x: string) {\n\treturn `v=${x}`\n}",
	},
	{ name: "ts alias", language: "ts", source: "type T = { a?: string } // note" },
	{ name: "tsx", language: "tsx", source: 'export const A = () => <div className="x">{1}</div>' },
	{ name: "python", language: "py", source: 'def f(x: int) -> str:\n    return f"{x}"  # c' },
	{ name: "shell", language: "bash", source: 'for f in *.ts; do echo "$f" | grep -c x; done' },
	{ name: "json", language: "json", source: '{ "a": [1, true, null], "b": "s" }' },
	{ name: "diff", language: "diff", source: "--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new" },
	{ name: "c++ alias", language: "cpp", source: "#include <vector>\nint main() { return 0; }" },
	{ name: "c# alias", language: "cs", source: 'public class A { string B => "c"; }' },
	{ name: "dockerfile alias", language: "dockerfile", source: "FROM node:22\nRUN pnpm i" },
	{ name: "yaml alias", language: "yml", source: "a: 1\nb: [x, y] # c" },
	{ name: "sql alias", language: "postgres", source: "SELECT id FROM t WHERE a = 'x';" },
	{ name: "markdown", language: "md", source: "# Title\n\n- item `code`" },
	{ name: "plain text", language: "text", source: "just <text> & more" },
	{ name: "unknown language", language: "nosuchlang", source: "x = 1" },
]

// styled-components names its classes after a per-process counter.
const normalize = (html: string) => html.replace(/\bsc-[A-Za-z0-9]+( [A-Za-z0-9]+)?\b/g, "sc-styled")

const GOLDEN_FILE = path.join(__dirname, "__golden__", "CodeBlock.shiki.golden.json")
const UPDATE = process.env.UPDATE_GOLDEN === "1"
const golden: Record<string, unknown> = fs.existsSync(GOLDEN_FILE)
	? JSON.parse(fs.readFileSync(GOLDEN_FILE, "utf8"))
	: {}
const actual: Record<string, unknown> = {}

const check = (key: string, value: unknown) => {
	actual[key] = value
	if (!UPDATE) expect(value).toEqual(golden[key])
}

describe("Shiki golden renders", () => {
	beforeAll(() => {
		vi.spyOn(console, "warn").mockImplementation(() => {})
	})

	afterAll(() => {
		if (UPDATE) {
			fs.mkdirSync(path.dirname(GOLDEN_FILE), { recursive: true })
			const sorted = Object.fromEntries(
				Object.keys(actual)
					.sort()
					.map((k) => [k, actual[k]]),
			)
			fs.writeFileSync(GOLDEN_FILE, JSON.stringify(sorted, null, "\t") + "\n")
		}
	})

	it("bundles the same languages and themes", () => {
		check("bundled languages", Object.keys(bundledLanguages).sort())
		check("bundled themes", Object.keys(bundledThemes).sort())
	})

	it("maps every language alias to a language Shiki bundles", () => {
		const aliases = [
			"sh",
			"zsh",
			"console",
			"js",
			"ts",
			"py",
			"rb",
			"md",
			"cpp",
			"cc",
			"cs",
			"csharp",
			"htm",
			"yml",
		]
		const more = ["dockerfile", "styles", "jsonc", "json5", "xaml", "svg", "mysql", "postgres", "plsql"]
		const unmapped = [...aliases, ...more]
			.map((alias) => `${alias} -> ${normalizeLanguage(alias)}`)
			.filter((pair) => !(pair.split(" -> ")[1] in bundledLanguages))
		expect(unmapped).toEqual([])
	})

	for (const theme of ["dark", "light"] as const) {
		describe(theme, () => {
			beforeEach(() => {
				document.body.className = theme === "light" ? "vscode-light" : "vscode-dark"
			})

			it.each(CASES.map((c) => [c.name, c] as const))("CodeBlock %s", async (name, c) => {
				const { container, unmount } = render(<CodeBlock source={c.source} language={c.language} />)
				// Highlighted output replaces the plain fallback once Shiki has run.
				await waitFor(() => expect(container.querySelector("pre.shiki, pre[class*='github']")).not.toBeNull(), {
					timeout: 10000,
				})
				const pre = container.querySelector("pre.shiki, pre[class*='github']")!
				check(`CodeBlock ${theme} > ${name}`, normalize(pre.outerHTML))
				unmount()
			})

			it("highlightHunks", async () => {
				const { oldLines, newLines } = await highlightHunks(
					"const a = 1\nlet b = 'x'",
					"const a = 2\nlet b = `y`\n// done",
					"typescript",
					theme,
				)
				const html = (nodes: React.ReactNode[]) => nodes.map((n) => renderToStaticMarkup(<>{n}</>))
				check(`highlightHunks ${theme}`, { oldLines: html(oldLines), newLines: html(newLines) })
			})
		})
	}
})
