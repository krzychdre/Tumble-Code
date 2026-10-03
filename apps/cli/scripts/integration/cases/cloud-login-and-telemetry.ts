/**
 * Cloud sign-in end to end, through the real extension bundle, against a fake
 * cloud on 127.0.0.1:
 *
 * 1. `tumble auth cloud login` with `cloudApiUrl` in cli-settings.json. A fake
 *    `xdg-open`/`open` on PATH plays the browser: it requests the sign-in URL,
 *    follows the cloud's redirect to the CLI's loopback listener and prints the
 *    page it ends on. The CLI exchanges the ticket and stores the session.
 * 2. `tumble auth cloud status` (a new process) finds the stored session.
 * 3. A print-mode task sends its `LLM Completion` event to the cloud.
 * 4. `tumble auth cloud logout` removes the session again.
 *
 * run.ts gives each case its own HOME, so the settings, the secrets file and
 * the task history all live in a temporary directory.
 */

import fs from "fs/promises"
import os from "os"
import path from "path"
import { fileURLToPath } from "url"

import { execa } from "execa"

import { EMAIL, SESSION_ID, startFakeCloud } from "../lib/fake-cloud"
import { assertRun, runPrint, type PrintRunResult } from "../lib/print-harness"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const cliRoot = process.env.ROO_CLI_ROOT ? path.resolve(process.env.ROO_CLI_ROOT) : path.resolve(__dirname, "../../..")

/** A PATH directory whose `xdg-open` and `open` fetch the URL like a browser and log the final page. */
async function createFakeBrowser(): Promise<{ binDir: string; logFile: string }> {
	const binDir = await fs.mkdtemp(path.join(os.tmpdir(), "cli-integration-browser-"))
	const logFile = path.join(binDir, "browser.log")
	const script = [
		"#!/usr/bin/env node",
		"const fs = require('fs')",
		`fetch(process.argv[2]).then(async (r) => fs.appendFileSync(${JSON.stringify(logFile)}, r.status + ' ' + (await r.text()) + '\\n'))`,
		`  .catch((e) => fs.appendFileSync(${JSON.stringify(logFile)}, 'error ' + e.message + '\\n'))`,
	].join("\n")

	for (const name of ["xdg-open", "open"]) {
		await fs.writeFile(path.join(binDir, name), script, { mode: 0o755 })
	}

	return { binDir, logFile }
}

async function runCli(args: string[], env: NodeJS.ProcessEnv): Promise<PrintRunResult> {
	const result = await execa("tsx", ["src/index.ts", ...args], {
		cwd: cliRoot,
		stdin: "ignore",
		reject: false,
		timeout: 60_000,
		env,
	})

	return { exitCode: result.exitCode, stdout: String(result.stdout), stderr: String(result.stderr) }
}

async function main() {
	const cloud = await startFakeCloud()
	const browser = await createFakeBrowser()
	const env = { ...process.env, PATH: `${browser.binDir}${path.delimiter}${process.env.PATH}` }

	try {
		await fs.mkdir(path.join(os.homedir(), ".roo"), { recursive: true })
		await fs.writeFile(
			path.join(os.homedir(), ".roo", "cli-settings.json"),
			JSON.stringify({ cloudApiUrl: `${cloud.url}/` }),
		)

		const login = await runCli(["auth", "cloud", "login"], env)
		assertRun(login.exitCode === 0, "auth cloud login did not exit 0", login)
		assertRun(
			login.stdout.includes(`Signed in to Tumble Code Cloud as ${EMAIL}`),
			"login did not report the account",
			login,
		)
		const page = await fs.readFile(browser.logFile, "utf8")
		assertRun(page.startsWith("200 ") && page.includes("You can close this tab"), `browser page: ${page}`, login)

		const status = await runCli(["auth", "cloud", "status"], env)
		assertRun(status.exitCode === 0, "auth cloud status did not exit 0 after login", status)
		assertRun(
			status.stdout.includes(EMAIL) && status.stdout.includes(cloud.url),
			"status lacks account or URL",
			status,
		)

		const task = await runPrint(['reply with only "pong"'])
		assertRun(task.exitCode === 0, "the print task did not exit 0", task)

		const events = cloud.requests
			.filter((request) => request.method === "POST" && request.path === "/api/events")
			.map((request) => JSON.parse(request.body) as { type: string; properties: Record<string, unknown> })
		const completion = events.find((event) => event.type === "LLM Completion")
		assertRun(
			completion !== undefined,
			`no LLM Completion event reached the cloud; events: ${JSON.stringify(events.map((event) => event.type))}`,
			task,
		)
		assertRun(
			String(completion.properties.editorName ?? "").startsWith("wrapper|cli"),
			`the event does not name the CLI: ${JSON.stringify(completion.properties)}`,
			task,
		)

		const logout = await runCli(["auth", "cloud", "logout"], env)
		assertRun(logout.exitCode === 0, "auth cloud logout did not exit 0", logout)
		assertRun(
			cloud.requests.some((request) => request.path === `/v1/client/sessions/${SESSION_ID}/remove`),
			"logout did not end the session on the cloud",
			logout,
		)

		const after = await runCli(["auth", "cloud", "status"], env)
		assertRun(after.exitCode === 1 && after.stdout.includes("Not signed in"), "still signed in after logout", after)
	} finally {
		cloud.close()
		await fs.rm(browser.binDir, { recursive: true, force: true })
	}
}

main().catch((error) => {
	console.error(`[FAIL] ${error instanceof Error ? error.message : String(error)}`)
	process.exit(1)
})
