import type { Mock } from "vitest"
// cd src && ./node_modules/.bin/vitest run services/mcp/__tests__/McpConfigWatcher.spec.ts

import * as path from "path"

import * as vscode from "vscode"

import {
	McpConfigWatcher,
	type McpConfigWatcherListener,
	type McpFileListeners,
	type McpWatcherFactory,
	vscodeWatcherFactory,
} from "../McpConfigWatcher"

vi.mock("vscode", () => {
	const watcher = {
		onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
		onDidCreate: vi.fn(() => ({ dispose: vi.fn() })),
		onDidDelete: vi.fn(() => ({ dispose: vi.fn() })),
		dispose: vi.fn(),
	}
	return {
		workspace: {
			createFileSystemWatcher: vi.fn(() => watcher),
			onDidChangeWorkspaceFolders: vi.fn(() => ({ dispose: vi.fn() })),
		},
		RelativePattern: vi.fn(function (base: string, pattern: string) {
			return { base, pattern }
		}),
		Disposable: { from: vi.fn((...items: unknown[]) => ({ items, dispose: vi.fn() })) },
	}
})

function createFakeFactory() {
	const watches: { file: string; listeners: McpFileListeners; dispose: Mock }[] = []
	let folderListener: (() => void) | undefined
	const folderSubscription = { dispose: vi.fn() }
	const factory: McpWatcherFactory = {
		watchFile: (baseDirectory, relativePattern, listeners) => {
			const watch = { file: path.join(baseDirectory, relativePattern), listeners, dispose: vi.fn() }
			watches.push(watch)
			return watch
		},
		onDidChangeWorkspaceFolders: (listener) => {
			folderListener = listener
			return folderSubscription
		},
	}
	return { factory, watches, folderSubscription, changeFolders: () => folderListener?.() }
}

describe("McpConfigWatcher", () => {
	const settingsPath = path.join(path.resolve("/settings"), "mcp_settings.json")
	const workspaceDir = path.resolve("/workspace")
	const projectPath = path.join(workspaceDir, ".roo", "mcp.json")

	let fake: ReturnType<typeof createFakeFactory>
	let guardUp: boolean
	let listener: { [K in keyof McpConfigWatcherListener]: Mock }
	let watcher: McpConfigWatcher

	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
		fake = createFakeFactory()
		guardUp = false
		listener = {
			onConfigFileChanged: vi.fn().mockResolvedValue(undefined),
			onProjectConfigDeleted: vi.fn().mockResolvedValue(undefined),
			onWorkspaceFoldersChanged: vi.fn().mockResolvedValue(undefined),
		}
		watcher = new McpConfigWatcher(fake.factory, () => guardUp, listener)
	})

	afterEach(() => {
		watcher.dispose()
		vi.useRealTimers()
	})

	it("watches the global file by its directory and name", () => {
		watcher.watchGlobalFile(settingsPath)

		expect(fake.watches.map((w) => w.file)).toEqual([settingsPath])
	})

	it("reports a burst of global changes once, 500 ms after the last event", () => {
		watcher.watchGlobalFile(settingsPath)
		const [watch] = fake.watches

		watch.listeners.onChange(settingsPath)
		vi.advanceTimersByTime(300)
		watch.listeners.onCreate(settingsPath)
		vi.advanceTimersByTime(499)
		expect(listener.onConfigFileChanged).not.toHaveBeenCalled()

		vi.advanceTimersByTime(1)
		expect(listener.onConfigFileChanged).toHaveBeenCalledTimes(1)
		expect(listener.onConfigFileChanged).toHaveBeenCalledWith(settingsPath, "global")
	})

	it("ignores events for other files next to the global file", () => {
		watcher.watchGlobalFile(settingsPath)

		fake.watches[0].listeners.onChange(path.join(path.dirname(settingsPath), "other.json"))
		vi.advanceTimersByTime(500)

		expect(listener.onConfigFileChanged).not.toHaveBeenCalled()
	})

	it("drops events while the write guard is up", () => {
		watcher.watchGlobalFile(settingsPath)
		guardUp = true

		fake.watches[0].listeners.onChange(settingsPath)
		guardUp = false
		vi.advanceTimersByTime(500)

		expect(listener.onConfigFileChanged).not.toHaveBeenCalled()
	})

	it("asks the write guard about the file that changed, so one file's guard does not hide the other", () => {
		watcher = new McpConfigWatcher(fake.factory, (filePath) => filePath === settingsPath, listener)
		watcher.watchGlobalFile(settingsPath)
		watcher.watchProjectFile(workspaceDir)
		const [globalWatch, projectWatch] = fake.watches

		globalWatch.listeners.onChange(settingsPath)
		projectWatch.listeners.onChange(projectPath)
		vi.advanceTimersByTime(500)

		expect(listener.onConfigFileChanged.mock.calls).toEqual([[projectPath, "project"]])
	})

	it("debounces the global and the project file separately", () => {
		watcher.watchGlobalFile(settingsPath)
		watcher.watchProjectFile(workspaceDir)
		const [globalWatch, projectWatch] = fake.watches

		globalWatch.listeners.onChange(settingsPath)
		vi.advanceTimersByTime(250)
		projectWatch.listeners.onChange(projectPath)
		vi.advanceTimersByTime(250)
		expect(listener.onConfigFileChanged.mock.calls).toEqual([[settingsPath, "global"]])

		vi.advanceTimersByTime(250)
		expect(listener.onConfigFileChanged.mock.calls).toEqual([
			[settingsPath, "global"],
			[projectPath, "project"],
		])
	})

	it("reports a deleted project file at once", () => {
		watcher.watchProjectFile(workspaceDir)

		fake.watches[0].listeners.onDelete?.(projectPath)

		expect(fake.watches[0].file).toBe(projectPath)
		expect(listener.onProjectConfigDeleted).toHaveBeenCalledTimes(1)
	})

	it("replaces the project watch, and only stops it without a workspace folder", () => {
		watcher.watchProjectFile(workspaceDir)
		watcher.watchProjectFile(workspaceDir)
		expect(fake.watches[0].dispose).toHaveBeenCalled()
		expect(fake.watches[1].dispose).not.toHaveBeenCalled()

		watcher.watchProjectFile(undefined)

		expect(fake.watches[1].dispose).toHaveBeenCalled()
		expect(fake.watches).toHaveLength(2)
	})

	it("reports workspace folder changes", () => {
		watcher.watchWorkspaceFolders()

		fake.changeFolders()

		expect(listener.onWorkspaceFoldersChanged).toHaveBeenCalledTimes(1)
	})

	it("stops every watch and drops pending changes on dispose", () => {
		watcher.watchGlobalFile(settingsPath)
		watcher.watchProjectFile(workspaceDir)
		watcher.watchWorkspaceFolders()
		fake.watches[0].listeners.onChange(settingsPath)

		watcher.dispose()
		vi.advanceTimersByTime(500)

		expect(listener.onConfigFileChanged).not.toHaveBeenCalled()
		expect(fake.watches.every((w) => w.dispose.mock.calls.length === 1)).toBe(true)
		expect(fake.folderSubscription.dispose).toHaveBeenCalled()
	})
})

