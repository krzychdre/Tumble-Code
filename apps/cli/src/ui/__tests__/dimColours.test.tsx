/**
 * Nothing the CLI draws may rely on SGR 2 (dim) over an RGB colour. VTE (GNOME
 * Terminal, Ptyxis) dims only palette colours and draws an RGB one at full
 * strength, so such text was never dim there (see `dimmed` in theme.ts). Every
 * case below also checks the colour the text is drawn in now, because simply
 * dropping `dimColor` would satisfy the first rule and brighten everything.
 */

// chalk picks its colour depth when it loads. FORCE_COLOR alone is not enough:
// with TERM=xterm it stops at 16 colours, which turns every hex colour into a
// palette one and hides the bug. COLORTERM=truecolor is what GNOME Terminal
// exports, and what puts chalk on RGB.
vi.hoisted(() => {
	process.env.FORCE_COLOR = "3"
	process.env.COLORTERM = "truecolor"
})

import type { ReactElement } from "react"
import { Text } from "ink"
import { render } from "ink-testing-library"

import * as theme from "../theme.js"
import Markdown from "../components/Markdown.js"
import Spinner from "../components/Spinner.js"
import TodoDisplay from "../components/TodoDisplay.js"
import TodoChangeDisplay from "../components/TodoChangeDisplay.js"
import SystemMessage from "../components/messages/SystemMessage.js"
import ContextGauge from "../components/input/ContextGauge.js"
import InputArea from "../components/input/InputArea.js"
import { TerminalSizeProvider } from "../hooks/TerminalSizeContext.js"
import Bullet from "../components/primitives/Bullet.js"
import SelectList from "../components/primitives/SelectList.js"
import { FileReadTool } from "../components/tools/FileReadTool.js"
import { FileWriteTool } from "../components/tools/FileWriteTool.js"
import { GenericTool } from "../components/tools/GenericTool.js"
import { SearchTool } from "../components/tools/SearchTool.js"

interface Run {
	text: string
	dim: boolean
	/** `#RRGGBB` for an RGB foreground, null for the default or a palette colour. */
	fg: string | null
}

