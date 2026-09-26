// cd src && ./node_modules/.bin/vitest run core/ignore/__tests__/RooIgnoreController.filterPaths-realpath.spec.ts

// API P6 (Phase 10): filterPaths resolved every path with fs.realpathSync, which
// in Node's JS implementation checks every path component (about 8 file-system
// calls per path in this repository). It now resolves each directory once per
// call and checks only the file itself for a symlink. The result must stay the
// same as resolving every path on its own, including symlinks into ignored
// directories.

import * as fs from "fs"
import fsSync from "fs"
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

// Creating symlinks needs extra privileges on Windows.
describe.skipIf(process.platform === "win32")(
	"RooIgnoreController.filterPaths resolves symlinks per directory (API P6)",
	() => {
		let root: string
		let controller: RooIgnoreController
		const paths = [
			"src/a.ts",
			"src/b.ts",
			"src/nested/c.ts",
			"secrets/key.txt",
			"src/link-to-secret.txt",
			"linked-dir/key.txt",
			"src/missing.ts",
			"src/dangling.txt",
			"src",
			"README.md",
		]

		beforeEach(async () => {
			root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "rooignore-p6-")))
			fs.mkdirSync(path.resolve(root, "src/nested"), { recursive: true })
			fs.mkdirSync(path.resolve(root, "secrets"))
			for (const file of ["src/a.ts", "src/b.ts", "src/nested/c.ts", "secrets/key.txt", "README.md"]) {
				fs.writeFileSync(path.resolve(root, file), "x")
			}
			fs.writeFileSync(path.resolve(root, ".rooignore"), "secrets/\n")
			// A file symlink and a directory symlink into the ignored directory, and a dangling link.
			fs.symlinkSync(path.resolve(root, "secrets/key.txt"), path.resolve(root, "src/link-to-secret.txt"))
			fs.symlinkSync(path.resolve(root, "secrets"), path.resolve(root, "linked-dir"))
			fs.symlinkSync(path.resolve(root, "nowhere.txt"), path.resolve(root, "src/dangling.txt"))

			controller = new RooIgnoreController(root)
			await controller.initialize()
		})

		afterEach(() => {
			controller.dispose()
			fs.rmSync(root, { recursive: true, force: true })
			vi.restoreAllMocks()
		})

		it("gives the same answer as resolving every path on its own", () => {
			const oneByOne = paths.filter((p) => controller.validateAccess(p))

			expect(controller.filterPaths(paths)).toEqual(oneByOne)
			expect(oneByOne).toEqual([
				"src/a.ts",
				"src/b.ts",
				"src/nested/c.ts",
				"src/missing.ts",
				"src/dangling.txt",
				"src",
				"README.md",
			])
		})

		it("resolves each directory once instead of every path", () => {
			const many = Array.from({ length: 40 }, (_, i) => `src/file-${i}.ts`)
			for (const file of many) {
				fs.writeFileSync(path.resolve(root, file), "x")
			}
			const realpathSync = vi.spyOn(fsSync, "realpathSync")

			const allowed = controller.filterPaths([...paths, ...many])

			expect(allowed).toHaveLength(7 + many.length)
			// Before: one realpathSync per path (50). Now: one per distinct parent
			// directory (root, src, src/nested, secrets, linked-dir) plus one per path
			// that is itself a symlink (link-to-secret, dangling).
			expect(realpathSync).toHaveBeenCalledTimes(7)
		})
	},
)