describe("vscodeWatcherFactory", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("creates a VS Code watcher for the pattern and forwards the file paths", () => {
		const listeners = { onChange: vi.fn(), onCreate: vi.fn(), onDelete: vi.fn() }

		vscodeWatcherFactory.watchFile("/base", ".roo/mcp.json", listeners)

		expect(vscode.RelativePattern).toHaveBeenCalledWith("/base", ".roo/mcp.json")
		const fsWatcher = vi.mocked(vscode.workspace.createFileSystemWatcher).mock.results[0].value
		vi.mocked(fsWatcher.onDidChange).mock.calls[0][0]({ fsPath: "/base/.roo/mcp.json" })
		vi.mocked(fsWatcher.onDidCreate).mock.calls[0][0]({ fsPath: "/base/.roo/mcp.json" })
		vi.mocked(fsWatcher.onDidDelete).mock.calls[0][0]({ fsPath: "/base/.roo/mcp.json" })
		expect(listeners.onChange).toHaveBeenCalledWith("/base/.roo/mcp.json")
		expect(listeners.onCreate).toHaveBeenCalledWith("/base/.roo/mcp.json")
		expect(listeners.onDelete).toHaveBeenCalledWith("/base/.roo/mcp.json")
		// The watcher itself goes into the returned disposable with its subscriptions.
		expect(vi.mocked(vscode.Disposable.from).mock.calls[0]).toContain(fsWatcher)
	})

	it("does not subscribe to deletions nobody listens for", () => {
		vscodeWatcherFactory.watchFile("/base", "mcp_settings.json", { onChange: vi.fn(), onCreate: vi.fn() })

		const fsWatcher = vi.mocked(vscode.workspace.createFileSystemWatcher).mock.results[0].value
		expect(fsWatcher.onDidDelete).not.toHaveBeenCalled()
	})

	it("watches nothing on a host without the VS Code watcher API", () => {
		const workspace = vscode.workspace as { createFileSystemWatcher?: unknown }
		const original = workspace.createFileSystemWatcher
		workspace.createFileSystemWatcher = undefined
		try {
			expect(vscodeWatcherFactory.watchFile("/base", "x.json", { onChange: vi.fn(), onCreate: vi.fn() })).toBe(
				undefined,
			)
		} finally {
			workspace.createFileSystemWatcher = original
		}
	})
})
