import fs from "fs/promises"
import os from "os"
import path from "path"

import { FAKE_AI_MODULE_ENV, loadFakeAiProviderSettings } from "../fake-ai-module.js"

describe("loadFakeAiProviderSettings", () => {
	let dir: string

	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), "cli-fake-ai-"))
	})

	afterEach(async () => {
		await fs.rm(dir, { recursive: true, force: true })
	})

	async function writeModule(name: string, source: string): Promise<string> {
		const file = path.join(dir, name)
		await fs.writeFile(file, source, "utf8")
		return file
	}

	it("returns undefined when the variable is not set", async () => {
		await expect(loadFakeAiProviderSettings({})).resolves.toBeUndefined()
	})

	it("hands the extension the module's fake model on the fake-ai provider", async () => {
		const file = await writeModule(
			"fake.mjs",
			`const fake = { id: "scripted", async *createMessage() {}, getModel() {}, countTokens() {}, completePrompt() {} }
export default fake
export const self = fake
`,
		)

		const settings = await loadFakeAiProviderSettings({ [FAKE_AI_MODULE_ENV]: file })
		const module = (await import(`file://${file}`)) as { self: unknown }

		expect(settings?.apiProvider).toBe("fake-ai")
		// The same object, not a copy: FakeAIHandler calls its functions.
		expect(settings?.fakeAi).toBe(module.self)
	})

	it("resolves a relative path against the current directory", async () => {
		const file = await writeModule("relative.mjs", `export default { id: "rel", async *createMessage() {} }`)

		const settings = await loadFakeAiProviderSettings({
			[FAKE_AI_MODULE_ENV]: path.relative(process.cwd(), file),
		})

		expect((settings?.fakeAi as { id: string }).id).toBe("rel")
	})

	it("names the variable when the module exports no fake model", async () => {
		const file = await writeModule("empty.mjs", `export default { id: "no-functions" }`)

		await expect(loadFakeAiProviderSettings({ [FAKE_AI_MODULE_ENV]: file })).rejects.toThrow(
			`${FAKE_AI_MODULE_ENV}: ${file} must default-export a fake model with an id and createMessage()`,
		)
	})
})
