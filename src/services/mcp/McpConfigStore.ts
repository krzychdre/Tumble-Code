import * as fs from "fs/promises"
import * as path from "path"

import { fileExistsAtPath } from "../../utils/fs"
import { safeWriteJson } from "../../utils/safeWriteJson"

import { formatSchemaIssues, type McpConfigSource, type McpServerConfig, McpSettingsSchema } from "./mcpConfigSchema"
import { getGlobalMcpSettingsPath } from "./mcpSettingsPath"

const EMPTY_SETTINGS_FILE = `{
  "mcpServers": {

  }
}`

/** A settings file read and checked against the schema. */
export type McpConfigReadResult =
	| { status: "valid"; servers: Record<string, McpServerConfig> }
	| { status: "invalid-json"; error: SyntaxError }
	/** `raw` is the parsed file, for callers that still use the entries that are valid. */
	| { status: "invalid-schema"; errorMessages: string; raw: any }

export interface McpConfigStoreOptions {
	/** The settings directory (created when missing); the global file lives there unless overridden. */
	settingsDirectory: () => Promise<string>
	/** The workspace whose `.roo/mcp.json` is the project file. */
	workspacePath: () => string
}

/**
 * The MCP settings files on disk: where they are, reading and parsing them,
 * and writing them with the write guard up.
 *
 * The write guard is one flag for both files: while it is up (for
 * WRITE_GUARD_MS after a write ends), McpConfigWatcher ignores change events,
 * so the hub's own edits do not update the servers a second time.
 */
export class McpConfigStore {
	static readonly WRITE_GUARD_MS = 600

	private writeGuardUp = false
	private writeGuardTimer?: NodeJS.Timeout

	constructor(private readonly options: McpConfigStoreOptions) {}

	/** The global settings file; created with an empty server list when missing. */
	async getGlobalPath(): Promise<string> {
		const settingsPath = getGlobalMcpSettingsPath(await this.options.settingsDirectory())
		if (!(await fileExistsAtPath(settingsPath))) {
			// An override's directory may not exist yet (a fresh ~/.roo), and
			// the watcher set up in the hub's constructor must not fail on it.
			await fs.mkdir(path.dirname(settingsPath), { recursive: true })
			// Exclusive create ("wx"): another window, or the CLI sharing this file, may have
			// written its config since the check above. That file must win over the empty stub,
			// so EEXIST counts as success instead of being overwritten.
			try {
				await fs.writeFile(settingsPath, EMPTY_SETTINGS_FILE, { flag: "wx" })
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
					throw error
				}
			}
		}
		return settingsPath
	}

	/** The project file (`.roo/mcp.json` in the workspace), or null when there is none. */
	async getProjectPath(): Promise<string | null> {
		const projectPath = path.join(this.options.workspacePath(), ".roo", "mcp.json")
		try {
			await fs.access(projectPath)
			return projectPath
		} catch {
			return null
		}
	}

	/** The settings file of a source; null for a workspace without a project file. */
	async getPath(source: McpConfigSource): Promise<string | null> {
		return source === "global" ? this.getGlobalPath() : this.getProjectPath()
	}

	/** Reads and parses a settings file. Throws on read errors and on invalid JSON (SyntaxError). */
	async readFile(filePath: string): Promise<any> {
		return JSON.parse(await fs.readFile(filePath, "utf-8"))
	}

	/** Reads a settings file and checks it against the schema. Throws on read errors. */
	async readValidated(filePath: string): Promise<McpConfigReadResult> {
		let raw: any
		try {
			raw = await this.readFile(filePath)
		} catch (error) {
			if (error instanceof SyntaxError) {
				return { status: "invalid-json", error }
			}
			throw error
		}
		const result = McpSettingsSchema.safeParse(raw)
		if (!result.success) {
			return { status: "invalid-schema", errorMessages: formatSchemaIssues(result.error, "\n"), raw }
		}
		return { status: "valid", servers: result.data.mcpServers || {} }
	}

	/** The `mcpServers` section of a source's file as written; {} without a project file. Throws on read errors. */
	async readServerEntries(source: McpConfigSource): Promise<Record<string, any>> {
		const filePath = await this.getPath(source)
		if (!filePath) {
			return {}
		}
		return (await this.readFile(filePath))?.mcpServers ?? {}
	}

	/** Server names in file order; [] when the file is missing or cannot be read. */
	async readServerOrder(source: McpConfigSource): Promise<string[]> {
		try {
			return Object.keys(await this.readServerEntries(source))
		} catch (error) {
			// An unreadable or half-written settings file only loses the display order.
			console.error(`Failed to read ${source} MCP settings for server order:`, error)
			return []
		}
	}

	/**
	 * Reads a source's file for an edit.
	 * @throws Error when there is no project file, the file cannot be accessed,
	 * or it does not hold a JSON object
	 */
	async readForUpdate(source: McpConfigSource): Promise<{ path: string; config: Record<string, any> }> {
		const filePath = await this.getPath(source)
		if (!filePath) {
			throw new Error("Project MCP configuration file not found")
		}
		try {
			await fs.access(filePath)
		} catch (error) {
			console.error("Settings file not accessible:", error)
			throw new Error("Settings file not accessible")
		}
		const config = await this.readFile(filePath)
		if (!config || typeof config !== "object") {
			throw new Error("Invalid config structure")
		}
		return { path: filePath, config }
	}

	/** Writes a settings file with the write guard up. */
	async write(filePath: string, config: unknown): Promise<void> {
		if (this.writeGuardTimer) {
			clearTimeout(this.writeGuardTimer)
		}
		this.writeGuardUp = true
		try {
			await safeWriteJson(filePath, config, { prettyPrint: true })
		} finally {
			// Lower the guard once the watcher's debounce window has passed (non-blocking).
			this.writeGuardTimer = setTimeout(() => {
				this.writeGuardUp = false
				this.writeGuardTimer = undefined
			}, McpConfigStore.WRITE_GUARD_MS)
		}
	}

	/** Whether a change event now is most likely the echo of the store's own write. */
	isWriteGuardUp(): boolean {
		return this.writeGuardUp
	}

	dispose(): void {
		if (this.writeGuardTimer) {
			clearTimeout(this.writeGuardTimer)
			this.writeGuardTimer = undefined
		}
		this.writeGuardUp = false
	}
}
