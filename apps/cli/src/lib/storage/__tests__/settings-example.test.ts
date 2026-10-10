// The example settings file (apps/cli/examples) must keep up with the settings the CLI reads.

import fs from "fs"
import path from "path"

import type { CliSettings } from "@/types/types.js"
import { findModelSettingsProblems } from "@/lib/utils/model-settings.js"

const cliRoot = path.resolve(__dirname, "../../../..")
const example = JSON.parse(
	fs.readFileSync(path.join(cliRoot, "examples/cli-settings.example.json"), "utf-8"),
) as CliSettings

/** The keys of the first column of every table in a markdown file, or of one section of it. */
function tableKeys(markdown: string): Set<string> {
	return new Set([...markdown.matchAll(/^\| `([A-Za-z]+)`/gm)].map((match) => match[1]!))
}

function exampleKeys(): Set<string> {
	return new Set([
		...Object.keys(example),
		...Object.values(example.modes ?? {}).flatMap((entry) => Object.keys(entry)),
		...Object.values(example.models ?? {}).flatMap((entry) => Object.keys(entry)),
	])
}

describe("cli-settings.example.json", () => {
	it("has valid model entries", () => {
		expect(findModelSettingsProblems(example.models)).toEqual([])
	})

	it("sets every key of the README's settings table", () => {
		const readme = fs.readFileSync(path.join(cliRoot, "README.md"), "utf-8")
		const section = readme.slice(readme.indexOf("## Settings File"), readme.indexOf("### Settings per mode"))
		const keys = exampleKeys()

		expect([...tableKeys(section)].filter((key) => !keys.has(key))).toEqual([])
	})

	it("is explained key by key in examples/README.md", () => {
		const explained = tableKeys(fs.readFileSync(path.join(cliRoot, "examples/README.md"), "utf-8"))

		expect([...explained].sort()).toEqual([...exampleKeys()].sort())
	})
})
