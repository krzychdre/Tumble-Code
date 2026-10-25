import type { Command, ModeConfig } from "@tumble-code/types"

import {
	insertMention,
	removeMention,
	getContextMenuOptions,
	shouldShowContextMenu,
	ContextMenuOptionType as T,
	ContextMenuQueryItem,
	SearchResult,
} from "@src/utils/context-mentions"

const types = (options: ContextMenuQueryItem[]) => options.map((o) => o.type)

describe("insertMention", () => {
	it.each([
		{ name: "no @: at the cursor", text: "Hello world", pos: 5, value: "test", out: "Hello@test  world", index: 5 },
		{
			name: "replaces the word after the last @",
			text: "Hello @wor world",
			pos: 8,
			value: "test",
			out: "Hello @test  world",
			index: 6,
		},
		{ name: "empty text", text: "", pos: 0, value: "test", out: "@test ", index: 0 },
		{ name: "at the start", text: "world", pos: 0, value: "problems", out: "@problems world", index: 0 },
		{
			name: "a path for a partial mention",
			text: "Mention @fi",
			pos: 11,
			value: "/path/to/file.txt",
			out: "Mention @/path/to/file.txt ",
			index: 8,
		},
		{
			name: "spaces of a non-path stay",
			text: "Hello @abc ",
			pos: 10,
			value: "git commit with spaces",
			out: "Hello @git commit with spaces  ",
			index: 6,
		},
		{
			name: "spaces of a file path are escaped",
			text: "Mention @old",
			pos: 11,
			value: "/path/to/file with spaces.txt",
			out: "Mention @/path/to/file\\ with\\ spaces.txt ",
			index: 8,
		},
		{
			name: "an escaped path is not escaped twice",
			text: "Insert @path",
			pos: 11,
			value: "/path/already\\ escaped.txt",
			out: "Insert @/path/already\\ escaped.txt ",
			index: 7,
		},
		{
			name: "a mention after a slash command",
			text: "/code @",
			pos: 8,
			value: "src/file.ts",
			out: "/code @src/file.ts ",
			index: 6,
		},
		{
			name: "non-alphanumeric text after the cursor is kept whole",
			text: "@ab中文",
			pos: 3,
			value: "x",
			out: "@x 中文",
			index: 0,
		},
	])("$name", ({ text, pos, value, out, index }) => {
		expect(insertMention(text, pos, value)).toEqual({ newValue: out, mentionIndex: index })
	})

	it("a selected slash command replaces the whole text", () => {
		expect(insertMention("/code @some/file.ts", 5, "debug", true)).toEqual({ newValue: "debug", mentionIndex: 0 })
	})
})

describe("removeMention", () => {
	it.each([
		{
			name: "at the end of a mention: removes it and one space",
			text: "Hello @problems ",
			pos: 15,
			out: "Hello ",
			newPos: 6,
		},
		{ name: "inside a mention: nothing", text: "Hello @test world", pos: 8, out: "Hello @test world", newPos: 8 },
		{ name: "no mention: nothing", text: "Hello world", pos: 5, out: "Hello world", newPos: 5 },
		{
			name: "an escaped-space path before the next word",
			text: "File @/path/to/file\\ with\\ spaces.txt next word",
			pos: 37,
			out: "File next word",
			newPos: 5,
		},
		// Known limitation: the mention regex does not end on an escaped-space path at the very end.
		{
			name: "an escaped-space path at the very end: nothing",
			text: "File @/path/to/file\\ with\\ spaces.txt ",
			pos: 38,
			out: "File @/path/to/file\\ with\\ spaces.txt ",
			newPos: 38,
		},
	])("$name", ({ text, pos, out, newPos }) => {
		expect(removeMention(text, pos)).toEqual({ newText: out, newPosition: newPos })
	})
})

