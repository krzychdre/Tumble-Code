// cd src && ./node_modules/.bin/vitest run core/config/__tests__/CustomModesManager.spec.ts

// Real files in a temp directory (home, workspace, extension storage); only
// vscode (the shared __mocks__/vscode.js, which utils/path is bound to), the
// home directory and the i18n strings are replaced.

import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import * as yaml from "yaml"
import * as vscode from "vscode"
import type { Mock } from "vitest"

import type { ModeConfig } from "@tumble-code/types"
import { writeFileAtomic } from "@tumble-code/core/fs"

import { CustomModesManager } from "../CustomModesManager"
import { GlobalFileNames } from "../../../shared/globalFileNames"
import { logger } from "../../../utils/logging"

const dirs = vi.hoisted(() => ({ home: "" }))

vi.mock("os", async (importOriginal) => {
	const actual = await importOriginal<typeof import("os")>()
	const homedir = () => dirs.home
	return { ...actual, homedir, default: { ...actual, homedir } }
})

// Pass-through, so a test can make one call fail.
vi.mock("fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("fs/promises")>()
	const api = { ...actual, rm: vi.fn(actual.rm), mkdir: vi.fn(actual.mkdir) }
	return { ...api, default: api }
})

vi.mock("@tumble-code/core/fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@tumble-code/core/fs")>()
	return { ...actual, writeFileAtomic: vi.fn(actual.writeFileAtomic) }
})

// Echo the key and its options, so a test can see what a message would say.
vi.mock("../../../i18n", () => ({
	t: (key: string, options?: Record<string, unknown>) => (options ? `${key} ${JSON.stringify(options)}` : key),
}))

const mode = (slug: string, extra: Partial<ModeConfig> = {}): ModeConfig => ({
	slug,
	name: slug,
	roleDefinition: "role",
	groups: ["read"],
	...extra,
})

