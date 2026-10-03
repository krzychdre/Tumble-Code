import * as path from "path"
import Mocha from "mocha"
import { glob } from "glob"
import * as vscode from "vscode"

import type { TumbleCodeAPI } from "@tumble-code/types"

import { waitFor } from "./utils"

export async function run() {
	const extension = vscode.extensions.getExtension<TumbleCodeAPI>("QUB-IT.tumble-code")

	if (!extension) {
		throw new Error("Extension not found")
	}

	const api = extension.isActive ? extension.exports : await extension.activate()

	await api.setConfiguration({
		apiProvider: "openrouter" as const,
		openRouterApiKey: process.env.OPENROUTER_API_KEY!,
		openRouterModelId: "openai/gpt-4.1",
	})

	await vscode.commands.executeCommand("tumble-code.SidebarProvider.focus")
	await waitFor(() => api.isReady())

	globalThis.api = api

	const mochaOptions: Mocha.MochaOptions = {
		ui: "tdd",
		timeout: 20 * 60 * 1_000, // 20m
	}

	if (process.env.TEST_GREP) {
		mochaOptions.grep = process.env.TEST_GREP
		console.log(`Running tests matching pattern: ${process.env.TEST_GREP}`)
	}

	const mocha = new Mocha(mochaOptions)
	const cwd = path.resolve(__dirname, "..")

	let testFiles: string[]

	if (process.env.TEST_FILE) {
		const specificFile = process.env.TEST_FILE.endsWith(".js")
			? process.env.TEST_FILE
			: `${process.env.TEST_FILE}.js`

		testFiles = await glob(`**/${specificFile}`, { cwd })
		console.log(`Running specific test file: ${specificFile}`)
	} else {
		// Provider suites (providers/**) are opt-in: they talk to real provider
		// APIs and need credentials (see the workspace README). By default only
		// the smoke suites run; TEST_PROVIDERS=1 adds the provider suites.
		const includeProviders = process.env.TEST_PROVIDERS === "1"

		testFiles = await glob("**/**.test.js", { cwd, ignore: includeProviders ? [] : ["**/providers/**"] })

		if (!includeProviders) {
			console.log("Provider suites excluded (opt-in). Set TEST_PROVIDERS=1 to include them.")
		}
	}

	if (testFiles.length === 0) {
		throw new Error(`No test files found matching criteria: ${process.env.TEST_FILE || "all tests"}`)
	}

	testFiles.forEach((testFile) => mocha.addFile(path.resolve(cwd, testFile)))

	return new Promise<void>((resolve, reject) =>
		mocha.run((failures) => (failures === 0 ? resolve() : reject(new Error(`${failures} tests failed.`)))),
	)
}
