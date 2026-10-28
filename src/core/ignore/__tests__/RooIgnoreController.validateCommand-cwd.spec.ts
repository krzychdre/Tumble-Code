// cd src && npx vitest run core/ignore/__tests__/RooIgnoreController.validateCommand-cwd.spec.ts

import * as fs from "fs"
import * as os from "os"
import * as path from "path"

vi.mock("vscode", () => ({
	workspace: {
		createFileSystemWatcher: vi.fn(() => ({
			onDidCreate: vi.fn(() => ({ dispose: vi.fn() })),
			onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
			onDidDelete: vi.fn(() => ({ dispose: vi.fn() })),
			dispose: vi.fn(),
		})),
	},
	RelativePattern: vi.fn(),
}))

import { RooIgnoreController } from "../RooIgnoreController"

// The directory a command runs in decides which file a relative path names:
// `cat key.txt` run in secrets/ reads secrets/key.txt.
describe("RooIgnoreController.validateCommand in another working directory", () => {
	let root: string
	let controller: RooIgnoreController

	beforeEach(async () => {
		root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "rooignore-cwd-")))
		fs.mkdirSync(path.join(root, "secrets"))
		fs.mkdirSync(path.join(root, "src"))
		fs.writeFileSync(path.join(root, "secrets", "key.txt"), "x")
		fs.writeFileSync(path.join(root, ".rooignore"), "secrets/\n")
		controller = new RooIgnoreController(root)
		await controller.initialize()
	})

	afterEach(() => {
		controller.dispose()
		fs.rmSync(root, { recursive: true, force: true })
	})

	it.each([
		["a relative working directory", "cat key.txt", "secrets"],
		["an absolute working directory", "cat key.txt", "<root>/secrets"],
		["a path climbing back from a subdirectory", "cat ../secrets/key.txt", "src"],
		["a cd to an absolute directory in the chain", "cd <root>/secrets && cat key.txt", undefined],
		["a cd inside a wrapper", "sh -c 'cd secrets && cat key.txt'", undefined],
	])("refuses a read of an ignored file through %s", (_label, command, workingDirectory) => {
		const fill = (text: string) => text.replace("<root>", root)
		expect(controller.validateCommand(fill(command), workingDirectory && fill(workingDirectory))).toBeDefined()
	})

	it("allows the same file name where it is not ignored", () => {
		fs.writeFileSync(path.join(root, "src", "key.txt"), "x")
		expect(controller.validateCommand("cat key.txt", "src")).toBeUndefined()
		expect(controller.validateCommand("cat key.txt")).toBeUndefined()
	})
})
