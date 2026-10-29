// cd src && npx vitest run core/tools/__tests__/projectToolTrust.spec.ts
// Real folders in a temporary directory; the store is in memory, the question a recorder.

import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import { mayLoadProjectTools, TRUSTED_PROJECT_TOOLS_KEY } from "../projectToolTrust"

function memoryStore() {
	const values = new Map<string, unknown>()
	return {
		values,
		get: <T>(key: string) => values.get(key) as T | undefined,
		update: async (key: string, value: unknown) => void values.set(key, value),
	}
}

describe("project custom tools need consent", () => {
	let toolDir: string
	let store: ReturnType<typeof memoryStore>
	let asked: string[][]
	let answer: boolean
	let workspaceTrusted: boolean

	const mayLoad = () =>
		mayLoadProjectTools(toolDir, {
			store,
			isWorkspaceTrusted: () => workspaceTrusted,
			confirm: async (_dir, files) => {
				asked.push(files)
				return answer
			},
		})

	beforeEach(async () => {
		toolDir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "project-tools-")), ".roo", "tools")
		await fs.mkdir(path.join(toolDir, "lib"), { recursive: true })
		await fs.writeFile(path.join(toolDir, "deploy.ts"), "export default {}")
		await fs.writeFile(path.join(toolDir, "lib", "helper.ts"), "export const x = 1")
		store = memoryStore()
		asked = []
		answer = true
		workspaceTrusted = true
	})

	afterEach(async () => {
		await fs.rm(path.dirname(path.dirname(toolDir)), { recursive: true, force: true })
	})

	it("asks once, naming the tool files, and remembers the yes", async () => {
		expect(await mayLoad()).toBe(true)
		expect(asked).toEqual([["deploy.ts"]])

		expect(await mayLoad()).toBe(true)
		expect(asked).toHaveLength(1)
		expect(store.values.get(TRUSTED_PROJECT_TOOLS_KEY)).toHaveLength(1)
	})

	it("loads nothing after a no, and does not ask again for the same content", async () => {
		answer = false
		expect(await mayLoad()).toBe(false)
		expect(await mayLoad()).toBe(false)
		expect(asked).toHaveLength(1)
	})

	it.each([
		["a tool file", "deploy.ts"],
		["a file a tool imports", path.join("lib", "helper.ts")],
	])("asks again when %s changes", async (_label, file) => {
		await mayLoad()
		await fs.writeFile(path.join(toolDir, file), "export default { evil: true }")

		answer = false
		expect(await mayLoad()).toBe(false)
		expect(asked).toHaveLength(2)
	})

	it("loads nothing and asks nothing in a workspace the editor does not trust", async () => {
		workspaceTrusted = false
		expect(await mayLoad()).toBe(false)
		expect(asked).toEqual([])
	})

	it("asks nothing for a folder without tool files", async () => {
		await fs.rm(path.join(toolDir, "deploy.ts"))
		expect(await mayLoad()).toBe(false)
		expect(asked).toEqual([])
	})
})
