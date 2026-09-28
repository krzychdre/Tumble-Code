// §2.7 (ai_plans/2026-09-27_ui-modernization.md): the diff view gets a merged
// line-number gutter for narrow panels (a container query swaps it in below
// 400px) and folds long runs of unchanged lines into "... N unchanged lines"
// buttons.
//
// jsdom does not evaluate container queries, so the swap itself is pinned on
// the stylesheet text and the cells are pinned on their classes.

import { readFileSync } from "fs"
import { resolve } from "path"

import { render, screen, fireEvent } from "@/utils/test-utils"

import DiffView from "../DiffView"

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: { count?: number }) =>
			options?.count !== undefined ? `${key}:${options.count}` : key,
	}),
	initReactI18next: { type: "3rdParty", init: () => {} },
}))

// Shiki is slow and irrelevant here: the view falls back to plain text.
vi.mock("@src/utils/highlightDiff", () => ({
	highlightHunks: vi.fn(async () => {
		throw new Error("no highlighter in tests")
	}),
}))

const patch = (body: string[]) => ["--- a/f.ts", "+++ b/f.ts", ...body, ""].join("\n")

// One hunk: a deletion, 18 unchanged lines, an addition.
const longRunDiff = patch([
	"@@ -1,20 +1,20 @@",
	"-old1",
	...Array.from({ length: 18 }, (_, i) => ` same${i + 2}`),
	"+new20",
])

describe("DiffView merged gutter", () => {
	it("renders a merged line-number cell next to the two split cells on every line", () => {
		const { container } = render(<DiffView source={patch(["@@ -1,2 +1,2 @@", "-a", "+b", " c"])} />)

		const rows = Array.from(container.querySelectorAll("tbody tr"))
		expect(rows).toHaveLength(3)
		for (const row of rows) {
			expect(row.querySelectorAll("td.diff-gutter-split")).toHaveLength(2)
			expect(row.querySelectorAll("td.diff-gutter-merged")).toHaveLength(1)
		}

		const merged = rows.map((row) => row.querySelector("td.diff-gutter-merged")?.textContent)
		// deletion shows the old number, addition and context the new one
		expect(merged).toEqual(["1", "1", "2"])
	})

	it("swaps the split gutters for the merged one below 400px through a container query", () => {
		const css = readFileSync(resolve(__dirname, "../../../index.css"), "utf8")

		expect(css).toMatch(/\.diff-view\s*\{[^}]*container-type:\s*inline-size/)
		const query = css.match(/@container\s*\(max-width:\s*399px\)\s*\{([\s\S]*?)\n\}/)
		expect(query?.[1]).toMatch(/\.diff-gutter-split\s*\{\s*display:\s*none/)
		expect(query?.[1]).toMatch(/\.diff-gutter-merged\s*\{\s*display:\s*table-cell/)
	})

	it("renders square corners", () => {
		const { container } = render(<DiffView source={patch(["@@ -1 +1 @@", "-a", "+b"])} />)
		expect(container.querySelector(".diff-view")?.className).not.toMatch(/rounded/)
	})
})

describe("DiffView unchanged-line folds", () => {
	it("folds a long unchanged run into a button with its count", () => {
		render(<DiffView source={longRunDiff} />)

		const fold = screen.getByRole("button", { name: "chat:diffView.unchangedLines:12" })
		expect(fold.tagName).toBe("BUTTON")
		expect(screen.queryByText("same8")).toBeNull()
		expect(screen.getByText("same4")).toBeInTheDocument()
		expect(screen.getByText("same17")).toBeInTheDocument()
	})

	it("shows the folded lines when the fold button is clicked", () => {
		render(<DiffView source={longRunDiff} />)

		fireEvent.click(screen.getByRole("button", { name: "chat:diffView.unchangedLines:12" }))

		expect(screen.queryByRole("button", { name: /unchangedLines/ })).toBeNull()
		expect(screen.getByText("same8")).toBeInTheDocument()
	})

	it("labels the separator between hunks through i18n", () => {
		render(<DiffView source={patch(["@@ -1,1 +1,1 @@", "-a", "+b", "@@ -20,1 +20,1 @@", "-c", "+d"])} />)

		expect(screen.getByText("chat:diffView.hiddenLines:18")).toBeInTheDocument()
	})
})