describe("CustomModesManager", () => {
	let root: string
	let workspace: string
	let settingsPath: string
	let roomodesPath: string
	let context: vscode.ExtensionContext
	let globalStateUpdate: Mock
	let onUpdate: Mock
	let manager: CustomModesManager

	const write = async (filePath: string, content: string) => {
		await fs.mkdir(path.dirname(filePath), { recursive: true })
		await fs.writeFile(filePath, content)
	}
	const writeModes = (filePath: string, modes: object[]) => write(filePath, yaml.stringify({ customModes: modes }))
	const readModes = async (filePath: string) =>
		yaml.parse(await fs.readFile(filePath, "utf-8")).customModes as ModeConfig[]
	const exists = (filePath: string) =>
		fs.access(filePath).then(
			() => true,
			() => false,
		)
	const projectRules = (slug: string) => path.join(workspace, ".roo", `rules-${slug}`)
	const globalRules = (slug: string) => path.join(dirs.home, ".roo", `rules-${slug}`)
	const slugsAndSources = (modes: ModeConfig[]) => modes.map((m) => `${m.source}:${m.slug}`)
	const setWorkspace = (folder: string | undefined) => {
		;(vscode.workspace as any).workspaceFolders = folder ? [{ uri: { fsPath: folder } }] : []
	}

	beforeEach(async () => {
		vi.clearAllMocks()
		vi.spyOn(vscode.window, "showErrorMessage").mockResolvedValue(undefined)
		vi.spyOn(vscode.window, "showWarningMessage").mockResolvedValue(undefined)
		root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "custom-modes-")))
		dirs.home = path.join(root, "home")
		workspace = path.join(root, "workspace")
		await fs.mkdir(workspace, { recursive: true })
		settingsPath = path.join(root, "storage", "settings", GlobalFileNames.customModes)
		roomodesPath = path.join(workspace, ".roomodes")
		setWorkspace(workspace)
		globalStateUpdate = vi.fn()
		onUpdate = vi.fn()
		context = {
			globalStorageUri: { fsPath: path.join(root, "storage") },
			globalState: { get: vi.fn(), update: globalStateUpdate },
		} as unknown as vscode.ExtensionContext
		await writeModes(settingsPath, [])
		manager = new CustomModesManager(context, onUpdate)
	})

	afterEach(async () => {
		manager.dispose()
		vi.restoreAllMocks()
		await fs.rm(root, { recursive: true, force: true, maxRetries: 5 })
	})

	describe("reading modes", () => {
		it("lists the .roomodes modes first, hides a global mode with the same slug and records the merge", async () => {
			await writeModes(settingsPath, [mode("mode1"), mode("mode2", { name: "global two" })])
			await writeModes(roomodesPath, [mode("mode2", { name: "project two" }), mode("mode3")])

			const modes = await manager.getCustomModes()

			expect(slugsAndSources(modes)).toEqual(["project:mode2", "project:mode3", "global:mode1"])
			expect(modes[0].name).toBe("project two")
			expect(globalStateUpdate).toHaveBeenCalledWith("customModes", modes)
		})

		it.each([
			["there is no .roomodes", () => {}],
			["no workspace is open", () => setWorkspace(undefined)],
		])("lists the global modes alone when %s", async (_label, arrange) => {
			await writeModes(settingsPath, [mode("mode1")])
			arrange()

			expect(slugsAndSources(await manager.getCustomModes())).toEqual(["global:mode1"])
		})

		it("logs a .roomodes that cannot be read once and loads the global modes alone", async () => {
			await writeModes(settingsPath, [mode("mode1")])
			await fs.mkdir(roomodesPath)
			const loggerError = vi.spyOn(logger, "error").mockImplementation(() => {})

			const modes = await manager.getCustomModes()

			expect(slugsAndSources(modes)).toEqual(["global:mode1"])
			expect(loggerError).toHaveBeenCalledTimes(1)
			expect(loggerError.mock.calls[0][0]).toContain(`Failed to load modes from ${roomodesPath}: `)
		})

		it("shows the line of a YAML error in .roomodes and loads the other modes", async () => {
			await writeModes(settingsPath, [mode("mode1")])
			await write(roomodesPath, 'customModes:\n  - slug: "a"\n    name: "unterminated\n    groups: []')
			vi.spyOn(logger, "error").mockImplementation(() => {})

			expect(slugsAndSources(await manager.getCustomModes())).toEqual(["global:mode1"])
			const [message] = vi.mocked(vscode.window.showErrorMessage).mock.calls[0]
			expect(message).toContain("common:customModes.errors.yamlParseError")
			expect(message).not.toContain('"line":"unknown"')
		})

		it("lists the schema problems of .roomodes for the user", async () => {
			await writeModes(roomodesPath, [{ slug: "a", name: "A", groups: ["read"] }])
			vi.spyOn(logger, "error").mockImplementation(() => {})

			expect(await manager.getCustomModes()).toEqual([])
			const [message] = vi.mocked(vscode.window.showErrorMessage).mock.calls[0]
			expect(message).toContain("common:customModes.errors.schemaValidationError")
			expect(message).toContain("• customModes.0.roleDefinition: ")
		})

		it.each([
			["invalid YAML", "customModes: [invalid yaml content"],
			["a schema problem", yaml.stringify({ customModes: [{ slug: "a" }] })],
		])("only logs %s in the global file", async (_label, content) => {
			await write(settingsPath, content)
			const loggerError = vi.spyOn(logger, "error").mockImplementation(() => {})

			expect(await manager.getCustomModes()).toEqual([])
			expect(loggerError).toHaveBeenCalled()
			expect(vscode.window.showErrorMessage).not.toHaveBeenCalled()
		})

		it.each([
			["a byte order mark", "\uFEFF", "role", "role"],
			["two byte order marks", "\uFEFF\uFEFF", "role", "role"],
			["non-breaking spaces", "", "a\u00A0role", "a role"],
			["zero-width characters", "", "a\u200Br\u200Co\u200Dle", "arole"],
			["smart quotes", "", "x \u2018a\u2019 \u201Cb\u201D", "x 'a' \"b\""],
			["typographic dashes", "", "a\u2010b\u2011c\u2012d\u2013e\u2014f\u2015g\u2212h", "a-b-c-d-e-f-g-h"],
		])("cleans %s out of a mode file", async (_label, prefix, roleDefinition, expected) => {
			await write(
				roomodesPath,
				`${prefix}customModes:\n  - slug: "a"\n    name: "A"\n    roleDefinition: ${roleDefinition}\n    groups: ["read"]`,
			)

			const [loaded] = await manager.getCustomModes()

			expect(loaded.roleDefinition).toBe(expected)
		})

		it("serves the modes from a cache for 10 seconds", async () => {
			const now = vi.spyOn(Date, "now").mockReturnValue(1_000)
			await writeModes(settingsPath, [mode("mode1")])
			const first = await manager.getCustomModes()
			await writeModes(settingsPath, [mode("mode2")])

			now.mockReturnValue(10_999)
			expect(await manager.getCustomModes()).toBe(first)

			now.mockReturnValue(11_000)
			expect(slugsAndSources(await manager.getCustomModes())).toEqual(["global:mode2"])
		})

		// A fresh profile has no custom_modes.yaml yet: getCustomModesFilePath queues
		// its creation and returns before the write ran when another write is in flight.
		it("reads no modes and logs nothing while the settings file is still being created", async () => {
			await fs.rm(settingsPath)
			const loggerError = vi.spyOn(logger, "error").mockImplementation(() => {})

			const results = await Promise.all([manager.getCustomModes(), manager.getCustomModes()])

			expect(results).toEqual([[], []])
			expect(loggerError).not.toHaveBeenCalled()
			await vi.waitFor(async () => expect(await readModes(settingsPath)).toEqual([]))
		})
	})

	// Rules directories are keyed on the mode slug; one named after anything else is never loaded.
	describe("orphaned rules directories", () => {
		const warnedPaths = (warn: Mock) =>
			warn.mock.calls
				.filter(([message]) => String(message).includes("matches no mode"))
				.map(([, meta]) => meta.path)

		it("warns once per session about rules directories that match no mode", async () => {
			await writeModes(settingsPath, [mode("reviewer")])
			for (const dir of ["rules-reviewer", "rules-code-reviewer", "rules-code", "rules", "commands"]) {
				await fs.mkdir(path.join(dirs.home, ".roo", dir), { recursive: true })
			}
			await write(path.join(dirs.home, ".roo", "rules-notadir"), "x")
			await fs.mkdir(projectRules("ghost"), { recursive: true })
			const warn = vi.spyOn(logger, "warn").mockImplementation(() => {}) as unknown as Mock
			const now = vi.spyOn(Date, "now").mockReturnValue(1_000)

			await manager.getCustomModes()
			await vi.waitFor(() => expect(warnedPaths(warn)).toHaveLength(2))
			now.mockReturnValue(100_000)
			await manager.getCustomModes()
			await new Promise((resolve) => setImmediate(resolve))

			expect(warnedPaths(warn)).toEqual([globalRules("code-reviewer"), projectRules("ghost")])
		})
	})

	describe("updateCustomMode", () => {
		it("writes a global mode to the settings file and keeps a .roomodes mode of that slug in front", async () => {
			await writeModes(settingsPath, [mode("mode2")])
			await writeModes(roomodesPath, [mode("mode1", { name: "project one" })])
			const roomodesBefore = await fs.readFile(roomodesPath, "utf-8")
			await manager.getCustomModes()

			await manager.updateCustomMode("mode1", mode("mode1", { name: "global one", source: "global" }))

			expect(await fs.readFile(roomodesPath, "utf-8")).toBe(roomodesBefore)
			expect((await readModes(settingsPath)).map((m) => [m.slug, m.name, m.source])).toEqual([
				["mode2", "mode2", undefined],
				["mode1", "global one", "global"],
			])
			const merged = globalStateUpdate.mock.calls.at(-1)![1]
			expect(merged.map((m: ModeConfig) => `${m.source}:${m.slug}:${m.name}`)).toEqual([
				"project:mode1:project one",
				"global:mode2:mode2",
			])
			expect(onUpdate).toHaveBeenCalled()
			// The cache was cleared: the next read sees the file.
			expect((await manager.getCustomModes()).map((m) => m.slug)).toEqual(["mode1", "mode2"])
		})

		it("creates .roomodes for a project mode and leaves the settings file alone", async () => {
			const settingsBefore = await fs.readFile(settingsPath, "utf-8")

			await manager.updateCustomMode("p", mode("p", { source: "project" }))

			expect(await readModes(roomodesPath)).toEqual([mode("p", { source: "project" })])
			expect(await fs.readFile(settingsPath, "utf-8")).toBe(settingsBefore)
			expect((await fs.readdir(workspace)).sort()).toEqual([".roomodes"])
		})

		it("queues concurrent updates so both land", async () => {
			await Promise.all([
				manager.updateCustomMode("mode1", mode("mode1", { source: "global" })),
				manager.updateCustomMode("mode2", mode("mode2", { source: "global" })),
			])

			expect((await readModes(settingsPath)).map((m) => m.slug).sort()).toEqual(["mode1", "mode2"])
		})

		it("replaces a settings file with broken YAML by a valid one", async () => {
			await write(settingsPath, "customModes: [invalid yaml content")
			vi.spyOn(logger, "error").mockImplementation(() => {})

			await manager.updateCustomMode("a", mode("a", { source: "global" }))

			expect(await readModes(settingsPath)).toEqual([mode("a", { source: "global" })])
		})

		it.each([
			[
				"an invalid mode",
				mode("bad slug"),
				"Invalid mode configuration: slug: Slug must contain only letters numbers and dashes",
			],
			["a project mode without a workspace", mode("p", { source: "project" }), "noWorkspaceForProject"],
		])("refuses %s and tells the user", async (_label, config, error) => {
			setWorkspace(config.source === "project" ? undefined : workspace)
			vi.spyOn(logger, "error").mockImplementation(() => {})
			const settingsBefore = await fs.readFile(settingsPath, "utf-8")

			await expect(manager.updateCustomMode(config.slug, config)).rejects.toThrow(error)

			expect(vi.mocked(vscode.window.showErrorMessage).mock.calls.at(-1)![0]).toContain(
				"common:customModes.errors.updateFailed",
			)
			expect(await fs.readFile(settingsPath, "utf-8")).toBe(settingsBefore)
		})

		it("rejects and tells the user when the file cannot be written", async () => {
			vi.mocked(writeFileAtomic).mockRejectedValueOnce(new Error("ENOSPC: no space left on device"))
			vi.spyOn(logger, "error").mockImplementation(() => {})

			await expect(manager.updateCustomMode("a", mode("a", { source: "global" }))).rejects.toThrow("ENOSPC")

			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				`common:customModes.errors.updateFailed ${JSON.stringify({ error: "ENOSPC: no space left on device" })}`,
			)
		})
	})

	describe("deleteCustomMode", () => {
		it("deletes a global mode and refreshes the state", async () => {
			await writeModes(settingsPath, [mode("gone"), mode("kept")])
			await manager.getCustomModes()

			await manager.deleteCustomMode("gone")

			expect((await readModes(settingsPath)).map((m) => m.slug)).toEqual(["kept"])
			expect(globalStateUpdate).toHaveBeenLastCalledWith("customModes", [mode("kept", { source: "global" })])
			expect(onUpdate).toHaveBeenCalled()
			expect((await manager.getCustomModes()).map((m) => m.slug)).toEqual(["kept"])
		})

		it("deletes a mode from both files and the project rules folder", async () => {
			await writeModes(settingsPath, [mode("both")])
			await writeModes(roomodesPath, [mode("both")])
			await write(path.join(projectRules("both"), "rule.md"), "rule")
			await write(path.join(globalRules("both"), "rule.md"), "rule")

			await manager.deleteCustomMode("both")

			expect(await readModes(settingsPath)).toEqual([])
			expect(await readModes(roomodesPath)).toEqual([])
			expect(await exists(projectRules("both"))).toBe(false)
			expect(await exists(globalRules("both"))).toBe(true)
		})

		it("deletes a global mode's rules folder under the home directory", async () => {
			await writeModes(settingsPath, [mode("g")])
			await write(path.join(globalRules("g"), "rule.md"), "rule")

			await manager.deleteCustomMode("g")

			expect(await exists(globalRules("g"))).toBe(false)
		})

		it.each([
			[false, "common:customModes.errors.rulesCleanupFailed"],
			[true, "common:marketplace.mode.rulesCleanupFailed"],
		])(
			"still deletes the mode when its rules folder cannot be removed (marketplace: %s)",
			async (fromMarketplace, key) => {
				await writeModes(roomodesPath, [mode("p")])
				await write(path.join(projectRules("p"), "rule.md"), "rule")
				vi.mocked(fs.rm).mockRejectedValueOnce(new Error("Permission denied"))
				vi.spyOn(logger, "error").mockImplementation(() => {})

				await manager.deleteCustomMode("p", fromMarketplace)

				expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
					`${key} ${JSON.stringify({ rulesFolderPath: projectRules("p") })}`,
				)
				expect(await readModes(roomodesPath)).toEqual([])
			},
		)

		it("tells the user about a mode that does not exist", async () => {
			await manager.deleteCustomMode("nope")

			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				`common:customModes.errors.deleteFailed ${JSON.stringify({ error: "common:customModes.errors.modeNotFound" })}`,
			)
		})
	})

	describe("resetCustomModes", () => {
		it("empties the settings file and the state", async () => {
			await writeModes(settingsPath, [mode("a")])

			await manager.resetCustomModes()

			expect(await readModes(settingsPath)).toEqual([])
			expect(globalStateUpdate).toHaveBeenCalledWith("customModes", [])
			expect(onUpdate).toHaveBeenCalled()
		})

		it("tells the user when the file cannot be written", async () => {
			vi.mocked(writeFileAtomic).mockRejectedValueOnce(new Error("EROFS"))

			await manager.resetCustomModes()

			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				`common:customModes.errors.resetFailed ${JSON.stringify({ error: "EROFS" })}`,
			)
		})
	})

	describe("watching the mode files", () => {
		const originalNodeEnv = process.env.NODE_ENV
		let watchers: Map<string, Record<"change" | "create" | "delete", () => Promise<void>> & { dispose: Mock }>

		beforeEach(async () => {
			watchers = new Map()
			vi.spyOn(vscode.workspace, "createFileSystemWatcher").mockImplementation((filePath: any) => {
				const watcher: any = { dispose: vi.fn() }
				const on = (event: string) => (handler: () => Promise<void>) => {
					watcher[event] = handler
					return { dispose: vi.fn() }
				}
				Object.assign(watcher, {
					onDidChange: on("change"),
					onDidCreate: on("create"),
					onDidDelete: on("delete"),
				})
				watchers.set(filePath, watcher)
				return watcher
			})
			// The manager does not watch under NODE_ENV=test.
			process.env.NODE_ENV = "development"
			manager = new CustomModesManager(context, onUpdate)
			await vi.waitFor(() => expect(watchers.size).toBe(2))
		})

		afterEach(() => {
			process.env.NODE_ENV = originalNodeEnv
		})

		it("merges both files into the state when either changes", async () => {
			await writeModes(settingsPath, [mode("g"), mode("both")])
			await writeModes(roomodesPath, [mode("both", { name: "project both" })])

			for (const event of ["change", "create"] as const) {
				for (const filePath of [settingsPath, roomodesPath]) {
					globalStateUpdate.mockClear()
					await watchers.get(filePath)![event]()
					const merged = globalStateUpdate.mock.calls[0][1]
					expect(merged.map((m: ModeConfig) => `${m.source}:${m.slug}:${m.name}`)).toEqual([
						"project:both:project both",
						"global:g:g",
					])
				}
			}
			expect(onUpdate).toHaveBeenCalledTimes(4)
		})

		it("keeps only the global modes when .roomodes is deleted", async () => {
			await writeModes(settingsPath, [mode("g")])

			await watchers.get(roomodesPath)!.delete()

			expect(globalStateUpdate).toHaveBeenCalledWith("customModes", [mode("g", { source: "global" })])
		})

		it("recreates a deleted settings file", async () => {
			await fs.rm(settingsPath)

			await watchers.get(settingsPath)!.delete()

			expect(await readModes(settingsPath)).toEqual([])
		})

		it("tells the user about a settings file that fails the schema and changes nothing", async () => {
			await write(settingsPath, yaml.stringify({ customModes: [{ slug: "a" }] }))

			await watchers.get(settingsPath)!.change()

			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("common:customModes.errors.invalidFormat")
			expect(globalStateUpdate).not.toHaveBeenCalled()
		})

		it("stops watching on dispose", () => {
			manager.dispose()

			for (const watcher of watchers.values()) {
				expect(watcher.dispose).toHaveBeenCalled()
			}
		})
	})

	describe("checkRulesDirectoryHasContent", () => {
		it.each([
			["a project mode with a rule", "p", async () => write(path.join(projectRules("p"), "r.md"), "rule"), true],
			["a global mode with a rule", "g", async () => write(path.join(globalRules("g"), "r.md"), "rule"), true],
			[
				"a .roomodes entry the schema rejects, with a rule",
				"raw",
				async () => {
					await writeModes(roomodesPath, [{ slug: "raw", name: "Raw" }])
					await write(path.join(projectRules("raw"), "r.md"), "rule")
				},
				true,
			],
			["a mode without a rules folder", "p", async () => {}, false],
			["an empty rules folder", "p", async () => fs.mkdir(projectRules("p"), { recursive: true }), false],
			[
				"a rules folder with blank files",
				"p",
				async () => write(path.join(projectRules("p"), "r.md"), " \n"),
				false,
			],
			["a rules path that is a file", "p", async () => write(projectRules("p"), "rule"), false],
			["an unknown mode", "nope", async () => {}, false],
			[
				"a slug .roomodes does not list",
				"nope",
				async () => writeModes(roomodesPath, [{ slug: "raw", name: "Raw" }]),
				false,
			],
		])("is %s for %s", async (_label, slug, arrange, expected) => {
			await writeModes(settingsPath, [mode("g")])
			if (!(await exists(roomodesPath))) await writeModes(roomodesPath, [mode("p")])
			await arrange()
			vi.spyOn(logger, "error").mockImplementation(() => {})

			expect(await manager.checkRulesDirectoryHasContent(slug)).toBe(expected)
		})

		it("is false for an unknown mode without a workspace", async () => {
			setWorkspace(undefined)

			expect(await manager.checkRulesDirectoryHasContent("nope")).toBe(false)
		})
	})

	describe("exportModeWithRules", () => {
		const exported = async (
			slug: string,
			customPrompts?: Parameters<CustomModesManager["exportModeWithRules"]>[1],
		) => {
			const result = await manager.exportModeWithRules(slug, customPrompts)
			expect(result.success).toBe(true)
			return yaml.parse(result.yaml!).customModes[0]
		}

		it("exports a project mode with the top-level files of its rules folder, relative and trimmed", async () => {
			await writeModes(roomodesPath, [mode("p", { customInstructions: "Existing instructions" })])
			await write(path.join(projectRules("p"), "rule1.md"), "  Rule 1  \n")
			await write(path.join(projectRules("p"), "empty.md"), "   ")
			await write(path.join(projectRules("p"), "sub", "nested.md"), "nested")

			const exportedMode = await exported("p")

			expect(exportedMode).toMatchObject({
				slug: "p",
				customInstructions: "Existing instructions",
				source: "project",
			})
			expect(exportedMode.rulesFiles).toEqual([{ relativePath: "rule1.md", content: "Rule 1" }])
		})

		it("exports a global mode with the rules under the home directory, also without a workspace", async () => {
			await writeModes(settingsPath, [mode("g")])
			await write(path.join(globalRules("g"), "rule.md"), "Global rule")
			setWorkspace(undefined)

			expect((await exported("g")).rulesFiles).toEqual([{ relativePath: "rule.md", content: "Global rule" }])
		})

		it("exports a built-in mode without rules and with the custom prompts applied", async () => {
			const exportedMode = await exported("architect", {
				roleDefinition: "New role",
				description: "New description",
				whenToUse: "New when",
				customInstructions: "New instructions",
			})

			expect(exportedMode).toMatchObject({
				slug: "architect",
				roleDefinition: "New role",
				description: "New description",
				whenToUse: "New when",
				customInstructions: "New instructions",
			})
			expect(exportedMode.rulesFiles).toBeUndefined()
		})

		it("exports a .roomodes entry the schema rejects", async () => {
			await writeModes(roomodesPath, [{ slug: "raw", name: "Raw" }])
			vi.spyOn(logger, "error").mockImplementation(() => {})

			expect(await exported("raw")).toMatchObject({ slug: "raw", name: "Raw" })
		})

		it("reports a mode that does not exist", async () => {
			expect(await manager.exportModeWithRules("nope")).toEqual({ success: false, error: "Mode not found" })
		})
	})

	describe("importModeWithRules", () => {
		const importYaml = (modes: object[], source?: "global" | "project") =>
			manager.importModeWithRules(yaml.stringify({ customModes: modes }), source)

		it("adds the modes to .roomodes and writes their rules into rules-<slug>, replacing the old folder", async () => {
			await write(path.join(projectRules("p"), "stale.md"), "stale")

			const result = await importYaml([
				{
					...mode("p"),
					rulesFiles: [
						{ relativePath: "rule1.md", content: "Rule 1" },
						{ relativePath: "sub/rule2.md", content: "Rule 2" },
						{ relativePath: "rules-old-slug/old-format.md", content: "Old" },
					],
				},
				mode("second"),
			])

			expect(result).toEqual({ success: true, slug: "p" })
			expect((await readModes(roomodesPath)).map((m) => `${m.source}:${m.slug}`)).toEqual([
				"project:p",
				"project:second",
			])
			expect((await fs.readdir(projectRules("p"), { recursive: true })).sort()).toEqual(
				["old-format.md", "rule1.md", "sub", path.join("sub", "rule2.md")].sort(),
			)
			expect(await fs.readFile(path.join(projectRules("p"), "sub", "rule2.md"), "utf-8")).toBe("Rule 2")
		})

		it("imports into the global settings file and the global rules folder", async () => {
			const result = await importYaml(
				[{ ...mode("g"), rulesFiles: [{ relativePath: "rule.md", content: "Global" }] }],
				"global",
			)

			expect(result.success).toBe(true)
			expect((await readModes(settingsPath)).map((m) => `${m.source}:${m.slug}`)).toEqual(["global:g"])
			expect(await fs.readFile(path.join(globalRules("g"), "rule.md"), "utf-8")).toBe("Global")
			expect(await exists(roomodesPath)).toBe(false)
		})

		it("skips rule files that would land outside the rules folder", async () => {
			vi.spyOn(logger, "error").mockImplementation(() => {})

			const result = await importYaml([
				{
					...mode("p"),
					rulesFiles: [
						{ relativePath: "../../../escaped.txt", content: "x" },
						{ relativePath: "rules-p/../../../escaped2.txt", content: "x" },
						{ relativePath: path.join(root, "absolute.txt"), content: "x" },
						{ relativePath: "ok.md", content: "ok" },
					],
				},
			])

			expect(result.success).toBe(true)
			expect(await fs.readdir(projectRules("p"))).toEqual(["ok.md"])
			expect((await fs.readdir(root)).sort()).toEqual(["storage", "workspace"])
		})

		it.each([
			["YAML that does not parse", "customModes: [read\n  invalid: yaml: here", "Invalid YAML format: "],
			[
				"YAML without customModes",
				"invalid yaml content",
				"Invalid import format: Expected 'customModes' array in YAML",
			],
			["an empty customModes list", yaml.stringify({ customModes: [] }), "Invalid import format: "],
			[
				"an invalid mode",
				yaml.stringify({ customModes: [{ slug: "bad", name: "", roleDefinition: "x", groups: ["read"] }] }),
				"Invalid mode configuration for bad: Name is required",
			],
		])("rejects %s", async (_label, content, error) => {
			vi.spyOn(logger, "error").mockImplementation(() => {})

			const result = await manager.importModeWithRules(content)

			expect(result.success).toBe(false)
			expect(result.error).toContain(error)
			expect(await exists(roomodesPath)).toBe(false)
		})

		it("rejects a project import without a workspace", async () => {
			setWorkspace(undefined)

			expect(await importYaml([mode("p")])).toEqual({ success: false, error: "No workspace found" })
		})

		it("reports a rules folder it cannot create", async () => {
			vi.mocked(fs.mkdir).mockRejectedValueOnce(new Error("Permission denied"))
			vi.spyOn(logger, "error").mockImplementation(() => {})

			const result = await importYaml([{ ...mode("p"), rulesFiles: [{ relativePath: "r.md", content: "r" }] }])

			expect(result).toEqual({ success: false, error: "Permission denied" })
		})

		it("re-imports an export under a new slug with its rules", async () => {
			await writeModes(roomodesPath, [mode("original")])
			await write(path.join(projectRules("original"), "rule.md"), "Original rule")
			const exportedYaml = yaml.parse((await manager.exportModeWithRules("original")).yaml!)
			exportedYaml.customModes[0].slug = "renamed"

			expect((await manager.importModeWithRules(yaml.stringify(exportedYaml))).success).toBe(true)

			expect(await fs.readFile(path.join(projectRules("renamed"), "rule.md"), "utf-8")).toBe("Original rule")
			expect(await exists(path.join(projectRules("original"), "rule.md"))).toBe(true)
			expect((await readModes(roomodesPath)).map((m) => m.slug)).toEqual(["original", "renamed"])
		})
	})
})