describe("getContextMenuOptions: @ mentions", () => {
	const items: ContextMenuQueryItem[] = [
		{ type: T.File, value: "src/test.ts", label: "test.ts", description: "Source file" },
		{ type: T.OpenedFile, value: "src/open file.ts", label: "open file.ts", description: "Currently opened file" },
		{ type: T.Git, value: "abc1234", label: "Initial commit", description: "First commit" },
		{ type: T.Folder, value: "src", label: "src", description: "Source folder" },
	]

	it("an empty query offers the top-level types", () => {
		expect(types(getContextMenuOptions("", null, []))).toEqual([
			T.Problems,
			T.Terminal,
			T.URL,
			T.Folder,
			T.File,
			T.Git,
		])
	})

	it.each([
		{
			selected: T.File,
			from: items,
			out: [
				[T.File, "src/test.ts"],
				[T.OpenedFile, "src/open file.ts"],
			],
		},
		{ selected: T.Folder, from: items, out: [[T.Folder, "src"]] },
		{
			selected: T.Git,
			from: items,
			out: [
				[T.Git, "git-changes"],
				[T.Git, "abc1234"],
			],
		},
		{ selected: T.Git, from: [], out: [[T.Git, "git-changes"]] },
		{ selected: T.File, from: [], out: [[T.NoResults, undefined]] },
		{ selected: T.Folder, from: [], out: [[T.NoResults, undefined]] },
	])("an empty query after picking $selected lists those items", ({ selected, from, out }) => {
		expect(getContextMenuOptions("", selected, from).map((o) => [o.type, o.value])).toEqual(out)
	})

	it.each([
		{ query: "git", first: { type: T.Git, label: "Git Commits" } },
		{ query: "git-c", first: { type: T.Git, value: "git-changes" } },
		{ query: "prob", first: { type: T.Problems } },
		{ query: "term", first: { type: T.Terminal } },
		{ query: "https://x.dev", first: { type: T.URL, value: "https://x.dev" } },
		{ query: "abc1234", first: { type: T.Git, value: "abc1234", label: "Initial commit" } },
		{ query: "deadbeef", first: { type: T.Git, value: "deadbeef", label: "Commit deadbeef" } },
		{ query: "nonexistent", first: { type: T.NoResults } },
	])("$query suggests $first.type first", ({ query, first }) => {
		expect(getContextMenuOptions(query, null, items)[0]).toMatchObject(first)
	})

	it("orders opened files, then search results, then commits; without duplicates", () => {
		const testItems: ContextMenuQueryItem[] = [
			{ type: T.File, value: "src/test-file.ts", label: "test-file.ts" },
			{ type: T.OpenedFile, value: "src/test-opened.ts", label: "test-opened.ts" },
			{ type: T.Git, value: "abctest", label: "Test commit" },
		]
		const searchResults: SearchResult[] = [
			{ path: "search/test-result.ts", type: "file", label: "test-result.ts" },
			{ path: "/search/test-result.ts", type: "file" },
			{ path: "search/test-folder", type: "folder" },
		]

		const result = getContextMenuOptions("test", null, testItems, searchResults)

		expect(result.map((o) => [o.type, o.value])).toEqual([
			[T.OpenedFile, "src/test-opened.ts"],
			[T.File, "/search/test-result.ts"],
			[T.Folder, "/search/test-folder"],
			[T.Git, "abctest"],
		])
	})

	it("shows search results with a leading slash, a basename label and unescaped spaces", () => {
		const [result] = getContextMenuOptions("spaces", null, [], [{ path: "dir/with spaces/file.txt", type: "file" }])

		expect(result).toEqual({
			type: T.File,
			value: "/dir/with spaces/file.txt",
			label: "file.txt",
			description: "/dir/with spaces/file.txt",
		})
	})
})

describe("getContextMenuOptions: slash commands", () => {
	const mode = (slug: string, name: string, extra: Partial<ModeConfig> = {}): ModeConfig => ({
		slug,
		name,
		roleDefinition: `${name} role\nsecond line`,
		groups: ["read"],
		...extra,
	})
	const modes = [
		mode("code", "Code", { description: "Writes code" }),
		mode("architect", "Architect", { whenToUse: "Plans first\nmore" }),
		mode("ask", "Ask"),
	]
	const commands: Command[] = [
		{ name: "init", source: "built-in", description: "Analyze the codebase" },
		{ name: "review", source: "built-in", argumentHint: "<file>" },
		{ name: "code-review", source: "project", description: "Review skill" },
		{ name: "deploy", source: "global" },
	]
	const rows = (options: ContextMenuQueryItem[]) =>
		options.map((o) => (o.type === T.SectionHeader ? `# ${o.label}` : `${o.type} ${o.slashCommand}`))

	it("lists built-in commands, skills and modes under their headers, in that order", () => {
		expect(rows(getContextMenuOptions("/", null, [], [], modes, commands))).toEqual([
			"# Commands",
			"command /init",
			"command /review",
			"# Skills",
			"command /code-review",
			"command /deploy",
			"# Modes",
			"mode /code",
			"mode /architect",
			"mode /ask",
		])
	})

	it("filters commands, skills and modes by fuzzy name, best match first, and drops empty headers", () => {
		expect(rows(getContextMenuOptions("/rev", null, [], [], modes, commands))).toEqual([
			"# Commands",
			"command /review",
			"# Skills",
			"command /code-review",
		])
		expect(rows(getContextMenuOptions("/arch", null, [], [], modes, commands))).toEqual([
			"# Modes",
			"mode /architect",
		])
	})

	it("carries the description and argument hint of a command, and the first line of a mode's text", () => {
		const options = getContextMenuOptions("/", null, [], [], modes, commands)
		const byCommand = (slash: string) => options.find((o) => o.slashCommand === slash)

		expect(byCommand("/init")).toMatchObject({ value: "init", description: "Analyze the codebase" })
		expect(byCommand("/review")).toMatchObject({ argumentHint: "<file>" })
		expect([byCommand("/code"), byCommand("/architect"), byCommand("/ask")].map((o) => o?.description)).toEqual([
			"Writes code",
			"Plans first",
			"Ask role",
		])
	})

	it("returns NoResults when nothing matches or nothing is offered", () => {
		expect(types(getContextMenuOptions("/zzzz", null, [], [], modes, commands))).toEqual([T.NoResults])
		expect(types(getContextMenuOptions("/", null, [], [], [], undefined))).toEqual([T.NoResults])
	})
})

describe("shouldShowContextMenu", () => {
	it.each([
		{ text: "@", pos: 1, show: true },
		{ text: "Hello @test", pos: 10, show: true },
		{ text: "Hello world", pos: 5, show: false },
		{ text: "Hello @ world", pos: 8, show: false },
		{ text: "Hello @http://test.com", pos: 17, show: false },
		{ text: "@/path/to/file\\ with\\ spaces", pos: 28, show: true },
		{ text: "@/path/with space", pos: 13, show: false },
		{ text: "/mod", pos: 4, show: true },
		{ text: "/mode now", pos: 4, show: false },
	])("$text at $pos: $show", ({ text, pos, show }) => {
		expect(shouldShowContextMenu(text, pos)).toBe(show)
	})
})