// eslint-disable-next-line no-control-regex
const SGR = /(\x1b\[[0-9;]*m)/

/** Split a frame into text runs, each with the SGR state it was drawn in. */
function runs(frame: string): Run[] {
	const found: Run[] = []
	let dim = false
	let fg: string | null = null
	for (const token of frame.split(SGR)) {
		if (!SGR.test(token)) {
			if (token) {
				found.push({ text: token, dim, fg })
			}
			continue
		}
		const params = (token.slice(2, -1) || "0").split(";").map(Number)
		for (let i = 0; i < params.length; i++) {
			const p = params[i]!
			if (p === 0) {
				dim = false
				fg = null
			} else if (p === 2) {
				dim = true
			} else if (p === 22) {
				dim = false
			} else if (p === 39 || (p >= 30 && p <= 37) || (p >= 90 && p <= 97)) {
				fg = null
			} else if ((p === 38 || p === 48) && params[i + 1] === 2) {
				if (p === 38) {
					fg = `#${params
						.slice(i + 2, i + 5)
						.map((channel) => channel.toString(16).padStart(2, "0").toUpperCase())
						.join("")}`
				}
				i += 4
			} else if ((p === 38 || p === 48) && params[i + 1] === 5) {
				if (p === 38) {
					fg = null
				}
				i += 2
			}
		}
	}
	return found
}

const frameOf = (element: ReactElement) => render(element).lastFrame() ?? ""

const dimOnRgb = (frame: string) =>
	runs(frame)
		.filter((run) => run.dim && run.fg)
		.map((run) => run.text)

/** The style of the first run that contains `snippet`. */
function styleOf(frame: string, snippet: string): Omit<Run, "text"> {
	const run = runs(frame).find((candidate) => candidate.text.includes(snippet))
	if (!run) {
		throw new Error(`${JSON.stringify(snippet)} is not in one run of ${JSON.stringify(frame)}`)
	}
	return { dim: run.dim, fg: run.fg }
}

const noop = () => {}

const prompt = (isLoading: boolean) => (
	<TerminalSizeProvider>
		<InputArea onSubmit={noop} isActive={false} isLoading={isLoading} triggers={[]} />
	</TerminalSizeProvider>
)

describe("the dim-on-RGB detector", () => {
	it("flags dimColor on a hex colour, the pattern VTE draws at full strength", () => {
		expect(
			dimOnRgb(
				frameOf(
					<Text dimColor color="#A3BABF">
						x
					</Text>,
				),
			),
		).toEqual(["x"])
	})

	it("passes dimColor on the default colour, which VTE does dim", () => {
		expect(dimOnRgb(frameOf(<Text dimColor>x</Text>))).toEqual([])
	})

	it("passes dimColor on a named colour, which is a palette colour", () => {
		expect(
			dimOnRgb(
				frameOf(
					<Text dimColor color="cyan">
						x
					</Text>,
				),
			),
		).toEqual([])
	})
})

describe("dimmed", () => {
	it("is theme.faint for secondaryText", () => {
		expect(theme.dimmed(theme.secondaryText)).toBe(theme.faint)
	})

	it("scales every channel to 2/3", () => {
		expect(theme.dimmed("#FFFFFF")).toBe("#AAAAAA")
		expect(theme.dimmed("#E6DB74")).toBe("#99924D")
	})

	it("leaves named colours alone", () => {
		expect(theme.dimmed("cyan")).toBe("cyan")
	})
})

const TODOS = [
	{ id: "1", content: "Finished work", status: "completed" as const },
	{ id: "2", content: "Current work", status: "in_progress" as const },
	{ id: "3", content: "Later work", status: "pending" as const },
]
const PREVIOUS_TODOS = [
	{ id: "1", content: "Finished work", status: "pending" as const },
	{ id: "2", content: "Current work", status: "pending" as const },
]

const LONG_HUNK = [
	"@@ -1,12 +1,12 @@",
	" context line",
	...Array.from({ length: 10 }, (_, i) => `-old ${i}`),
	"+new",
	"@@ -40,2 +40,2 @@",
	"-a",
	"+b",
	"@@ -80,2 +80,2 @@",
	"-c",
	"+d",
].join("\n")

const MARKDOWN = [
	"See [the docs](https://docs.example) first.",
	"```python",
	"print(1)",
	"```",
	"> quoted with `snippet` and [anchor](https://quote.example)",
	"",
	"---",
	"| a | b |",
	"|---|---|",
].join("\n")

// [what, element, a snippet that used to be drawn dim, the colour it gets now]
const CASES: [string, ReactElement, string, string][] = [
	["a system message", <SystemMessage content="Task resumed" />, "Task resumed", theme.faint],
	[
		"the spinner's timer",
		<Spinner startTime={Date.now()} tokensOut={1200} sound="Tumbling" isActive={false} />,
		"esc to interrupt",
		theme.faint,
	],
	["a TODO list's count", <TodoDisplay todos={TODOS} previousTodos={PREVIOUS_TODOS} />, "(1/3)", theme.faint],
	[
		"a finished TODO",
		<TodoDisplay todos={TODOS} previousTodos={PREVIOUS_TODOS} />,
		"Finished work",
		theme.dimmed(theme.subtle),
	],
	["a TODO's change label", <TodoDisplay todos={TODOS} previousTodos={PREVIOUS_TODOS} />, "[done]", theme.faint],
	[
		"a new TODO's label",
		<TodoDisplay todos={[...TODOS, { id: "4", content: "Extra", status: "pending" }]} previousTodos={TODOS} />,
		"[new]",
		theme.faint,
	],
	[
		"a TODO update's count",
		<TodoChangeDisplay previousTodos={PREVIOUS_TODOS} newTodos={TODOS} />,
		"(1/3)",
		theme.faint,
	],
	[
		"a TODO update's finished item",
		<TodoChangeDisplay previousTodos={PREVIOUS_TODOS} newTodos={TODOS} />,
		"Finished work",
		theme.dimmed(theme.subtle),
	],
	[
		"a TODO update's label",
		<TodoChangeDisplay previousTodos={PREVIOUS_TODOS} newTodos={TODOS} />,
		"[started]",
		theme.faint,
	],
	[
		"a search hit's file",
		<SearchTool toolData={{ tool: "searchFiles", regex: "x", content: "src/app.tsx:347:  const x = 1" }} />,
		"src/app.tsx",
		theme.dimmed(theme.suggestion),
	],
	[
		"a search hit's line number",
		<SearchTool toolData={{ tool: "searchFiles", regex: "x", content: "src/app.tsx:347:  const x = 1" }} />,
		"347",
		theme.dimmed(theme.warning),
	],
	[
		"a search hit's text",
		<SearchTool toolData={{ tool: "searchFiles", regex: "x", content: "src/app.tsx:347:  const x = 1" }} />,
		"const x = 1",
		theme.faint,
	],
	[
		"an edit outside the workspace",
		<FileWriteTool toolData={{ tool: "appliedDiff", path: "a.ts", diff: LONG_HUNK, isOutsideWorkspace: true }} />,
		"(outside workspace)",
		theme.dimmed(theme.warning),
	],
	[
		"a diff hunk header",
		<FileWriteTool toolData={{ tool: "appliedDiff", path: "a.ts", diff: LONG_HUNK }} />,
		"@@",
		theme.faint,
	],
	[
		"a diff context line",
		<FileWriteTool toolData={{ tool: "appliedDiff", path: "a.ts", diff: LONG_HUNK }} />,
		"context line",
		theme.faint,
	],
	[
		"a diff's hidden lines",
		<FileWriteTool toolData={{ tool: "appliedDiff", path: "a.ts", diff: LONG_HUNK }} />,
		"more lines",
		theme.faint,
	],
	[
		"a diff's hidden hunks",
		<FileWriteTool toolData={{ tool: "appliedDiff", path: "a.ts", diff: LONG_HUNK }} />,
		"more hunks",
		theme.faint,
	],
	[
		"a read outside the workspace",
		<FileReadTool toolData={{ tool: "readFile", path: "/etc/hosts", isOutsideWorkspace: true }} />,
		"(outside workspace)",
		theme.dimmed(theme.warning),
	],
	[
		"another tool outside the workspace",
		<GenericTool toolData={{ tool: "listCodeDefinitionNames", path: "/etc", isOutsideWorkspace: true }} />,
		"(outside workspace)",
		theme.dimmed(theme.warning),
	],
	[
		"a list item's description",
		<SelectList items={[{ label: "Key", value: "key", description: "Use a key you have" }]} onSelect={noop} />,
		"Use a key you have",
		theme.faint,
	],
	["a link's address", <Markdown>{MARKDOWN}</Markdown>, "(https://docs.example)", theme.faint],
	["a code block's language", <Markdown>{MARKDOWN}</Markdown>, "python", theme.faint],
	["a blockquote", <Markdown>{MARKDOWN}</Markdown>, "quoted with", theme.faint],
	["code in a blockquote", <Markdown>{MARKDOWN}</Markdown>, "snippet", theme.dimmed(theme.code)],
	["a link in a blockquote", <Markdown>{MARKDOWN}</Markdown>, "anchor", theme.dimmed(theme.suggestion)],
	["a horizontal rule", <Markdown>{MARKDOWN}</Markdown>, "───", theme.faint],
	["the context gauge's empty cells", <ContextGauge percent={38} />, "░", theme.dimmed(theme.inactive)],
	["the prompt while the model works", prompt(true), "❯", theme.dimmed(theme.promptBorder)],
	["a dimmed bullet", <Bullet status="success" dim />, "●", theme.dimmed(theme.success)],
]

describe("text that used to be dim", () => {
	it.each(CASES)("%s is drawn in a darker colour, never as dim on RGB", (_what, element, snippet, colour) => {
		const frame = frameOf(element)

		expect(dimOnRgb(frame)).toEqual([])
		expect(styleOf(frame, snippet)).toEqual({ dim: false, fg: colour })
	})
})

describe("dim on the default colour stays", () => {
	// These are the cases VTE does dim; turning them into a hex colour would
	// tie them to one background instead of the user's terminal profile.
	it("keeps a running bullet's blink on the terminal's own foreground", () => {
		expect(styleOf(frameOf(<Bullet status="running" />), "●")).toEqual({ dim: true, fg: null })
	})

	it("keeps the prompt at full strength while idle", () => {
		const frame = frameOf(prompt(false))

		expect(styleOf(frame, "❯")).toEqual({ dim: false, fg: theme.promptBorder })
	})
})
