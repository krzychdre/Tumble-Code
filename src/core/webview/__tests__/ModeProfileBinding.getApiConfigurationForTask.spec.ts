// npx vitest run core/webview/__tests__/ModeProfileBinding.getApiConfigurationForTask.spec.ts
//
// The profile a task saved in history runs on, resolved without touching the
// panel's profile: used to resume a parent off screen after its child
// completed off screen.

import type { ProviderSettings } from "@tumble-code/types"

import { ModeProfileBinding, type ModeProfileBindingHost } from "../ModeProfileBinding"

const own: ProviderSettings = { apiProvider: "openai", openAiModelId: "glm-5.3" }

function makeBinding(profiles: Record<string, ProviderSettings> = { own }) {
	const host = {
		providerSettingsManager: {
			getProfile: vi.fn(async ({ name }: { name: string }) => {
				if (!profiles[name]) {
					throw new Error(`Config with name '${name}' not found`)
				}
				return { name, id: `id-${name}`, ...profiles[name] }
			}),
			activateProfile: vi.fn(),
		},
	} as unknown as ModeProfileBindingHost
	const binding = new ModeProfileBinding(host)
	const forMode = vi
		.spyOn(binding, "getApiConfigurationForMode")
		.mockResolvedValue({ apiConfiguration: { apiProvider: "anthropic" }, name: "mode-profile" })
	return { binding, host, forMode }
}

describe("ModeProfileBinding.getApiConfigurationForTask", () => {
	it("uses the task's own profile by name, without activating it", async () => {
		const { binding, host, forMode } = makeBinding()

		await expect(binding.getApiConfigurationForTask({ mode: "code", apiConfigName: "own" })).resolves.toEqual({
			apiConfiguration: { id: "id-own", ...own },
			name: "own",
		})
		expect(forMode).not.toHaveBeenCalled()
		expect(host.providerSettingsManager.activateProfile).not.toHaveBeenCalled()
	})

	it("falls back to the profile pinned to the task's mode when its own profile is gone", async () => {
		const { binding, forMode } = makeBinding({})

		await expect(binding.getApiConfigurationForTask({ mode: "code", apiConfigName: "deleted" })).resolves.toEqual({
			apiConfiguration: { apiProvider: "anthropic" },
			name: "mode-profile",
		})
		expect(forMode).toHaveBeenCalledWith("code")
	})

	it("returns undefined (use the current profile) with neither a profile nor a mode", async () => {
		const { binding } = makeBinding()

		await expect(binding.getApiConfigurationForTask({})).resolves.toBeUndefined()
	})
})
