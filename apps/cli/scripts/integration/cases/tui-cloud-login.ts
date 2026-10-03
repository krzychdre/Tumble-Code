/**
 * `/login` and `/logout` of the interactive CLI, end to end without the Ink
 * screen: the real ExtensionHost runs the real extension bundle against a fake
 * cloud, and `TuiCloudAuth` (what the slash commands call) drives it through
 * the same channel the TUI builds in useExtensionHost. The host's
 * `openExternal` option plays the browser: it requests the sign-in URL and
 * follows the cloud's redirect to the CLI's loopback listener.
 */

import fs from "fs/promises"
import os from "os"
import path from "path"
import { fileURLToPath } from "url"

import type { ExtensionMessage } from "@tumble-code/types"
import { setLogger } from "@tumble-code/vscode-shim"

import { ExtensionHost } from "../../../src/agent/extension-host"
import { TuiCloudAuth, type CloudAuthChannel } from "../../../src/lib/auth/tui-cloud-auth"
import { SESSION_ID, startFakeCloud } from "../lib/fake-cloud"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const cliRoot = process.env.ROO_CLI_ROOT ? path.resolve(process.env.ROO_CLI_ROOT) : path.resolve(__dirname, "../../..")

function check(condition: unknown, message: string, notes: string[]): asserts condition {
	if (!condition) {
		throw new Error(`${message}\nnotes:\n${notes.join("\n")}`)
	}
}

async function waitUntil(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
	for (const started = Date.now(); !condition() && Date.now() - started < timeoutMs; ) {
		await new Promise((resolve) => setTimeout(resolve, 50))
	}
}

async function main() {
	// The shim's own log lines (output channel, notifications) stay off the case output.
	setLogger({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} })
	const cloud = await startFakeCloud()
	const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "cli-integration-tui-login-"))
	const browserPages: string[] = []
	const shownUrls: string[] = []

	const host = new ExtensionHost({
		mode: "code",
		provider: "anthropic",
		apiKey: "unused-by-the-scripted-model",
		model: "claude-sonnet-4-5",
		workspacePath: workspace,
		extensionPath: path.resolve(cliRoot, "../../src/dist"),
		ephemeral: false,
		debug: false,
		exitOnComplete: false,
		disableOutput: true,
		cloudApiUrl: cloud.url,
		// The browser: fetch follows the cloud's redirect to the loopback listener.
		openExternal: async (url) => {
			void fetch(url)
				.then(async (response) => browserPages.push(`${response.status} ${await response.text()}`))
				.catch((error: Error) => browserPages.push(`error ${error.message}`))
			return true
		},
	})
	host.on("openExternalUrl", (url: string) => shownUrls.push(url))

	const channel: CloudAuthChannel = {
		send: (message) => host.sendToExtension(message),
		onMessage: (listener) => {
			const typed = (message: unknown) => listener(message as ExtensionMessage)
			host.on("extensionWebviewMessage", typed)
			return () => host.off("extensionWebviewMessage", typed)
		},
		onOpenExternal: (listener) => {
			host.on("openExternalUrl", listener)
			return () => host.off("openExternalUrl", listener)
		},
	}
	const notes: string[] = []
	const auth = new TuiCloudAuth({
		channel,
		note: (text) => notes.push(text),
		loadSettings: async () => ({ cloudApiUrl: cloud.url }),
	})

	let lastCloudIsAuthenticated: boolean | undefined
	host.on("extensionWebviewMessage", (message: unknown) => {
		const state = (message as ExtensionMessage).state

		if ((message as ExtensionMessage).type === "state" && typeof state?.cloudIsAuthenticated === "boolean") {
			lastCloudIsAuthenticated = state.cloudIsAuthenticated
		}
	})

	try {
		await host.activate()

		await auth.login("")
		check(notes.at(-1)?.startsWith("Signed in to Tumble Code Cloud."), "/login did not report success", notes)
		check(
			shownUrls[0]?.startsWith(`${cloud.url}/extension/sign-in?`),
			`the sign-in URL lost the cloud port: ${shownUrls[0]}`,
			notes,
		)
		await waitUntil(() => browserPages.length > 0)
		check(
			browserPages[0]?.startsWith("200 ") && browserPages[0].includes("You can close this tab"),
			`browser page: ${browserPages[0]}`,
			notes,
		)

		// The footer reads cloudIsAuthenticated from the state pushes.
		await waitUntil(() => lastCloudIsAuthenticated === true)
		check(lastCloudIsAuthenticated === true, "no state push with cloudIsAuthenticated: true", notes)

		await auth.logout()
		check(notes.at(-1) === "Signed out from Tumble Code Cloud.", "/logout did not report success", notes)
		check(
			cloud.requests.some((request) => request.path === `/v1/client/sessions/${SESSION_ID}/remove`),
			"logout did not end the session on the cloud",
			notes,
		)
	} finally {
		auth.cancel()
		await host.dispose()
		cloud.close()
		await fs.rm(workspace, { recursive: true, force: true })
	}
}

main().then(
	() => process.exit(0),
	(error) => {
		console.error(`[FAIL] ${error instanceof Error ? error.message : String(error)}`)
		process.exit(1)
	},
)
