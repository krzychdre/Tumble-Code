import * as path from "path"
import * as os from "os"
import * as fs from "fs/promises"

import { runTests } from "@vscode/test-electron"

async function minimumVsCodeVersion(extensionPath: string): Promise<string> {
	const manifest = JSON.parse(await fs.readFile(path.join(extensionPath, "package.json"), "utf8")) as {
		engines?: { vscode?: string }
	}
	const version = manifest.engines?.vscode?.match(/\d+\.\d+\.\d+/)?.[0]

	if (!version) {
		throw new Error(`No engines.vscode version in ${extensionPath}/package.json`)
	}

	return version
}

async function main() {
	try {
		// The folder containing the Extension Manifest package.json
		// Passed to `--extensionDevelopmentPath`
		const extensionDevelopmentPath = path.resolve(__dirname, "../../../src")

		// The path to the extension test script
		// Passed to --extensionTestsPath
		const extensionTestsPath = path.resolve(__dirname, "./suite/index")

		// Create a temporary workspace folder for tests
		const testWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), "roo-test-workspace-"))

		// Get test filter from command line arguments or environment variable
		// Usage examples:
		// - npm run test:e2e -- --grep "write-to-file"
		// - TEST_GREP="apply-diff" npm run test:e2e
		// - TEST_FILE="task.test.js" npm run test:e2e
		const testGrep = process.argv.find((arg, i) => process.argv[i - 1] === "--grep") || process.env.TEST_GREP
		const testFile = process.argv.find((arg, i) => process.argv[i - 1] === "--file") || process.env.TEST_FILE

		// Pass test filters as environment variables to the test runner
		const extensionTestsEnv = {
			...process.env,
			...(testGrep && { TEST_GREP: testGrep }),
			...(testFile && { TEST_FILE: testFile }),
		}

		// Download VS Code, unzip it and run the integration test. The default
		// is the oldest VS Code the extension supports (engines.vscode), read
		// from the manifest so the two cannot drift apart: a hard-coded 1.101.2
		// outlived the move to ^1.102.0, and VS Code then refused to load the
		// extension ("Extension not found").
		await runTests({
			extensionDevelopmentPath,
			extensionTestsPath,
			launchArgs: [testWorkspace],
			extensionTestsEnv,
			version: process.env.VSCODE_VERSION || (await minimumVsCodeVersion(extensionDevelopmentPath)),
		})

		// Clean up the temporary workspace
		await fs.rm(testWorkspace, { recursive: true, force: true })
	} catch (error) {
		console.error("Failed to run tests", error)
		process.exit(1)
	}
}

main()
