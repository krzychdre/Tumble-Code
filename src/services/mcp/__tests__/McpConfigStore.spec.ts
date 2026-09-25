// cd src && ./node_modules/.bin/vitest run services/mcp/__tests__/McpConfigStore.spec.ts

import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import { McpConfigStore } from "../McpConfigStore"

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

// A plain write instead of the locked one, so the write-guard tests can fake the timers.
vi.mock("../../../utils/safeWriteJson", () => ({
	safeWriteJson: vi.fn(async (filePath: string, data: unknown) => {
		const fs = await import("fs/promises")
		await fs.writeFile(filePath, JSON.stringify(data, null, "\t"))
	}),
}))

// Redirects the settings file (the CLI sets it); cleared so the file lands in the temp dir.
const MCP_SETTINGS_PATH_ENV = "ROO_MCP_SETTINGS_PATH"

describe("McpConfigStore", () => {
	let settingsDir: string
	let workspaceDir: string
	let store: McpConfigStore
	const originalOverride = process.env[MCP_SETTINGS_PATH_ENV]

	const projectPath = () => path.join(workspaceDir, ".roo", "mcp.json")
	const writeProjectFile = async (content: string) => {
		await fs.mkdir(path.dirname(projectPath()), { recursive: true })
		await fs.writeFile(projectPath(), content)
	}

	beforeEach(async () => {
		delete process.env[MCP_SETTINGS_PATH_ENV]
		existence.reportAbsent = false
		settingsDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-settings-create-"))
		workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-workspace-"))
		store = new McpConfigStore({ settingsDirectory: async () => settingsDir, workspacePath: () => workspaceDir })
	})

	afterEach(async () => {
		vi.useRealTimers()
		store.dispose()
		if (originalOverride === undefined) {
			delete process.env[MCP_SETTINGS_PATH_ENV]
		} else {
			process.env[MCP_SETTINGS_PATH_ENV] = originalOverride
		}
		await fs.rm(settingsDir, { recursive: true, force: true })
		await fs.rm(workspaceDir, { recursive: true, force: true })
	})

	describe("the global settings file", () => {
		it("creates an empty settings file when none exists", async () => {
			const settingsPath = await store.getGlobalPath()

			expect(settingsPath).toBe(path.join(settingsDir, "mcp_settings.json"))
			expect(JSON.parse(await fs.readFile(settingsPath, "utf8"))).toEqual({ mcpServers: {} })
		})

		it("keeps a config another process wrote after the existence check", async () => {
			const settingsPath = path.join(settingsDir, "mcp_settings.json")
			const concurrent = JSON.stringify({ mcpServers: { github: { command: "gh-mcp" } } }, null, 2)
			await fs.writeFile(settingsPath, concurrent)
			existence.reportAbsent = true

			expect(await store.getGlobalPath()).toBe(settingsPath)

			expect(await fs.readFile(settingsPath, "utf8")).toBe(concurrent)
		})
	})

	describe("the project file", () => {
		it("is .roo/mcp.json in the workspace when it exists", async () => {
			expect(await store.getProjectPath()).toBeNull()
			expect(await store.getPath("project")).toBeNull()

			await writeProjectFile("{}")

			expect(await store.getProjectPath()).toBe(projectPath())
			expect(await store.getPath("project")).toBe(projectPath())
		})
	})

	describe("readValidated", () => {
		it("returns the servers with the defaults applied", async () => {
			await writeProjectFile(JSON.stringify({ mcpServers: { a: { command: "node" } } }))

			const result = await store.readValidated(projectPath())

			expect(result.status).toBe("valid")
			expect(result.status === "valid" && result.servers.a).toMatchObject({
				type: "stdio",
				command: "node",
				timeout: 60,
				alwaysAllow: [],
			})
		})

		it("reports invalid JSON", async () => {
			await writeProjectFile("{ not json")

			const result = await store.readValidated(projectPath())

			expect(result.status).toBe("invalid-json")
			expect(result.status === "invalid-json" && result.error).toBeInstanceOf(SyntaxError)
		})

		it("reports schema problems one per line and keeps the parsed file", async () => {
			const raw = { mcpServers: { a: { command: "" }, b: { command: "node" } } }
			await writeProjectFile(JSON.stringify(raw))

			expect(await store.readValidated(projectPath())).toEqual({
				status: "invalid-schema",
				errorMessages: "mcpServers.a: Invalid input",
				raw,
			})
		})

		it("throws when the file cannot be read", async () => {
			await expect(store.readValidated(projectPath())).rejects.toMatchObject({ code: "ENOENT" })
		})
	})

	describe("readServerOrder", () => {
		it("lists the servers in file order", async () => {
			await writeProjectFile(JSON.stringify({ mcpServers: { z: {}, a: {}, m: {} } }))

			expect(await store.readServerOrder("project")).toEqual(["z", "a", "m"])
		})

		it("is empty without a project file or with a broken one", async () => {
			expect(await store.readServerOrder("project")).toEqual([])

			await writeProjectFile("{ half written")
			const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
			try {
				expect(await store.readServerOrder("project")).toEqual([])
			} finally {
				consoleError.mockRestore()
			}
		})
	})

	describe("readForUpdate", () => {
		it("returns the path and the parsed file", async () => {
			await writeProjectFile(JSON.stringify({ mcpServers: { a: { command: "node" } } }))

			expect(await store.readForUpdate("project")).toEqual({
				path: projectPath(),
				config: { mcpServers: { a: { command: "node" } } },
			})
		})

		it("fails without a project file", async () => {
			await expect(store.readForUpdate("project")).rejects.toThrow("Project MCP configuration file not found")
		})

		it("fails when the file does not hold an object", async () => {
			await writeProjectFile("null")

			await expect(store.readForUpdate("project")).rejects.toThrow("Invalid config structure")
		})
	})

	describe("the write guard", () => {
		it("is up while writing and for 600 ms after the write", async () => {
			vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
			const settingsPath = await store.getGlobalPath()
			expect(store.isWriteGuardUp()).toBe(false)

			await store.write(settingsPath, { mcpServers: { a: { command: "node" } } })

			expect(JSON.parse(await fs.readFile(settingsPath, "utf8"))).toEqual({
				mcpServers: { a: { command: "node" } },
			})
			expect(store.isWriteGuardUp()).toBe(true)
			vi.advanceTimersByTime(599)
			expect(store.isWriteGuardUp()).toBe(true)
			vi.advanceTimersByTime(1)
			expect(store.isWriteGuardUp()).toBe(false)
		})

		it("restarts the 600 ms with every write", async () => {
			vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
			const settingsPath = await store.getGlobalPath()

			await store.write(settingsPath, { mcpServers: {} })
			vi.advanceTimersByTime(400)
			await store.write(settingsPath, { mcpServers: {} })
			vi.advanceTimersByTime(599)
			expect(store.isWriteGuardUp()).toBe(true)
			vi.advanceTimersByTime(1)
			expect(store.isWriteGuardUp()).toBe(false)
		})

		it("is up only for the file that was written", async () => {
			vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
			const settingsPath = await store.getGlobalPath()
			await writeProjectFile("{}")

			await store.write(settingsPath, { mcpServers: {} })

			expect(store.isWriteGuardUp(settingsPath)).toBe(true)
			expect(store.isWriteGuardUp(projectPath())).toBe(false)

			vi.advanceTimersByTime(300)
			await store.write(projectPath(), { mcpServers: {} })
			vi.advanceTimersByTime(300)
			// The global guard runs out on its own clock, the project one keeps going.
			expect(store.isWriteGuardUp(settingsPath)).toBe(false)
			expect(store.isWriteGuardUp(projectPath())).toBe(true)
			vi.advanceTimersByTime(300)
			expect(store.isWriteGuardUp(projectPath())).toBe(false)
		})

		it("matches the written file however its path is spelled", async () => {
			vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
			await writeProjectFile("{}")

			await store.write(projectPath(), { mcpServers: {} })

			expect(store.isWriteGuardUp(path.join(workspaceDir, ".roo", ".", "mcp.json"))).toBe(true)
		})

		it("goes down on dispose", async () => {
			vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
			await store.write(await store.getGlobalPath(), { mcpServers: {} })

			store.dispose()

			expect(store.isWriteGuardUp()).toBe(false)
			expect(vi.getTimerCount()).toBe(0)
		})
	})
})
