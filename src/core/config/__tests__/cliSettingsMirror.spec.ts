// cd src && ./node_modules/.bin/vitest run core/config/__tests__/cliSettingsMirror.spec.ts

import fs from "fs/promises"
import os from "os"
import path from "path"

import { buildVscodeSection, startCliSettingsMirror, writeVscodeSection } from "../cliSettingsMirror"
import type { ContextProxy } from "../ContextProxy"

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

describe("buildVscodeSection", () => {
	it("carries the engine settings the editor has set and leaves out approvals, profiles, terminal and view state", () => {
		const section = buildVscodeSection(
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
		)

		expect(section).toEqual({
			settings: {
				subtaskContextStopPercent: 75,
				autoCondenseContextPercent: 80,
				customInstructions: "Answer in Polish.",
			},
		})
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

	it("creates a file only its owner can read", async () => {
		await writeVscodeSection(file, { settings: { autoCondenseContextPercent: 80 } })

		expect(await read()).toEqual({ vscode: { settings: { autoCondenseContextPercent: 80 } } })
		if (process.platform !== "win32") {
			expect((await fs.stat(file)).mode & 0o777).toBe(0o600)
		}
	})

	it("replaces only the vscode section and leaves an unchanged file alone", async () => {
		await fs.writeFile(
			file,
			JSON.stringify({
				provider: "openai",
				model: "GLM",
				vscode: { settings: { autoCondenseContextPercent: 1 } },
			}),
		)

		await writeVscodeSection(file, { settings: { autoCondenseContextPercent: 80 } })
		expect(await read()).toEqual({
			provider: "openai",
			model: "GLM",
			vscode: { settings: { autoCondenseContextPercent: 80 } },
		})

		const { mtimeMs } = await fs.stat(file)
		await new Promise((resolve) => setTimeout(resolve, 20))
		await writeVscodeSection(file, { settings: { autoCondenseContextPercent: 80 } })
		expect((await fs.stat(file)).mtimeMs).toBe(mtimeMs)
	})

	it("writes now and again after a settings change", async () => {
		const proxy = proxyOf({ subtaskContextStopPercent: 85 })
		const mirror = startCliSettingsMirror(proxy as unknown as ContextProxy, file)

		try {
			await vi.waitFor(async () =>
				expect((await read()).vscode.settings).toEqual({ subtaskContextStopPercent: 85 }),
			)
			proxy.set("subtaskContextStopPercent", 90)
			await vi.waitFor(
				async () => expect((await read()).vscode.settings).toEqual({ subtaskContextStopPercent: 90 }),
				{
					timeout: 3000,
				},
			)
		} finally {
			mirror.dispose()
		}
	})
})
