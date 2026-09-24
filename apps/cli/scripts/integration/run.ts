/**
 * The CLI integration suite: each file in cases/ drives the real CLI (from
 * source, through tsx) over the stdin stream protocol. The extension answers
 * with the scripted model in lib/fake-model.ts, so no network or API key is
 * needed, but the extension bundle must be built first:
 *
 *   pnpm turbo run bundle --filter=tumble-code
 *   pnpm --filter @tumble-code/cli test:integration [--match <name>] [--list]
 */

import fs from "fs/promises"
import os from "os"
import path from "path"
import { fileURLToPath } from "url"

import { execa } from "execa"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const cliRoot = path.resolve(__dirname, "../..")
const casesDir = path.resolve(__dirname, "cases")
const fakeModelPath = path.resolve(__dirname, "lib/fake-model.ts")

interface RunnerOptions {
	listOnly: boolean
	match?: string
}

function parseArgs(argv: string[]): RunnerOptions {
	let listOnly = false
	let match: string | undefined

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]
		if (arg === "--list") {
			listOnly = true
			continue
		}
		if (arg === "--match") {
			match = argv[i + 1]
			i += 1
			continue
		}
	}

	return { listOnly, match }
}

async function discoverCaseFiles(match?: string): Promise<string[]> {
	const entries = await fs.readdir(casesDir, { withFileTypes: true })
	const files = entries
		.filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
		.map((entry) => path.resolve(casesDir, entry.name))
		.sort((a, b) => a.localeCompare(b))

	if (!match) {
		return files
	}

	const normalized = match.toLowerCase()
	return files.filter((file) => path.basename(file).toLowerCase().includes(normalized))
}

async function runCase(caseFile: string): Promise<void> {
	const caseName = path.basename(caseFile, ".ts")
	console.log(`\n[RUN] ${caseName}`)

	// Each case gets its own HOME: the CLI keeps its settings, sessions and
	// the extension's state under it, so no case sees another case's (or the
	// developer's) state, and nothing is left behind.
	const home = await fs.mkdtemp(path.join(os.tmpdir(), `cli-integration-${caseName}-`))

	try {
		await execa("tsx", [caseFile], {
			cwd: cliRoot,
			stdio: "inherit",
			reject: true,
			env: {
				...process.env,
				HOME: home,
				USERPROFILE: home,
				ROO_CLI_ROOT: cliRoot,
				// The extension answers with the scripted model (lib/fake-model.ts).
				ROO_CLI_FAKE_AI_MODULE: fakeModelPath,
			},
		})
	} finally {
		await fs.rm(home, { recursive: true, force: true })
	}

	console.log(`[PASS] ${caseName}`)
}

async function assertExtensionBuilt(): Promise<void> {
	const bundle = path.resolve(cliRoot, "../../src/dist/extension.js")

	try {
		await fs.access(bundle)
	} catch {
		throw new Error(`${bundle} is missing; build it first: pnpm turbo run bundle --filter=tumble-code`)
	}
}

async function main() {
	const options = parseArgs(process.argv.slice(2))
	const caseFiles = await discoverCaseFiles(options.match)

	if (caseFiles.length === 0) {
		throw new Error(
			options.match ? `no integration cases matched --match "${options.match}"` : "no integration cases found",
		)
	}

	if (options.listOnly) {
		console.log("Available integration cases:")
		for (const file of caseFiles) {
			console.log(`- ${path.basename(file, ".ts")}`)
		}
		return
	}

	await assertExtensionBuilt()

	const failures: Array<{ caseName: string; error: string }> = []

	for (const caseFile of caseFiles) {
		const caseName = path.basename(caseFile, ".ts")
		try {
			await runCase(caseFile)
		} catch (error) {
			const errorText = error instanceof Error ? error.message : String(error)
			failures.push({ caseName, error: errorText })
			console.error(`[FAIL] ${caseName}: ${errorText}`)
		}
	}

	const total = caseFiles.length
	const passed = total - failures.length
	console.log(`\nSummary: ${passed}/${total} passed`)

	if (failures.length > 0) {
		process.exitCode = 1
	}
}

main().catch((error) => {
	console.error(`[FAIL] ${error instanceof Error ? error.message : String(error)}`)
	process.exit(1)
})
