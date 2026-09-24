// cd src && npx vitest run services/mcp/__tests__/McpHub.settingsCreation.spec.ts

import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import { McpHub } from "../McpHub"

// The existence check is what races: it can report "absent" while another window (or the CLI,
// which shares this file) creates the file right after it. Controlling it lets the test open that
// window deterministically on a real filesystem.
const existence = vi.hoisted(() => ({ reportAbsent: false }))
vi.mock("../../../utils/fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../../utils/fs")>()
	return {
		...actual,
		fileExistsAtPath: async (filePath: string) =>
			existence.reportAbsent ? false : actual.fileExistsAtPath(filePath),
	}
})

vi.mock("../../../core/webview/ClineProvider")

// Redirects the settings file (the CLI sets it); cleared so the file lands in the temp dir.
const MCP_SETTINGS_PATH_ENV = "ROO_MCP_SETTINGS_PATH"

/** Runs only `getMcpSettingsFilePath`, without the watchers and server start-up of the constructor. */
function settingsPathFor(settingsDir: string): Promise<string> {
	const hub = Object.create(McpHub.prototype) as McpHub
	const provider = { ensureSettingsDirectoryExists: async () => settingsDir }
	Object.assign(hub, { providerRef: new WeakRef(provider) })
	return hub.getMcpSettingsFilePath()
}

describe("McpHub settings file creation", () => {
	let settingsDir: string
	const originalOverride = process.env[MCP_SETTINGS_PATH_ENV]

	beforeEach(async () => {
		delete process.env[MCP_SETTINGS_PATH_ENV]
		existence.reportAbsent = false
		settingsDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-settings-create-"))
	})

	afterEach(async () => {
		if (originalOverride === undefined) {
			delete process.env[MCP_SETTINGS_PATH_ENV]
		} else {
			process.env[MCP_SETTINGS_PATH_ENV] = originalOverride
		}
		await fs.rm(settingsDir, { recursive: true, force: true })
	})

	it("creates an empty settings file when none exists", async () => {
		const settingsPath = await settingsPathFor(settingsDir)

		expect(JSON.parse(await fs.readFile(settingsPath, "utf8"))).toEqual({ mcpServers: {} })
	})

	it("keeps a config another process wrote after the existence check", async () => {
		const settingsPath = path.join(settingsDir, "mcp_settings.json")
		const concurrent = JSON.stringify({ mcpServers: { github: { command: "gh-mcp" } } }, null, 2)
		await fs.writeFile(settingsPath, concurrent)
		existence.reportAbsent = true

		expect(await settingsPathFor(settingsDir)).toBe(settingsPath)

		expect(await fs.readFile(settingsPath, "utf8")).toBe(concurrent)
	})
})
