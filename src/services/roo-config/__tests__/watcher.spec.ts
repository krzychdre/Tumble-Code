// npx vitest run services/roo-config/__tests__/watcher.spec.ts

import * as path from "path"

const { watchers, invalidate } = vi.hoisted(() => ({
	watchers: [] as Array<{
		pattern: unknown
		create: () => void
		change: () => void
		delete: () => void
		dispose: ReturnType<typeof vi.fn>
	}>,
	invalidate: vi.fn(),
}))

vi.mock("vscode", () => ({
	workspace: {
		createFileSystemWatcher: vi.fn((pattern: unknown) => {
			const watcher = {
				pattern,
				create: () => {},
				change: () => {},
				delete: () => {},
				dispose: vi.fn(),
			}
			watchers.push(watcher)
			const hook = (key: "create" | "change" | "delete") => (listener: () => void) => {
				watcher[key] = listener
				return { dispose: vi.fn() }
			}
			return {
				onDidCreate: hook("create"),
				onDidChange: hook("change"),
				onDidDelete: hook("delete"),
				dispose: watcher.dispose,
			}
		}),
	},
	RelativePattern: class {
		constructor(
			public base: unknown,
			public pattern: string,
		) {}
	},
	Uri: { file: (fsPath: string) => ({ fsPath }) },
}))

vi.mock("../cache", () => ({ invalidateRooDirectoryCache: invalidate }))
vi.mock("../index", () => ({ getGlobalRooDirectory: () => path.join("home", ".roo") }))

import { registerRooDirectoryWatchers } from "../watcher"

describe("registerRooDirectoryWatchers", () => {
	beforeEach(() => {
		watchers.length = 0
		invalidate.mockClear()
	})

	it("watches every workspace .roo directory and the global commands directory", () => {
		const disposables = registerRooDirectoryWatchers()

		expect(watchers.map((w) => w.pattern)).toEqual([
			"**/.roo/**",
			expect.objectContaining({ pattern: "{commands,commands/**}", base: { fsPath: path.join("home", ".roo") } }),
		])
		// Two watchers plus three event subscriptions each.
		expect(disposables).toHaveLength(8)
	})

	it("drops every lookup when a file appears or disappears, and only command lists when one changes", () => {
		registerRooDirectoryWatchers()
		const [workspace] = watchers

		workspace.create()
		workspace.delete()
		expect(invalidate).toHaveBeenNthCalledWith(1)
		expect(invalidate).toHaveBeenNthCalledWith(2)

		workspace.change()
		expect(invalidate).toHaveBeenNthCalledWith(3, "commands")
	})
})
