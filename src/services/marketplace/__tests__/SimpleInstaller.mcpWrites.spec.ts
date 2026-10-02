// npx vitest services/marketplace/__tests__/SimpleInstaller.mcpWrites.spec.ts
//
// The marketplace edits real MCP settings files here: the write must go through
// McpConfigStore, and a write that fails half way must leave the old file as it was.

import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import type { MarketplaceItem } from "@tumble-code/types"

import { McpConfigStore } from "../../mcp/McpConfigStore"
import { SimpleInstaller } from "../SimpleInstaller"

const dirs = vi.hoisted(() => ({ workspace: "", global: "" }))

vi.mock("fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("fs/promises")>()
	return { ...actual, rename: vi.fn(actual.rename) }
})

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

const mcpItem: MarketplaceItem = {
	id: "new-server",
	name: "New Server",
	description: "A server",
	type: "mcp",
	url: "https://example.com/mcp",
	content: JSON.stringify({ command: "new-server", args: [] }),
}

const original = JSON.stringify({ mcpServers: { existing: { command: "existing", args: [] } } }, null, 2)

describe("SimpleInstaller MCP settings writes", () => {
	let root: string
	let projectFile: string
	let installer: SimpleInstaller

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "marketplace-mcp-"))
		dirs.workspace = path.join(root, "workspace")
		dirs.global = path.join(root, "global")
		await fs.mkdir(path.join(dirs.workspace, ".roo"), { recursive: true })
		await fs.mkdir(dirs.global, { recursive: true })
		projectFile = path.join(dirs.workspace, ".roo", "mcp.json")
		await fs.writeFile(projectFile, original)
		installer = new SimpleInstaller({} as any, {} as any)
	})

	afterEach(async () => {
		vi.restoreAllMocks()
		await fs.rm(root, { recursive: true, force: true })
	})

	it("installs through McpConfigStore and keeps the existing servers", async () => {
		const write = vi.spyOn(McpConfigStore.prototype, "write")

		const result = await installer.installItem(mcpItem, { target: "project" })

		expect(result.filePath).toBe(projectFile)
		expect(write).toHaveBeenCalledWith(projectFile, expect.anything())
		const written = JSON.parse(await fs.readFile(projectFile, "utf-8"))
		expect(Object.keys(written.mcpServers)).toEqual(["existing", "new-server"])
		// The line points at the new server in the file as written.
		const lines = (await fs.readFile(projectFile, "utf-8")).split("\n")
		expect(lines[result.line! - 1]).toContain('"new-server"')
	})

	it("leaves the original file intact when the write fails half way", async () => {
		vi.mocked(fs.rename).mockRejectedValueOnce(new Error("disk full"))

		await expect(installer.installItem(mcpItem, { target: "project" })).rejects.toThrow("disk full")

		expect(await fs.readFile(projectFile, "utf-8")).toBe(original)
		// No temporary file is left next to it.
		expect(await fs.readdir(path.dirname(projectFile))).toEqual(["mcp.json"])
	})

	it("removes a server through McpConfigStore", async () => {
		const write = vi.spyOn(McpConfigStore.prototype, "write")
		const existingItem = { ...mcpItem, id: "existing" }

		await installer.removeItem(existingItem, { target: "project" })

		expect(write).toHaveBeenCalledWith(projectFile, expect.anything())
		expect(JSON.parse(await fs.readFile(projectFile, "utf-8")).mcpServers).toEqual({})
	})

	it("refuses to remove from a corrupt file instead of reporting success", async () => {
		await fs.writeFile(projectFile, '{ "mcpServers": { broken')

		await expect(installer.removeItem({ ...mcpItem, id: "existing" }, { target: "project" })).rejects.toThrow(
			"contains invalid JSON",
		)
		expect(await fs.readFile(projectFile, "utf-8")).toBe('{ "mcpServers": { broken')
	})
})
