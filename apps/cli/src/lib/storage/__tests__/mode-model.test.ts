import fs from "fs"
import os from "os"
import path from "path"

import { getConfigDir } from "@/lib/storage/config-dir.js"

import { createModelChoiceSaver, setModeModel } from "../mode-model.js"

// Point the settings file at a temp dir via the leaf config-dir module.
vi.mock("@/lib/storage/config-dir.js", () => ({
	getConfigDir: vi.fn(() => path.join(os.tmpdir(), "cli-config-dir-default")),
}))

const mockGetConfigDir = getConfigDir as unknown as ReturnType<typeof vi.fn>

/** The owner's file (key redacted), written by hand with spaces. */
const ownerFile = {
	provider: "openai",
	model: "GLM-5.3-NVFP4",
	baseUrl: "http://192.168.50.194:11111/v1",
	apiKey: "secret",
	models: {
		"GLM-5.3-NVFP4": { contextWindow: 262144, preserveReasoning: true, reasoningEffort: "high", inputPrice: 1.4 },
		"Qwen3.8-27B": { contextWindow: 262144, reasoningEffort: "xhigh" },
		"Qwen3.5-4B": { contextWindow: 40960, baseUrl: "http://localhost:11111/v1", modelSize: "compact" },
	},
}

describe("setModeModel", () => {
	it("adds the mode to the model's list, creating the list", () => {
		const file = structuredClone(ownerFile) as Record<string, unknown>

		expect(setModeModel(file, "code", "Qwen3.8-27B")).toBe("models.Qwen3.8-27B.modes")
		expect(file).toEqual({
			...ownerFile,
			models: { ...ownerFile.models, "Qwen3.8-27B": { ...ownerFile.models["Qwen3.8-27B"], modes: ["code"] } },
		})
	})

	it("creates models and the entry when missing", () => {
		const file: Record<string, unknown> = { provider: "openai" }

		setModeModel(file, "debug", "Qwen3.8-27B")

		expect(file).toEqual({ provider: "openai", models: { "Qwen3.8-27B": { modes: ["debug"] } } })
	})

	it("moves the mode out of another model's list, dropping an emptied list and an emptied entry only", () => {
		const file: Record<string, unknown> = {
			models: {
				A: { modes: ["code"] },
				B: { reasoningEffort: "high", modes: ["code", "code"] },
				C: { modes: ["code", "debug"] },
				D: { modes: ["ask"] },
			},
		}

		setModeModel(file, "code", "D")

		expect(file).toEqual({
			models: { B: { reasoningEffort: "high" }, C: { modes: ["debug"] }, D: { modes: ["ask", "code"] } },
		})
	})

	it("leaves a list that already names the mode as it is", () => {
		const file: Record<string, unknown> = { models: { Q: { modes: ["debug", "code", "debug"] } } }

		setModeModel(file, "code", "Q")

		expect(file).toEqual({ models: { Q: { modes: ["debug", "code", "debug"] } } })
	})

	it("updates modes.<mode>.model in place where the file names the model there", () => {
		const file: Record<string, unknown> = {
			modes: { code: { model: "GLM-5.3-NVFP4", baseUrl: "http://x/v1" }, ask: { model: "GLM-5.3-NVFP4" } },
			// The same model in both places was allowed; left alone it would now contradict.
			models: { "GLM-5.3-NVFP4": { reasoningEffort: "high", modes: ["code", "ask"] } },
		}

		expect(setModeModel(file, "code", "Qwen3.8-27B")).toBe("modes.code.model")
		expect(file).toEqual({
			modes: { code: { model: "Qwen3.8-27B", baseUrl: "http://x/v1" }, ask: { model: "GLM-5.3-NVFP4" } },
			models: { "GLM-5.3-NVFP4": { reasoningEffort: "high", modes: ["ask"] } },
		})
	})

	it("uses the list for a modes entry that names no model, and leaves that entry alone", () => {
		const file: Record<string, unknown> = { modes: { code: { baseUrl: "http://x/v1" } } }

		expect(setModeModel(file, "code", "Q")).toBe("models.Q.modes")
		expect(file).toEqual({ modes: { code: { baseUrl: "http://x/v1" } }, models: { Q: { modes: ["code"] } } })
	})

	it("refuses an entry or a list it cannot extend", () => {
		expect(() => setModeModel({ models: [] }, "code", "Q")).toThrow("models is not an object")
		expect(() => setModeModel({ models: { Q: 1 } }, "code", "Q")).toThrow("models.Q is not an object")
		expect(() => setModeModel({ models: { Q: { modes: "code" } } }, "code", "Q")).toThrow(
			"models.Q.modes is not a list",
		)
	})
})

