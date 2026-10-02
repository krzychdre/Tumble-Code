// npx vitest core/config/__tests__/CustomModesManager.spec.ts

import type { Mock } from "vitest"

import * as path from "path"
import * as fs from "fs/promises"

import * as yaml from "yaml"
import * as vscode from "vscode"

import type { ModeConfig } from "@tumble-code/types"

import { fileExistsAtPath } from "../../../utils/fs"
import { getWorkspacePath, arePathsEqual } from "../../../utils/path"
import { GlobalFileNames } from "../../../shared/globalFileNames"

import { CustomModesManager } from "../CustomModesManager"
import { modeRulesDir } from "../modeRulesDir"
import { logger } from "../../../utils/logging"
import { useMemoryFiles, type MemoryFiles } from "./memoryFiles"

vi.mock("vscode", () => ({
	workspace: {
		workspaceFolders: [],
		onDidSaveTextDocument: vi.fn(),
		createFileSystemWatcher: vi.fn(),
	},
	window: {
		showErrorMessage: vi.fn(),
	},
}))

vi.mock("fs/promises", () => ({
	mkdir: vi.fn(),
	readFile: vi.fn(),
	writeFile: vi.fn(),
	rename: vi.fn(),
	open: vi.fn(),
	chmod: vi.fn(),
	unlink: vi.fn(),
	stat: vi.fn(),
	readdir: vi.fn(),
	rm: vi.fn(),
}))

vi.mock("../../../utils/fs")
vi.mock("../../../utils/path")

