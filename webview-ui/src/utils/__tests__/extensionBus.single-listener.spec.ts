import fs from "fs"
import path from "path"

/**
 * WEB-7: extension messages reach components through utils/extensionBus.ts,
 * which holds the only window "message" listener. A component that adds its
 * own listener again (directly or through react-use `useEvent`) fails here.
 */

const srcRoot = path.resolve(__dirname, "../..")

// Every component is on the bus now (ChatView was the last, WEB-8). Add an
// entry here only for a file that must own a listener of its own.
const allowed = new Set(["utils/extensionBus.ts"].map((file) => path.join(srcRoot, file)))

const listenerPattern = /addEventListener\(\s*["'`]message["'`]|useEvent\(\s*["'`]message["'`]/

function productionFiles(dir: string): string[] {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name)
		if (entry.isDirectory()) {
			return entry.name === "__tests__" || entry.name === "__mocks__" ? [] : productionFiles(full)
		}
		const isSource = /\.(ts|tsx)$/.test(entry.name)
		const isSpec = /\.(spec|test)\.(ts|tsx)$/.test(entry.name)
		return isSource && !isSpec ? [full] : []
	})
}

describe("extension message listeners", () => {
	it("only utils/extensionBus.ts listens to window messages", () => {
		const offenders = productionFiles(srcRoot)
			.filter((file) => !allowed.has(file))
			.filter((file) => listenerPattern.test(fs.readFileSync(file, "utf8")))
			.map((file) => path.relative(srcRoot, file).split(path.sep).join("/"))

		expect(offenders).toEqual([])
	})

	it("the allowlisted files still exist", () => {
		for (const file of allowed) {
			expect(fs.existsSync(file)).toBe(true)
		}
	})
})