describe("createModelChoiceSaver", () => {
	let tempDir: string
	let settingsPath: string
	const save = createModelChoiceSaver({ providerFlags: false, ephemeral: false })

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-mode-model-test-"))
		mockGetConfigDir.mockReturnValue(tempDir)
		settingsPath = path.join(tempDir, "cli-settings.json")
	})

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true })
	})

	function writeOwnerFile() {
		fs.writeFileSync(settingsPath, JSON.stringify(ownerFile, null, 2) + "\n", { mode: 0o600 })
		fs.chmodSync(settingsPath, 0o600)
	}

	const readFile = () => JSON.parse(fs.readFileSync(settingsPath, "utf-8"))

	it("saves the choice and touches no other key, in the same order", async () => {
		writeOwnerFile()

		await expect(save("code", "Qwen3.8-27B")).resolves.toEqual({
			outcome: "saved",
			settingsPath,
			key: "models.Qwen3.8-27B.modes",
		})

		const file = readFile()
		expect(file).toEqual({
			...ownerFile,
			models: { ...ownerFile.models, "Qwen3.8-27B": { ...ownerFile.models["Qwen3.8-27B"], modes: ["code"] } },
		})
		expect(Object.keys(file)).toEqual(Object.keys(ownerFile))
		expect(Object.keys(file.models)).toEqual(Object.keys(ownerFile.models))
		// safeWriteJson indents with tabs.
		expect(fs.readFileSync(settingsPath, "utf-8")).toContain('\n\t"provider": "openai"')
	})

	it.skipIf(process.platform === "win32")("keeps the file readable only by its owner (chmod 600)", async () => {
		writeOwnerFile()

		await save("code", "Qwen3.8-27B")

		expect(fs.statSync(settingsPath).mode & 0o777).toBe(0o600)
	})

	it("reads the file again right before writing, keeping an edit made during the session", async () => {
		writeOwnerFile()
		await save("code", "Qwen3.8-27B")

		// The owner edits the file while the session runs.
		const edited = readFile()
		edited.models["Qwen3.5-4B"].contextWindow = 32768
		edited.timeZone = "Europe/Warsaw"
		fs.writeFileSync(settingsPath, JSON.stringify(edited, null, 2))

		await save("debug", "Qwen3.5-4B")

		const file = readFile()
		expect(file.timeZone).toBe("Europe/Warsaw")
		expect(file.models["Qwen3.5-4B"]).toMatchObject({ contextWindow: 32768, modes: ["debug"] })
		expect(file.models["Qwen3.8-27B"].modes).toEqual(["code"])
	})

	it("moves the mode on a later choice", async () => {
		writeOwnerFile()
		await save("code", "Qwen3.8-27B")

		await save("code", "GLM-5.3-NVFP4")

		const file = readFile()
		expect(file.models["Qwen3.8-27B"]).toEqual(ownerFile.models["Qwen3.8-27B"])
		expect(file.models["GLM-5.3-NVFP4"].modes).toEqual(["code"])
	})

	it("does not write a file that already says so", async () => {
		fs.writeFileSync(settingsPath, '{ "models": { "Q": { "modes": ["code"] } } }')
		const before = fs.readFileSync(settingsPath, "utf-8")

		await expect(save("code", "Q")).resolves.toMatchObject({ outcome: "saved", key: "models.Q.modes" })

		expect(fs.readFileSync(settingsPath, "utf-8")).toBe(before)
	})

	it("creates a missing file with only the choice", async () => {
		await save("code", "Qwen3.8-27B")

		expect(readFile()).toEqual({ models: { "Qwen3.8-27B": { modes: ["code"] } } })
	})

	it("reports a file it cannot read as a failed save and leaves it as it was", async () => {
		fs.writeFileSync(settingsPath, '{ "model": ')

		const result = await save("code", "Q")

		expect(result).toMatchObject({ outcome: "failed", settingsPath })
		expect(fs.readFileSync(settingsPath, "utf-8")).toBe('{ "model": ')
	})

	it("saves nothing for a run with provider flags", async () => {
		const sessionOnly = createModelChoiceSaver({ providerFlags: true, ephemeral: false })

		await expect(sessionOnly("code", "Q")).resolves.toEqual({
			outcome: "session-only",
			reason: "this run was started with --provider, --model, --base-url or --api-key, which set one model for every mode",
		})
		expect(fs.existsSync(settingsPath)).toBe(false)
	})

	it("saves nothing for an --ephemeral run", async () => {
		const sessionOnly = createModelChoiceSaver({ providerFlags: false, ephemeral: true })

		await expect(sessionOnly("code", "Q")).resolves.toEqual({
			outcome: "session-only",
			reason: "an --ephemeral run saves nothing",
		})
		expect(fs.existsSync(settingsPath)).toBe(false)
	})
})