describe("CustomModesManager", () => {
	let manager: CustomModesManager
	let mockContext: vscode.ExtensionContext
	let mockOnUpdate: Mock
	let mockWorkspaceFolders: { uri: { fsPath: string } }[]
	let files: MemoryFiles

	// Use path.sep to ensure correct path separators for the current platform
	const mockStoragePath = `${path.sep}mock${path.sep}settings`
	const mockSettingsPath = path.join(mockStoragePath, "settings", GlobalFileNames.customModes)
	const mockWorkspacePath = path.resolve("/mock/workspace")
	const mockRoomodes = path.join(mockWorkspacePath, ".roomodes")
	// What stat reports for a missing path (the settings file write asks for the mode of the file it replaces).
	const notFound = () => Object.assign(new Error("ENOENT: no such file or directory"), { code: "ENOENT" })

	beforeEach(() => {
		mockOnUpdate = vi.fn()
		mockContext = {
			globalState: {
				get: vi.fn(),
				update: vi.fn(),
				keys: vi.fn(() => []),
				setKeysForSync: vi.fn(),
			},
			globalStorageUri: {
				fsPath: mockStoragePath,
			},
		} as unknown as vscode.ExtensionContext

		// mockWorkspacePath is now defined at the top level
		mockWorkspaceFolders = [{ uri: { fsPath: mockWorkspacePath } }]
		;(vscode.workspace as any).workspaceFolders = mockWorkspaceFolders
		;(vscode.workspace.onDidSaveTextDocument as Mock).mockReturnValue({ dispose: vi.fn() })
		;(getWorkspacePath as Mock).mockReturnValue(mockWorkspacePath)
		;(fileExistsAtPath as Mock).mockImplementation(async (path: string) => {
			return path === mockSettingsPath || path === mockRoomodes
		})
		;(fs.mkdir as Mock).mockResolvedValue(undefined)
		;(fs.stat as Mock).mockResolvedValue({ isDirectory: () => true })
		;(fs.readdir as Mock).mockResolvedValue([])
		;(fs.rm as Mock).mockResolvedValue(undefined)
		files = useMemoryFiles(fs)
		files.set(mockSettingsPath, yaml.stringify({ customModes: [] }))

		manager = new CustomModesManager(mockContext, mockOnUpdate)
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	describe("getCustomModes", () => {
		it("logs a .roomodes read failure once and loads the global modes alone", async () => {
			const settingsModes = [{ slug: "mode1", name: "Mode 1", roleDefinition: "Role 1", groups: ["read"] }]
			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockSettingsPath) {
					return yaml.stringify({ customModes: settingsModes })
				}
				throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" })
			})
			const consoleError = vi.spyOn(logger, "error").mockImplementation(() => {})

			try {
				const modes = await manager.getCustomModes()

				expect(modes.map((m) => [m.slug, m.source])).toEqual([["mode1", "global"]])
				expect(consoleError.mock.calls).toEqual([
					[`[CustomModesManager] Failed to load modes from ${mockRoomodes}: EACCES: permission denied`],
				])
			} finally {
				consoleError.mockRestore()
			}
		})

		it("should handle valid YAML in .roomodes file and JSON for global customModes", async () => {
			const settingsModes = [{ slug: "mode1", name: "Mode 1", roleDefinition: "Role 1", groups: ["read"] }]

			const roomodesModes = [{ slug: "mode2", name: "Mode 2", roleDefinition: "Role 2", groups: ["read"] }]

			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockSettingsPath) {
					return yaml.stringify({ customModes: settingsModes })
				}
				if (path === mockRoomodes) {
					return yaml.stringify({ customModes: roomodesModes })
				}
				throw new Error("File not found")
			})

			const modes = await manager.getCustomModes()

			expect(modes).toHaveLength(2)
		})

		it("should merge modes with .roomodes taking precedence", async () => {
			const settingsModes = [
				{ slug: "mode1", name: "Mode 1", roleDefinition: "Role 1", groups: ["read"] },
				{ slug: "mode2", name: "Mode 2", roleDefinition: "Role 2", groups: ["read"] },
			]

			const roomodesModes = [
				{ slug: "mode2", name: "Mode 2 Override", roleDefinition: "Role 2 Override", groups: ["read"] },
				{ slug: "mode3", name: "Mode 3", roleDefinition: "Role 3", groups: ["read"] },
			]

			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockSettingsPath) {
					return yaml.stringify({ customModes: settingsModes })
				}
				if (path === mockRoomodes) {
					return yaml.stringify({ customModes: roomodesModes })
				}
				throw new Error("File not found")
			})

			const modes = await manager.getCustomModes()

			// Should contain 3 modes (mode1 from settings, mode2 and mode3 from roomodes)
			expect(modes).toHaveLength(3)
			expect(modes.map((m) => m.slug)).toEqual(["mode2", "mode3", "mode1"])

			// mode2 should come from .roomodes since it takes precedence
			const mode2 = modes.find((m) => m.slug === "mode2")
			expect(mode2?.name).toBe("Mode 2 Override")
			expect(mode2?.roleDefinition).toBe("Role 2 Override")
		})

		it("should handle missing .roomodes file", async () => {
			const settingsModes = [{ slug: "mode1", name: "Mode 1", roleDefinition: "Role 1", groups: ["read"] }]

			;(fileExistsAtPath as Mock).mockImplementation(async (path: string) => {
				return path === mockSettingsPath
			})
			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockSettingsPath) {
					return yaml.stringify({ customModes: settingsModes })
				}
				throw new Error("File not found")
			})

			const modes = await manager.getCustomModes()

			expect(modes).toHaveLength(1)
			expect(modes[0].slug).toBe("mode1")
		})

		it("should handle invalid YAML in .roomodes", async () => {
			const settingsModes = [{ slug: "mode1", name: "Mode 1", roleDefinition: "Role 1", groups: ["read"] }]

			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockSettingsPath) {
					return yaml.stringify({ customModes: settingsModes })
				}
				if (path === mockRoomodes) {
					return "invalid yaml content"
				}
				throw new Error("File not found")
			})

			const modes = await manager.getCustomModes()

			// Should fall back to settings modes when .roomodes is invalid
			expect(modes).toHaveLength(1)
			expect(modes[0].slug).toBe("mode1")
		})

		it("should memoize results for 10 seconds", async () => {
			// Setup test data
			const settingsModes = [{ slug: "mode1", name: "Mode 1", roleDefinition: "Role 1", groups: ["read"] }]
			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockSettingsPath) {
					return yaml.stringify({ customModes: settingsModes })
				}
				throw new Error("File not found")
			})

			// Mock fileExistsAtPath to only return true for settings path
			;(fileExistsAtPath as Mock).mockImplementation(async (path: string) => {
				return path === mockSettingsPath
			})

			// First call should read from file
			const firstResult = await manager.getCustomModes()

			// Reset mock to verify it's not called again
			vi.clearAllMocks()

			// Setup mocks again for second call
			;(fileExistsAtPath as Mock).mockImplementation(async (path: string) => {
				return path === mockSettingsPath
			})
			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockSettingsPath) {
					return yaml.stringify({ customModes: settingsModes })
				}
				throw new Error("File not found")
			})

			// Second call should use cached result
			const secondResult = await manager.getCustomModes()
			expect(fs.readFile).not.toHaveBeenCalled()
			expect(secondResult).toHaveLength(1)
			expect(secondResult[0].slug).toBe("mode1")

			// Results should be the same object (not just equal)
			expect(secondResult).toBe(firstResult)
		})

		it("should invalidate cache when modes are updated", async () => {
			// Setup initial data
			const settingsModes = [{ slug: "mode1", name: "Mode 1", roleDefinition: "Role 1", groups: ["read"] }]
			files.set(mockSettingsPath, yaml.stringify({ customModes: settingsModes }))

			// First call to cache the result
			await manager.getCustomModes()

			// Reset mocks to track new calls
			vi.clearAllMocks()

			// Update a mode
			const updatedMode: ModeConfig = {
				slug: "mode1",
				name: "Updated Mode 1",
				roleDefinition: "Updated Role 1",
				groups: ["read"],
				source: "global",
			}

			// Update the mode
			await manager.updateCustomMode("mode1", updatedMode)

			// Reset mocks again
			vi.clearAllMocks()

			// Next call should read from file again (cache invalidated) and see the update
			const modes = await manager.getCustomModes()
			expect(fs.readFile).toHaveBeenCalled()
			expect(modes.find((m) => m.slug === "mode1")?.name).toBe("Updated Mode 1")
		})

		it("should invalidate cache when modes are deleted", async () => {
			// Setup initial data
			const settingsModes = [{ slug: "mode1", name: "Mode 1", roleDefinition: "Role 1", groups: ["read"] }]
			files.set(mockSettingsPath, yaml.stringify({ customModes: settingsModes }))

			// First call to cache the result
			await manager.getCustomModes()

			// Reset mocks to track new calls
			vi.clearAllMocks()

			// Delete a mode
			await manager.deleteCustomMode("mode1")

			// Reset mocks again
			vi.clearAllMocks()

			// Next call should read from file again (cache invalidated) and no longer see the mode
			const modes = await manager.getCustomModes()
			expect(fs.readFile).toHaveBeenCalled()
			expect(modes).toEqual([])
		})

		it("should invalidate cache when modes are updated (simulating file changes)", async () => {
			// Setup initial data
			const settingsModes = [{ slug: "mode1", name: "Mode 1", roleDefinition: "Role 1", groups: ["read"] }]
			files.set(mockSettingsPath, yaml.stringify({ customModes: settingsModes }))
			;(fileExistsAtPath as Mock).mockImplementation(async (path: string) => {
				return path === mockSettingsPath
			})

			// First call to cache the result
			await manager.getCustomModes()

			// Reset mocks to track new calls
			vi.clearAllMocks()

			// Setup for update
			const updatedMode: ModeConfig = {
				slug: "mode1",
				name: "Updated Mode 1",
				roleDefinition: "Updated Role 1",
				groups: ["read"],
				source: "global",
			}

			// Simulate a file change by updating a mode
			// This should invalidate the cache
			await manager.updateCustomMode("mode1", updatedMode)

			// Reset mocks again
			vi.clearAllMocks()

			// Next call should read from file again (cache was invalidated by the update)
			const modes = await manager.getCustomModes()
			expect(fs.readFile).toHaveBeenCalled()
			expect(modes).toEqual([expect.objectContaining({ slug: "mode1", name: "Updated Mode 1" })])
		})

		it("should refresh cache after TTL expires", async () => {
			// Setup test data
			const settingsModes = [{ slug: "mode1", name: "Mode 1", roleDefinition: "Role 1", groups: ["read"] }]
			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockSettingsPath) {
					return yaml.stringify({ customModes: settingsModes })
				}
				throw new Error("File not found")
			})
			;(fileExistsAtPath as Mock).mockImplementation(async (path: string) => {
				return path === mockSettingsPath
			})

			// Mock Date.now to control time
			const originalDateNow = Date.now
			let currentTime = 1000
			Date.now = vi.fn(() => currentTime)

			try {
				// First call should read from file
				await manager.getCustomModes()

				// Reset mock to verify it's not called again
				vi.clearAllMocks()

				// Setup mocks again for second call
				;(fileExistsAtPath as Mock).mockImplementation(async (path: string) => {
					return path === mockSettingsPath
				})
				;(fs.readFile as Mock).mockImplementation(async (path: string) => {
					if (path === mockSettingsPath) {
						return yaml.stringify({ customModes: settingsModes })
					}
					throw new Error("File not found")
				})

				// Second call within TTL should use cache
				await manager.getCustomModes()
				expect(fs.readFile).not.toHaveBeenCalled()

				// Advance time beyond TTL (10 seconds)
				currentTime += 11000

				// Reset mocks again
				vi.clearAllMocks()

				// Setup mocks again for third call
				;(fileExistsAtPath as Mock).mockImplementation(async (path: string) => {
					return path === mockSettingsPath
				})
				;(fs.readFile as Mock).mockImplementation(async (path: string) => {
					if (path === mockSettingsPath) {
						return yaml.stringify({ customModes: settingsModes })
					}
					throw new Error("File not found")
				})

				// Call after TTL should read from file again
				await manager.getCustomModes()
				expect(fs.readFile).toHaveBeenCalled()
			} finally {
				// Restore original Date.now
				Date.now = originalDateNow
			}
		})
	})

	describe("updateCustomMode", () => {
		it("should update mode in settings file while preserving .roomodes precedence", async () => {
			const newMode: ModeConfig = {
				slug: "mode1",
				name: "Updated Mode 1",
				roleDefinition: "Updated Role 1",
				groups: ["read"],
				source: "global",
			}

			const roomodesModes = [
				{
					slug: "mode1",
					name: "Roomodes Mode 1",
					roleDefinition: "Role 1",
					groups: ["read"],
					source: "project",
				},
			]

			const existingModes = [
				{ slug: "mode2", name: "Mode 2", roleDefinition: "Role 2", groups: ["read"], source: "global" },
			]

			const roomodesYaml = yaml.stringify({ customModes: roomodesModes })
			files.set(mockSettingsPath, yaml.stringify({ customModes: existingModes }))
			files.set(mockRoomodes, roomodesYaml)

			await manager.updateCustomMode("mode1", newMode)

			// Should write to the settings file only
			expect(files.get(mockRoomodes)).toBe(roomodesYaml)

			// Verify the content of the settings file
			const content = yaml.parse(files.get(mockSettingsPath)!)
			expect(content.customModes).toContainEqual(
				expect.objectContaining({
					slug: "mode1",
					name: "Updated Mode 1",
					roleDefinition: "Updated Role 1",
					source: "global",
				}),
			)

			// Should update global state with merged modes where .roomodes takes precedence
			expect(mockContext.globalState.update).toHaveBeenCalledWith(
				"customModes",
				expect.arrayContaining([
					expect.objectContaining({
						slug: "mode1",
						name: "Roomodes Mode 1", // .roomodes version should take precedence
						source: "project",
					}),
				]),
			)

			// Should trigger onUpdate
			expect(mockOnUpdate).toHaveBeenCalled()
		})

		it("creates .roomodes file when adding project-specific mode", async () => {
			const projectMode: ModeConfig = {
				slug: "project-mode",
				name: "Project Mode",
				roleDefinition: "Project Role",
				groups: ["read"],
				source: "project",
			}

			// .roomodes does not exist initially
			;(fileExistsAtPath as Mock).mockImplementation(async (path: string) => {
				return path === mockSettingsPath
			})
			const settingsYaml = files.get(mockSettingsPath)

			await manager.updateCustomMode("project-mode", projectMode)

			// Verify .roomodes was created and nothing else changed (no temporary file left behind)
			expect(files.paths().sort()).toEqual([path.resolve(mockRoomodes), path.resolve(mockSettingsPath)].sort())
			expect(files.get(mockSettingsPath)).toBe(settingsYaml)

			// Verify the content written to .roomodes
			expect(yaml.parse(files.get(mockRoomodes)!)).toEqual({
				customModes: [
					expect.objectContaining({
						slug: "project-mode",
						name: "Project Mode",
						roleDefinition: "Project Role",
						source: "project",
					}),
				],
			})
		})

		it("queues write operations", async () => {
			const mode1: ModeConfig = {
				slug: "mode1",
				name: "Mode 1",
				roleDefinition: "Role 1",
				groups: ["read"],
				source: "global",
			}
			const mode2: ModeConfig = {
				slug: "mode2",
				name: "Mode 2",
				roleDefinition: "Role 2",
				groups: ["read"],
				source: "global",
			}

			// Start both updates simultaneously
			await Promise.all([manager.updateCustomMode("mode1", mode1), manager.updateCustomMode("mode2", mode2)])

			// Verify final state in settings file
			const settingsContent = yaml.parse(files.get(mockSettingsPath)!)
			expect(settingsContent.customModes).toHaveLength(2)
			expect(settingsContent.customModes.map((m: ModeConfig) => m.name)).toContain("Mode 1")
			expect(settingsContent.customModes.map((m: ModeConfig) => m.name)).toContain("Mode 2")

			// Verify global state was updated
			expect(mockContext.globalState.update).toHaveBeenCalledWith(
				"customModes",
				expect.arrayContaining([
					expect.objectContaining({
						slug: "mode1",
						name: "Mode 1",
						source: "global",
					}),
					expect.objectContaining({
						slug: "mode2",
						name: "Mode 2",
						source: "global",
					}),
				]),
			)

			// Should trigger onUpdate
			expect(mockOnUpdate).toHaveBeenCalled()
		})
	})

	describe("File Operations", () => {
		it("creates settings directory if it doesn't exist", async () => {
			const settingsPath = path.join(mockStoragePath, "settings", GlobalFileNames.customModes)
			await manager.getCustomModesFilePath()

			expect(fs.mkdir).toHaveBeenCalledWith(path.dirname(settingsPath), { recursive: true })
		})

		it("creates default config if file doesn't exist", async () => {
			const settingsPath = path.join(mockStoragePath, "settings", GlobalFileNames.customModes)

			// Mock fileExists to return false first time, then true
			let firstCall = true
			;(fileExistsAtPath as Mock).mockImplementation(async () => {
				if (firstCall) {
					firstCall = false
					return false
				}
				return true
			})

			files.delete(settingsPath)

			await manager.getCustomModesFilePath()

			expect(files.get(settingsPath)).toMatch(/^customModes: \[\]/)
		})

		it("watches file for changes", async () => {
			const configPath = path.join(mockStoragePath, "settings", GlobalFileNames.customModes)

			;(fs.readFile as Mock).mockResolvedValue(yaml.stringify({ customModes: [] }))
			;(arePathsEqual as Mock).mockImplementation(
				(path1: string, path2: string) => path.normalize(path1) === path.normalize(path2),
			)

			// Mock createFileSystemWatcher to return a mock watcher
			const mockWatcher = {
				onDidChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
				onDidCreate: vi.fn().mockReturnValue({ dispose: vi.fn() }),
				onDidDelete: vi.fn().mockReturnValue({ dispose: vi.fn() }),
				dispose: vi.fn(),
			}
			const createFileSystemWatcherMock = vi.fn().mockReturnValue(mockWatcher)
			;(vscode.workspace as any).createFileSystemWatcher = createFileSystemWatcherMock

			// Temporarily set NODE_ENV to allow file watching
			const originalNodeEnv = process.env.NODE_ENV
			process.env.NODE_ENV = "development"

			try {
				// Create a new manager to trigger the file watcher setup
				const testManager = new CustomModesManager(mockContext, mockOnUpdate)

				// Wait a bit for the async watchCustomModesFiles to complete
				await new Promise((resolve) => setTimeout(resolve, 10))

				// Verify createFileSystemWatcher was called
				expect(createFileSystemWatcherMock).toHaveBeenCalled()

				// Get the onChange callback that was registered
				const onChangeCall = mockWatcher.onDidChange.mock.calls[0]
				expect(onChangeCall).toBeDefined()
				const [onChangeCallback] = onChangeCall

				// Simulate file change event
				await onChangeCallback()

				// Verify file was processed
				expect(fs.readFile).toHaveBeenCalledWith(configPath, "utf-8")
				expect(mockContext.globalState.update).toHaveBeenCalled()
				expect(mockOnUpdate).toHaveBeenCalled()

				// Clean up
				testManager.dispose()
			} finally {
				// Restore original NODE_ENV
				process.env.NODE_ENV = originalNodeEnv
			}
		})
	})

	describe("deleteCustomMode", () => {
		it("deletes mode from settings file", async () => {
			const existingMode = {
				slug: "mode-to-delete",
				name: "Mode To Delete",
				roleDefinition: "Test role",
				groups: ["read"],
				source: "global",
			}

			files.set(mockSettingsPath, yaml.stringify({ customModes: [existingMode] }))

			await manager.deleteCustomMode("mode-to-delete")

			// Verify mode was removed from settings file
			expect(yaml.parse(files.get(mockSettingsPath)!).customModes).toHaveLength(0)

			// Verify global state was updated
			expect(mockContext.globalState.update).toHaveBeenCalledWith("customModes", [])

			// Should trigger onUpdate
			expect(mockOnUpdate).toHaveBeenCalled()
		})

		it("handles errors gracefully", async () => {
			const mockShowError = vi.fn()
			;(vscode.window.showErrorMessage as Mock) = mockShowError
			;(fs.writeFile as Mock).mockRejectedValue(new Error("Write error"))

			await manager.deleteCustomMode("non-existent-mode")

			expect(mockShowError).toHaveBeenCalledWith("customModes.errors.deleteFailed")
		})

		// The manager is the only place that deletes a mode's rules folder; the webview handler
		// only asks whether one exists, to name it in the confirmation dialog.
		describe("rules folder", () => {
			const slug = "project-mode"
			let rulesFolderPath: string

			beforeEach(async () => {
				rulesFolderPath = (await modeRulesDir(slug, "project"))!
				const projectMode = { slug, name: "Project", roleDefinition: "Role", groups: ["read"] }
				files.set(mockRoomodes, yaml.stringify({ customModes: [projectMode] }))
				;(fileExistsAtPath as Mock).mockImplementation(
					async (path: string) =>
						path === mockSettingsPath || path === mockRoomodes || path === rulesFolderPath,
				)
			})

			it("deletes the rules folder of the deleted mode once", async () => {
				await manager.deleteCustomMode(slug)

				expect(rulesFolderPath).toBe(path.join(mockWorkspacePath, ".roo", `rules-${slug}`))
				expect(fs.rm).toHaveBeenCalledTimes(1)
				expect(fs.rm).toHaveBeenCalledWith(rulesFolderPath, { recursive: true, force: true })
			})

			it("warns and still deletes the mode when the rules folder cannot be removed", async () => {
				;(fs.rm as Mock).mockRejectedValue(new Error("Permission denied"))
				const showWarning = vi.fn()
				;(vscode.window.showWarningMessage as Mock) = showWarning

				await manager.deleteCustomMode(slug)

				expect(showWarning).toHaveBeenCalledWith("customModes.errors.rulesCleanupFailed")
				expect(yaml.parse(files.get(mockRoomodes)!)).toEqual({ customModes: [] })
			})
		})
	})

	describe("updateModesInFile", () => {
		it("handles corrupted YAML content gracefully", async () => {
			const corruptedYaml = "customModes: [invalid yaml content"
			;(fs.readFile as Mock).mockResolvedValue(corruptedYaml)

			const newMode: ModeConfig = {
				slug: "test-mode",
				name: "Test Mode",
				roleDefinition: "Test Role",
				groups: ["read"],
				source: "global",
			}

			await manager.updateCustomMode("test-mode", newMode)

			// Verify that a valid YAML structure was written
			const writtenContent = yaml.parse(files.get(mockSettingsPath)!)
			expect(writtenContent).toEqual({
				customModes: [
					expect.objectContaining({
						slug: "test-mode",
						name: "Test Mode",
						roleDefinition: "Test Role",
					}),
				],
			})
		})

		it("keeps the old file when writing the new content fails midway", async () => {
			const existingYaml = yaml.stringify({
				customModes: [{ slug: "mode1", name: "Mode 1", roleDefinition: "Role 1", groups: ["read"] }],
			})
			files.set(mockSettingsPath, existingYaml)
			const writeToMemory = vi.mocked(fs.writeFile).getMockImplementation()!
			// A full disk or a crash: part of the new content reaches the disk, then the write fails.
			vi.mocked(fs.writeFile).mockImplementationOnce(async (filePath, data, options) => {
				await writeToMemory(filePath, String(data).slice(0, 10), options)
				throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" })
			})
			const newMode: ModeConfig = {
				slug: "mode2",
				name: "Mode 2",
				roleDefinition: "Role 2",
				groups: ["read"],
				source: "global",
			}

			await expect(manager.updateCustomMode("mode2", newMode)).rejects.toThrow("ENOSPC")

			expect(files.get(mockSettingsPath)).toBe(existingYaml)
			expect(files.paths()).toEqual([path.resolve(mockSettingsPath)])
		})

		describe("importModeWithRules", () => {
			it("should return error when YAML content is invalid", async () => {
				const invalidYaml = "invalid yaml content"

				const result = await manager.importModeWithRules(invalidYaml)

				expect(result.success).toBe(false)
				expect(result.error).toContain("Invalid import format")
			})

			it("should return error when no custom modes found in YAML", async () => {
				const emptyYaml = yaml.stringify({ customModes: [] })

				const result = await manager.importModeWithRules(emptyYaml)

				expect(result.success).toBe(false)
				expect(result.error).toBe("Invalid import format: Expected 'customModes' array in YAML")
			})

			it("should return error when no workspace is available", async () => {
				;(getWorkspacePath as Mock).mockReturnValue(null)
				const validYaml = yaml.stringify({
					customModes: [
						{
							slug: "test-mode",
							name: "Test Mode",
							roleDefinition: "Test Role",
							groups: ["read"],
						},
					],
				})

				const result = await manager.importModeWithRules(validYaml)

				expect(result.success).toBe(false)
				expect(result.error).toBe("No workspace found")
			})

			it("should successfully import mode without rules files", async () => {
				const importYaml = yaml.stringify({
					customModes: [
						{
							slug: "imported-mode",
							name: "Imported Mode",
							roleDefinition: "Imported Role",
							groups: ["read", "edit"],
						},
					],
				})

				const result = await manager.importModeWithRules(importYaml)

				expect(result.success).toBe(true)
				expect(yaml.parse(files.get(mockRoomodes)!).customModes).toEqual([
					expect.objectContaining({ slug: "imported-mode", source: "project" }),
				])
			})

			it("should successfully import mode with rules files", async () => {
				const importYaml = yaml.stringify({
					customModes: [
						{
							slug: "imported-mode",
							name: "Imported Mode",
							roleDefinition: "Imported Role",
							groups: ["read"],
							rulesFiles: [
								{
									relativePath: "rules-imported-mode/rule1.md",
									content: "Rule 1 content",
								},
								{
									relativePath: "rules-imported-mode/subfolder/rule2.md",
									content: "Rule 2 content",
								},
							],
						},
					],
				})

				;(fs.mkdir as Mock).mockResolvedValue(undefined)

				const result = await manager.importModeWithRules(importYaml)

				expect(result.success).toBe(true)

				// Verify mode was imported
				expect(yaml.parse(files.get(mockRoomodes)!).customModes).toEqual([
					expect.objectContaining({ slug: "imported-mode", source: "project" }),
				])

				// Verify rules files were created
				expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining("rules-imported-mode"), {
					recursive: true,
				})
				expect(fs.mkdir).toHaveBeenCalledWith(
					expect.stringContaining(path.join("rules-imported-mode", "subfolder")),
					{ recursive: true },
				)

				// Verify file contents
				const rulesDir = path.join(mockWorkspacePath, ".roo", "rules-imported-mode")
				expect(files.get(path.join(rulesDir, "rule1.md"))).toBe("Rule 1 content")
				expect(files.get(path.join(rulesDir, "subfolder", "rule2.md"))).toBe("Rule 2 content")
			})

			it("should import multiple modes at once", async () => {
				const importYaml = yaml.stringify({
					customModes: [
						{
							slug: "mode1",
							name: "Mode 1",
							roleDefinition: "Role 1",
							groups: ["read"],
						},
						{
							slug: "mode2",
							name: "Mode 2",
							roleDefinition: "Role 2",
							groups: ["edit"],
							rulesFiles: [
								{
									relativePath: "rules-mode2/rule.md",
									content: "Mode 2 rules",
								},
							],
						},
					],
				})

				const result = await manager.importModeWithRules(importYaml)

				expect(result.success).toBe(true)
				const roomodesContent = yaml.parse(files.get(mockRoomodes)!)
				expect(roomodesContent.customModes).toHaveLength(2)
				expect(roomodesContent.customModes[0].slug).toBe("mode1")
				expect(roomodesContent.customModes[1].slug).toBe("mode2")
			})

			it("should handle import errors gracefully", async () => {
				const importYaml = yaml.stringify({
					customModes: [
						{
							slug: "test-mode",
							name: "Test Mode",
							roleDefinition: "Test Role",
							groups: ["read"],
							rulesFiles: [
								{
									relativePath: "rules-test-mode/rule.md",
									content: "Rule content",
								},
							],
						},
					],
				})

				// Mock fs.readFile to work normally
				;(fs.readFile as Mock).mockImplementation(async (path: string) => {
					if (path === mockSettingsPath) {
						return yaml.stringify({ customModes: [] })
					}
					if (path === mockRoomodes) {
						throw new Error("File not found")
					}
					throw new Error("File not found")
				})

				// Mock fs.mkdir to fail when creating rules directory
				;(fs.mkdir as Mock).mockRejectedValue(new Error("Permission denied"))

				const result = await manager.importModeWithRules(importYaml)

				expect(result.success).toBe(false)
				expect(result.error).toContain("Permission denied")
			})

			it("should prevent path traversal attacks in import", async () => {
				const maliciousYaml = yaml.stringify({
					customModes: [
						{
							slug: "test-mode",
							name: "Test Mode",
							roleDefinition: "Test Role",
							groups: ["read"],
							rulesFiles: [
								{
									relativePath: "../../../etc/passwd",
									content: "malicious content",
								},
								{
									relativePath: "rules-test-mode/../../../sensitive.txt",
									content: "malicious content",
								},
								{
									relativePath: "/absolute/path/file.txt",
									content: "malicious content",
								},
							],
						},
					],
				})

				;(fs.mkdir as Mock).mockResolvedValue(undefined)

				const result = await manager.importModeWithRules(maliciousYaml)
				const writtenFiles = files.paths().filter((p) => p !== path.resolve(mockSettingsPath))

				expect(result.success).toBe(true)

				// Verify that no files were written outside the .roo directory
				const mockWorkspacePath = path.resolve("/mock/workspace")
				const writtenRuleFiles = writtenFiles.filter((p) => !p.includes(".roomodes"))
				writtenRuleFiles.forEach((filePath) => {
					const normalizedPath = path.normalize(filePath)
					const expectedBasePath = path.normalize(path.join(mockWorkspacePath, ".roo"))
					expect(normalizedPath.startsWith(expectedBasePath)).toBe(true)
				})

				// Verify that malicious paths were not written
				expect(writtenFiles.some((p) => p.includes("etc/passwd"))).toBe(false)
				expect(writtenFiles.some((p) => p.includes("sensitive.txt"))).toBe(false)
				expect(writtenFiles.some((p) => path.isAbsolute(p) && !p.startsWith(mockWorkspacePath))).toBe(false)
			})

			it("should handle malformed YAML gracefully", async () => {
				const malformedYaml = `
	customModes:
			- slug: test-mode
			  name: Test Mode
			  roleDefinition: Test Role
			  groups: [read
			    invalid yaml here
				`

				const result = await manager.importModeWithRules(malformedYaml)

				expect(result.success).toBe(false)
				expect(result.error).toContain("Invalid YAML format")
			})

			it("should validate mode configuration during import", async () => {
				const invalidModeYaml = yaml.stringify({
					customModes: [
						{
							slug: "test-mode",
							name: "", // Invalid: empty name
							roleDefinition: "", // Invalid: empty role definition
							groups: ["invalid-group"], // Invalid group
						},
					],
				})

				const result = await manager.importModeWithRules(invalidModeYaml)

				expect(result.success).toBe(false)
				expect(result.error).toContain("Invalid mode configuration")
			})

			it("should remove existing rules folder when importing mode without rules", async () => {
				const importYaml = yaml.stringify({
					customModes: [
						{
							slug: "test-mode",
							name: "Test Mode",
							roleDefinition: "Test Role",
							groups: ["read"],
							// No rulesFiles property - this mode has no rules
						},
					],
				})

				;(fs.rm as Mock).mockResolvedValue(undefined)

				const result = await manager.importModeWithRules(importYaml)

				expect(result.success).toBe(true)

				// Verify that fs.rm was called to remove the existing rules folder
				expect(fs.rm).toHaveBeenCalledWith(expect.stringContaining(path.join(".roo", "rules-test-mode")), {
					recursive: true,
					force: true,
				})

				// Verify mode was imported
				expect(yaml.parse(files.get(mockRoomodes)!).customModes).toEqual([
					expect.objectContaining({ slug: "test-mode", source: "project" }),
				])
			})

			it("should remove existing rules folder and create new ones when importing mode with rules", async () => {
				const importYaml = yaml.stringify({
					customModes: [
						{
							slug: "test-mode",
							name: "Test Mode",
							roleDefinition: "Test Role",
							groups: ["read"],
							rulesFiles: [
								{
									relativePath: "rules-test-mode/new-rule.md",
									content: "New rule content",
								},
							],
						},
					],
				})

				;(fs.rm as Mock).mockResolvedValue(undefined)
				;(fs.mkdir as Mock).mockResolvedValue(undefined)

				const result = await manager.importModeWithRules(importYaml)

				expect(result.success).toBe(true)

				// Verify that fs.rm was called to remove the existing rules folder
				expect(fs.rm).toHaveBeenCalledWith(expect.stringContaining(path.join(".roo", "rules-test-mode")), {
					recursive: true,
					force: true,
				})

				// Verify new rules files were created
				expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining("rules-test-mode"), { recursive: true })

				// Verify file contents
				expect(files.get(path.join(mockWorkspacePath, ".roo", "rules-test-mode", "new-rule.md"))).toBe(
					"New rule content",
				)
			})
		})
	})

	describe("checkRulesDirectoryHasContent", () => {
		it("should return false when no workspace is available", async () => {
			;(getWorkspacePath as Mock).mockReturnValue(null)

			const result = await manager.checkRulesDirectoryHasContent("test-mode")

			expect(result).toBe(false)
		})

		it("should return false when mode is not in .roomodes file", async () => {
			const roomodesContent = { customModes: [{ slug: "other-mode", name: "Other Mode" }] }
			;(fileExistsAtPath as Mock).mockImplementation(async (path: string) => {
				return path === mockRoomodes
			})
			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockRoomodes) {
					return yaml.stringify(roomodesContent)
				}
				throw new Error("File not found")
			})

			const result = await manager.checkRulesDirectoryHasContent("test-mode")

			expect(result).toBe(false)
		})

		it("should return false when .roomodes doesn't exist and mode is not a custom mode", async () => {
			;(fileExistsAtPath as Mock).mockImplementation(async (path: string) => {
				return path === mockSettingsPath
			})
			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockSettingsPath) {
					return yaml.stringify({ customModes: [] })
				}
				throw new Error("File not found")
			})

			const result = await manager.checkRulesDirectoryHasContent("test-mode")

			expect(result).toBe(false)
		})

		it("should return false when rules directory doesn't exist", async () => {
			const roomodesContent = { customModes: [{ slug: "test-mode", name: "Test Mode" }] }
			;(fileExistsAtPath as Mock).mockImplementation(async (path: string) => {
				return path === mockRoomodes
			})
			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockRoomodes) {
					return yaml.stringify(roomodesContent)
				}
				throw new Error("File not found")
			})
			;(fs.stat as Mock).mockRejectedValue(notFound())

			const result = await manager.checkRulesDirectoryHasContent("test-mode")

			expect(result).toBe(false)
		})

		it("should return false when rules directory is empty", async () => {
			const roomodesContent = { customModes: [{ slug: "test-mode", name: "Test Mode" }] }
			;(fileExistsAtPath as Mock).mockImplementation(async (path: string) => {
				return path === mockRoomodes
			})
			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockRoomodes) {
					return yaml.stringify(roomodesContent)
				}
				throw new Error("File not found")
			})
			;(fs.stat as Mock).mockResolvedValue({ isDirectory: () => true })
			;(fs.readdir as Mock).mockResolvedValue([])

			const result = await manager.checkRulesDirectoryHasContent("test-mode")

			expect(result).toBe(false)
		})

		it("should return true when rules directory has content files", async () => {
			const roomodesContent = { customModes: [{ slug: "test-mode", name: "Test Mode" }] }
			;(fileExistsAtPath as Mock).mockImplementation(async (path: string) => {
				return path === mockRoomodes
			})
			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockRoomodes) {
					return yaml.stringify(roomodesContent)
				}
				if (path.includes("rules-test-mode")) {
					return "Some rule content"
				}
				throw new Error("File not found")
			})
			;(fs.stat as Mock).mockResolvedValue({ isDirectory: () => true })
			;(fs.readdir as Mock).mockResolvedValue([
				{ name: "rule1.md", isFile: () => true, parentPath: "/mock/workspace/.roo/rules-test-mode" },
			])

			const result = await manager.checkRulesDirectoryHasContent("test-mode")

			expect(result).toBe(true)
		})

		it("should work with global custom modes when .roomodes doesn't exist", async () => {
			const settingsContent = {
				customModes: [{ slug: "test-mode", name: "Test Mode", groups: ["read"], roleDefinition: "Test Role" }],
			}

			// Create a fresh manager instance to avoid cache issues
			const freshManager = new CustomModesManager(mockContext, mockOnUpdate)

			;(fileExistsAtPath as Mock).mockImplementation(async (path: string) => {
				return path === mockSettingsPath // .roomodes doesn't exist
			})
			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockSettingsPath) {
					return yaml.stringify(settingsContent)
				}
				if (path.includes("rules-test-mode")) {
					return "Some rule content"
				}
				throw new Error("File not found")
			})
			;(fs.stat as Mock).mockResolvedValue({ isDirectory: () => true })
			;(fs.readdir as Mock).mockResolvedValue([
				{ name: "rule1.md", isFile: () => true, parentPath: "/mock/workspace/.roo/rules-test-mode" },
			])

			const result = await freshManager.checkRulesDirectoryHasContent("test-mode")

			expect(result).toBe(true)
		})
	})

	describe("exportModeWithRules", () => {
		it("should return error when mode is not found and no workspace is available", async () => {
			// Create a fresh manager instance to avoid cache issues
			const freshManager = new CustomModesManager(mockContext, mockOnUpdate)

			// Mock no workspace folders
			;(vscode.workspace as any).workspaceFolders = []
			;(getWorkspacePath as Mock).mockReturnValue(null)
			;(fileExistsAtPath as Mock).mockResolvedValue(false)
			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockSettingsPath) {
					return yaml.stringify({ customModes: [] })
				}
				throw new Error("File not found")
			})

			const result = await freshManager.exportModeWithRules("test-mode")

			expect(result.success).toBe(false)
			expect(result.error).toBe("Mode not found")
		})

		it("should return error when mode is not found", async () => {
			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockSettingsPath) {
					return yaml.stringify({ customModes: [] })
				}
				throw new Error("File not found")
			})
			;(fileExistsAtPath as Mock).mockImplementation(async (path: string) => {
				return path === mockSettingsPath
			})

			const result = await manager.exportModeWithRules("test-mode")

			expect(result.success).toBe(false)
			expect(result.error).toBe("Mode not found")
		})

		it("should successfully export mode without rules when rules directory doesn't exist", async () => {
			const roomodesContent = {
				customModes: [{ slug: "test-mode", name: "Test Mode", roleDefinition: "Test Role", groups: ["read"] }],
			}
			;(fileExistsAtPath as Mock).mockImplementation(async (path: string) => {
				return path === mockRoomodes
			})
			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockRoomodes) {
					return yaml.stringify(roomodesContent)
				}
				throw new Error("File not found")
			})
			;(fs.stat as Mock).mockRejectedValue(notFound())

			const result = await manager.exportModeWithRules("test-mode")

			expect(result.success).toBe(true)
			expect(result.yaml).toContain("test-mode")
			expect(result.yaml).toContain("Test Mode")
		})

		it("should successfully export mode without rules when no rule files are found", async () => {
			const roomodesContent = {
				customModes: [{ slug: "test-mode", name: "Test Mode", roleDefinition: "Test Role", groups: ["read"] }],
			}
			;(fileExistsAtPath as Mock).mockImplementation(async (path: string) => {
				return path === mockRoomodes
			})
			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockRoomodes) {
					return yaml.stringify(roomodesContent)
				}
				throw new Error("File not found")
			})
			;(fs.stat as Mock).mockResolvedValue({ isDirectory: () => true })
			;(fs.readdir as Mock).mockResolvedValue([])

			const result = await manager.exportModeWithRules("test-mode")

			expect(result.success).toBe(true)
			expect(result.yaml).toContain("test-mode")
		})

		it("should successfully export mode with rules for a custom mode in .roomodes", async () => {
			const roomodesContent = {
				customModes: [
					{
						slug: "test-mode",
						name: "Test Mode",
						roleDefinition: "Test Role",
						groups: ["read"],
						customInstructions: "Existing instructions",
					},
				],
			}

			;(fileExistsAtPath as Mock).mockImplementation(async (path: string) => {
				return path === mockRoomodes
			})
			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockRoomodes) {
					return yaml.stringify(roomodesContent)
				}
				if (path.includes("rules-test-mode")) {
					return "New rule content from files"
				}
				throw new Error("File not found")
			})
			;(fs.stat as Mock).mockResolvedValue({ isDirectory: () => true })
			;(fs.readdir as Mock).mockResolvedValue([
				{ name: "rule1.md", isFile: () => true, parentPath: "/mock/workspace/.roo/rules-test-mode" },
			])

			const result = await manager.exportModeWithRules("test-mode")

			expect(result.success).toBe(true)
			expect(result.yaml).toContain("test-mode")
			expect(result.yaml).toContain("Existing instructions")
			expect(result.yaml).toContain("New rule content from files")
			// Should NOT delete the rules directory
			expect(fs.rm).not.toHaveBeenCalled()
		})

		it("should successfully export mode with rules for a built-in mode customized in .roomodes", async () => {
			const roomodesContent = {
				customModes: [
					{
						slug: "code",
						name: "Custom Code Mode",
						roleDefinition: "Custom Role",
						groups: ["read"],
					},
				],
			}

			;(fileExistsAtPath as Mock).mockImplementation(async (path: string) => {
				return path === mockRoomodes
			})
			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockRoomodes) {
					return yaml.stringify(roomodesContent)
				}
				if (path.includes("rules-code")) {
					return "Custom rules for code mode"
				}
				if (path === mockSettingsPath) {
					return yaml.stringify({ customModes: [] })
				}
				throw new Error("File not found")
			})
			;(fs.stat as Mock).mockResolvedValue({ isDirectory: () => true })
			;(fs.readdir as Mock).mockResolvedValue([
				{ name: "rule1.md", isFile: () => true, parentPath: "/mock/workspace/.roo/rules-code" },
			])

			const result = await manager.exportModeWithRules("code")

			expect(result.success).toBe(true)
			expect(result.yaml).toContain("Custom Code Mode")
			expect(result.yaml).toContain("Custom rules for code mode")
			// Should NOT delete the rules directory
			expect(fs.rm).not.toHaveBeenCalled()
		})

		it("should handle file read errors gracefully", async () => {
			const roomodesContent = {
				customModes: [
					{
						slug: "test-mode",
						name: "Test Mode",
						roleDefinition: "Test Role",
						groups: ["read"],
					},
				],
			}

			;(fileExistsAtPath as Mock).mockImplementation(async (path: string) => {
				return path === mockRoomodes
			})
			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockRoomodes) {
					return yaml.stringify(roomodesContent)
				}
				if (path.includes("rules-test-mode")) {
					throw new Error("Permission denied")
				}
				throw new Error("File not found")
			})
			;(fs.stat as Mock).mockResolvedValue({ isDirectory: () => true })
			;(fs.readdir as Mock).mockResolvedValue([
				{ name: "rule1.md", isFile: () => true, parentPath: "/mock/workspace/.roo/rules-test-mode" },
			])

			const result = await manager.exportModeWithRules("test-mode")

			// Should still succeed even if file read fails
			expect(result.success).toBe(true)
			expect(result.yaml).toContain("test-mode")
		})

		it("should successfully export global mode with rules from global .roo directory", async () => {
			// Mock a global mode
			const globalMode = {
				slug: "global-test-mode",
				name: "Global Test Mode",
				roleDefinition: "Global Test Role",
				groups: ["read"],
				source: "global",
			}

			// Create a fresh manager instance to avoid cache issues
			const freshManager = new CustomModesManager(mockContext, mockOnUpdate)

			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockSettingsPath) {
					return yaml.stringify({ customModes: [globalMode] })
				}
				if (path.includes("rules-global-test-mode") && path.includes("rule1.md")) {
					return "Global rule content"
				}
				throw new Error("File not found")
			})
			;(fileExistsAtPath as Mock).mockImplementation(async (path: string) => {
				return path === mockSettingsPath
			})
			;(fs.stat as Mock).mockImplementation(async (path: string) => {
				if (path.includes("rules-global-test-mode")) {
					return { isDirectory: () => true }
				}
				throw new Error("Directory not found")
			})
			;(fs.readdir as Mock).mockImplementation(async (path: string) => {
				if (path.includes("rules-global-test-mode")) {
					return [{ name: "rule1.md", isFile: () => true }]
				}
				return []
			})

			const result = await freshManager.exportModeWithRules("global-test-mode")

			expect(result.success).toBe(true)
			expect(result.yaml).toContain("global-test-mode")
			expect(result.yaml).toContain("Global Test Mode")
			expect(result.yaml).toContain("Global rule content")
		})

		it("should successfully export global mode without rules when global rules directory doesn't exist", async () => {
			// Mock a global mode
			const globalMode = {
				slug: "global-test-mode",
				name: "Global Test Mode",
				roleDefinition: "Global Test Role",
				groups: ["read"],
				source: "global",
			}

			// Create a fresh manager instance to avoid cache issues
			const freshManager = new CustomModesManager(mockContext, mockOnUpdate)

			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockSettingsPath) {
					return yaml.stringify({ customModes: [globalMode] })
				}
				throw new Error("File not found")
			})
			;(fileExistsAtPath as Mock).mockImplementation(async (path: string) => {
				return path === mockSettingsPath
			})
			;(fs.stat as Mock).mockRejectedValue(notFound())

			const result = await freshManager.exportModeWithRules("global-test-mode")

			expect(result.success).toBe(true)
			expect(result.yaml).toContain("global-test-mode")
			expect(result.yaml).toContain("Global Test Mode")
			// Should not contain rulesFiles since no rules directory exists
			expect(result.yaml).not.toContain("rulesFiles")
		})

		it("should handle global mode export when workspace is not available", async () => {
			// Mock a global mode
			const globalMode = {
				slug: "global-test-mode",
				name: "Global Test Mode",
				roleDefinition: "Global Test Role",
				groups: ["read"],
				source: "global",
			}

			// Create a fresh manager instance to avoid cache issues
			const freshManager = new CustomModesManager(mockContext, mockOnUpdate)

			// Mock no workspace folders
			;(vscode.workspace as any).workspaceFolders = []
			;(getWorkspacePath as Mock).mockReturnValue(null)
			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockSettingsPath) {
					return yaml.stringify({ customModes: [globalMode] })
				}
				if (path.includes("rules-global-test-mode") && path.includes("rule1.md")) {
					return "Global rule content"
				}
				throw new Error("File not found")
			})
			;(fileExistsAtPath as Mock).mockImplementation(async (path: string) => {
				return path === mockSettingsPath
			})
			;(fs.stat as Mock).mockImplementation(async (path: string) => {
				if (path.includes("rules-global-test-mode")) {
					return { isDirectory: () => true }
				}
				throw new Error("Directory not found")
			})
			;(fs.readdir as Mock).mockImplementation(async (path: string) => {
				if (path.includes("rules-global-test-mode")) {
					return [{ name: "rule1.md", isFile: () => true }]
				}
				return []
			})

			const result = await freshManager.exportModeWithRules("global-test-mode")

			// Should succeed even without workspace since it's a global mode
			expect(result.success).toBe(true)
			expect(result.yaml).toContain("global-test-mode")
			expect(result.yaml).toContain("Global rule content")
		})

		it("should normalize paths to use forward slashes in exported YAML", async () => {
			const roomodesContent = {
				customModes: [
					{
						slug: "test-mode",
						name: "Test Mode",
						roleDefinition: "Test Role",
						groups: ["read"],
					},
				],
			}

			;(fileExistsAtPath as Mock).mockImplementation(async (path: string) => {
				return path === mockRoomodes
			})
			;(fs.readFile as Mock).mockImplementation(async (path: string) => {
				if (path === mockRoomodes) {
					return yaml.stringify(roomodesContent)
				}
				if (path.includes("rules-test-mode")) {
					return "Rule content"
				}
				throw new Error("File not found")
			})
			;(fs.stat as Mock).mockResolvedValue({ isDirectory: () => true })

			// Mock readdir to return entries with subdirectories
			;(fs.readdir as Mock).mockResolvedValue([
				{ name: "rule1.md", isFile: () => true },
				{ name: "rule2.md", isFile: () => true },
			])

			const result = await manager.exportModeWithRules("test-mode")

			expect(result.success).toBe(true)

			// Parse the YAML to check the paths
			const exportedData = yaml.parse(result.yaml!)
			const rulesFiles = exportedData.customModes[0].rulesFiles

			// Verify that all paths use forward slashes
			expect(rulesFiles).toBeDefined()
			expect(rulesFiles.length).toBe(2)

			// Check that all paths use forward slashes and do NOT include the rules-{slug} prefix
			rulesFiles.forEach((file: any) => {
				expect(file.relativePath).not.toContain("\\")
				// The PR excludes the rules-{slug} folder from paths
				expect(file.relativePath).not.toMatch(/^rules-test-mode\//)
				// Files should be at the root level now
				expect(file.relativePath).toMatch(/^rule\d+\.md$/)
			})

			// Ensure no backslashes in the entire exported YAML
			expect(result.yaml).not.toContain("\\")
		})
	})
})
