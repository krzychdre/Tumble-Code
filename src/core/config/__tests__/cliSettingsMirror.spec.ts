// cd src && ./node_modules/.bin/vitest run core/config/__tests__/cliSettingsMirror.spec.ts

import fs from "fs/promises"
import os from "os"
import path from "path"

import type { ExtensionContext } from "vscode"
import type { ProviderProfilesEnvelope } from "@tumble-code/types"

import { buildVscodeSection, startCliSettingsMirror, writeVscodeSection } from "../cliSettingsMirror"
import type { ContextProxy } from "../ContextProxy"
import { ProviderSettingsManager } from "../ProviderSettingsManager"

/** A proxy over plain values that tells its listeners about every set. */
function proxyOf(values: Record<string, unknown>) {
	const listeners = new Set<() => void>()
	return {
		getValue: (key: string) => values[key],
		set(key: string, value: unknown) {
			values[key] = value
			listeners.forEach((listener) => listener())
		},
		onDidChangeValues(listener: () => void) {
			listeners.add(listener)
			return { dispose: () => listeners.delete(listener) }
		},
	}
}

/** An extension context whose secret store lives in memory and reports its changes. */
function contextWithSecrets() {
	const values = new Map<string, string>()
	const listeners = new Set<() => void>()
	const changed = () => listeners.forEach((listener) => listener())
	return {
		secrets: {
			get: async (key: string) => values.get(key),
			store: async (key: string, value: string) => {
				values.set(key, value)
				changed()
			},
			delete: async (key: string) => {
				values.delete(key)
				changed()
			},
			onDidChange: (listener: () => void) => {
				listeners.add(listener)
				return { dispose: () => listeners.delete(listener) }
			},
		},
	} as unknown as ExtensionContext
}

/** A GLM profile on an OpenAI-compatible server, saved with its API key, bound to architect mode. */
async function savedGlmProfile(context: ExtensionContext) {
	const manager = new ProviderSettingsManager(context)
	const id = await manager.saveConfig("glm", {
		apiProvider: "openai",
		openAiBaseUrl: "http://192.168.50.194:11111/v1",
		openAiModelId: "GLM-5.3-NVFP4",
		openAiApiKey: "sk-secret-key",
	})
	await manager.setModeConfig("architect", id)
	return manager
}

const emptyProfiles = {
	schemaVersion: 2,
	data: { currentApiConfigName: "default", apiConfigs: {} },
} as ProviderProfilesEnvelope

describe("buildVscodeSection", () => {
	it("carries the engine settings the editor has set and leaves out approvals, profiles, terminal and view state", async () => {
		const { settings } = await buildVscodeSection(
			proxyOf({
				subtaskContextStopPercent: 75,
				autoCondenseContextPercent: 80,
				customInstructions: "Answer in Polish.",
				alwaysAllowWrite: true,
				allowedCommands: ["git"],
				currentApiConfigName: "glm",
				profileThresholds: { glm: 70 },
				terminalShellIntegrationDisabled: false,
				uiDensity: "compact",
				mode: "architect",
				customModes: [],
				codebaseIndexConfig: { codebaseIndexEnabled: true },
			}) as unknown as ContextProxy,
			{ export: async () => emptyProfiles },
		)

		expect(settings).toEqual({
			subtaskContextStopPercent: 75,
			autoCondenseContextPercent: 80,
			customInstructions: "Answer in Polish.",
		})
	})

	it("carries the provider profiles and their modes without the API keys", async () => {
		const manager = await savedGlmProfile(contextWithSecrets())

		const { profiles } = await buildVscodeSection(proxyOf({}) as unknown as ContextProxy, manager)

		const glm = profiles.data.apiConfigs.glm
		expect(glm).toMatchObject({ provider: { providerId: "openai", config: { openAiModelId: "GLM-5.3-NVFP4" } } })
		expect(profiles.data.modeApiConfigs?.architect).toBe(glm.id)
		expect(JSON.stringify(profiles)).not.toContain("sk-secret-key")
	})
})

describe("writeVscodeSection", () => {
	let dir: string
	let file: string

	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), "cli-settings-mirror-"))
		file = path.join(dir, "cli-settings.json")
	})

	afterEach(async () => {
		await fs.rm(dir, { recursive: true, force: true })
	})

	const read = async () => JSON.parse(await fs.readFile(file, "utf-8"))
	const section = (autoCondenseContextPercent: number) => ({
		settings: { autoCondenseContextPercent },
		profiles: emptyProfiles,
	})

	it("creates a file only its owner can read", async () => {
		await writeVscodeSection(file, section(80))

		expect(await read()).toEqual({ vscode: section(80) })
		if (process.platform !== "win32") {
			expect((await fs.stat(file)).mode & 0o777).toBe(0o600)
		}
	})

	it("replaces only the vscode section and leaves an unchanged file alone", async () => {
		await fs.writeFile(file, JSON.stringify({ provider: "openai", model: "GLM", vscode: section(1) }))

		await writeVscodeSection(file, section(80))
		expect(await read()).toEqual({ provider: "openai", model: "GLM", vscode: section(80) })

		const { mtimeMs } = await fs.stat(file)
		await new Promise((resolve) => setTimeout(resolve, 20))
		await writeVscodeSection(file, section(80))
		expect((await fs.stat(file)).mtimeMs).toBe(mtimeMs)
	})

	it("writes now, after a settings change and after a profile change", async () => {
		const context = contextWithSecrets()
		const proxy = proxyOf({ subtaskContextStopPercent: 85 })
		const mirror = startCliSettingsMirror(context, proxy as unknown as ContextProxy, file)

		try {
			await vi.waitFor(async () =>
				expect((await read()).vscode.settings).toEqual({ subtaskContextStopPercent: 85 }),
			)
			proxy.set("subtaskContextStopPercent", 90)
			await vi.waitFor(
				async () => expect((await read()).vscode.settings).toEqual({ subtaskContextStopPercent: 90 }),
				{ timeout: 3000 },
			)

			// Another panel's manager saves a profile, as ClineProvider does.
			await savedGlmProfile(context)
			await vi.waitFor(async () => expect((await read()).vscode.profiles.data.apiConfigs.glm).toBeDefined(), {
				timeout: 3000,
			})
			expect(await fs.readFile(file, "utf-8")).not.toContain("sk-secret-key")
		} finally {
			mirror.dispose()
		}
	})
})
