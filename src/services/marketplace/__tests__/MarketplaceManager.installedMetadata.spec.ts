// npx vitest services/marketplace/__tests__/MarketplaceManager.installedMetadata.spec.ts
//
// What the marketplace shows as installed comes from the real modes and MCP settings files.
// A file that cannot be parsed must be reported, not read as "nothing installed", and must
// not hide what the other files hold.

import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import { MarketplaceManager } from "../MarketplaceManager"
import { logger } from "../../../utils/logging"

const dirs = vi.hoisted(() => ({ workspace: "", global: "" }))

vi.mock("@tumble-code/cloud", () => ({
	CloudService: { hasInstance: vi.fn(() => false) },
}))

vi.mock("@tumble-code/telemetry", () => ({
	TelemetryService: { instance: { capture: vi.fn() } },
}))

vi.mock("vscode", () => ({
	workspace: {
		get workspaceFolders() {
			return [{ uri: { fsPath: dirs.workspace }, name: "test", index: 0 }]
		},
	},
}))

vi.mock("../../../utils/globalContext", () => ({
	ensureSettingsDirectoryExists: async () => dirs.global,
}))

describe("MarketplaceManager.getInstallationMetadata", () => {
	let root: string

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "marketplace-meta-"))
		dirs.workspace = path.join(root, "workspace")
		dirs.global = path.join(root, "global")
		await fs.mkdir(path.join(dirs.workspace, ".roo"), { recursive: true })
		await fs.mkdir(dirs.global, { recursive: true })
	})

	afterEach(async () => {
		vi.restoreAllMocks()
		await fs.rm(root, { recursive: true, force: true })
	})

	it("collects modes and MCP servers from the project and global files", async () => {
		await fs.writeFile(path.join(dirs.workspace, ".roomodes"), "customModes:\n  - slug: project-mode\n")
		await fs.writeFile(
			path.join(dirs.workspace, ".roo", "mcp.json"),
			JSON.stringify({ mcpServers: { "project-server": {} } }),
		)
		await fs.writeFile(path.join(dirs.global, "custom_modes.yaml"), "customModes:\n  - slug: global-mode\n")
		await fs.writeFile(path.join(dirs.global, "mcp_settings.json"), JSON.stringify({ mcpServers: { g: {} } }))

		const metadata = await new MarketplaceManager({} as any).getInstallationMetadata()

		expect(metadata).toEqual({
			project: { "project-mode": { type: "mode" }, "project-server": { type: "mcp" } },
			global: { "global-mode": { type: "mode" }, g: { type: "mcp" } },
		})
	})

	it("reports a corrupt mcp.json and still lists the other installed items", async () => {
		const error = vi.spyOn(logger, "error").mockImplementation(() => {})
		const corruptFile = path.join(dirs.workspace, ".roo", "mcp.json")
		await fs.writeFile(path.join(dirs.workspace, ".roomodes"), "customModes:\n  - slug: project-mode\n")
		await fs.writeFile(corruptFile, '{ "mcpServers": { broken')

		const metadata = await new MarketplaceManager({} as any).getInstallationMetadata()

		expect(error).toHaveBeenCalledWith(expect.stringContaining(corruptFile), expect.any(SyntaxError))
		expect(metadata.project).toEqual({ "project-mode": { type: "mode" } })
	})

	it("does not report files that do not exist", async () => {
		const error = vi.spyOn(logger, "error").mockImplementation(() => {})

		const metadata = await new MarketplaceManager({} as any).getInstallationMetadata()

		expect(metadata).toEqual({ project: {}, global: {} })
		expect(error).not.toHaveBeenCalled()
	})
})
