// npx vitest run services/roo-config/__tests__/watcher.spec.ts

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

import { registerRooDirectoryWatchers } from "../watcher"

describe("registerRooDirectoryWatchers", () => {
	beforeEach(() => {
		watchers.length = 0
		invalidate.mockClear()
	})

	it("watches every workspace .roo directory, and only for files appearing or disappearing", () => {
		const disposables = registerRooDirectoryWatchers()

		expect(watchers.map((w) => w.pattern)).toEqual(["**/.roo/**"])
		// One watcher plus the create and delete subscriptions.
		expect(disposables).toHaveLength(3)
	})

	it("drops every lookup when a file appears or disappears, and nothing when one changes", () => {
		registerRooDirectoryWatchers()
		const [workspace] = watchers

		workspace.create()
		workspace.delete()
		expect(invalidate).toHaveBeenNthCalledWith(1)
		expect(invalidate).toHaveBeenNthCalledWith(2)

		workspace.change()
		expect(invalidate).toHaveBeenCalledTimes(2)
	})
})
