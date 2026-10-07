// npx vitest run core/webview/__tests__/ModeProfileBinding.findImageCapableModes.spec.ts
//
// Which modes run on a model that can see images: only modes whose own
// provider settings (a pinned profile, or a CLI per-mode entry) resolve,
// through the shared model resolver, to a model with supportsImages. The
// unsupported-image notice of read_file names exactly these modes.

import type { ModeConfig, ProviderSettings, ProviderSettingsEntry } from "@tumble-code/types"

import { ModeProfileBinding, type ModeProfileBindingHost } from "../ModeProfileBinding"

const textOnly: ProviderSettings = {
	apiProvider: "openai",
	openAiModelId: "glm-5.3",
	openAiCustomModelInfo: { contextWindow: 200_000, supportsPromptCache: false, supportsImages: false },
}
const withImages: ProviderSettings = {
	apiProvider: "openai",
	openAiModelId: "qwen3.6-35b",
	openAiCustomModelInfo: { contextWindow: 128_000, supportsPromptCache: false, supportsImages: true },
}

const visionMode: ModeConfig = { slug: "vision", name: "Vision", roleDefinition: "Eyes.", groups: ["read"] }

interface Setup {
	profiles?: Record<string, ProviderSettings>
	modeApiConfigs?: Record<string, string>
	customModes?: ModeConfig[]
	locked?: boolean
	unreadable?: string[]
}

function makeBinding({
	profiles = { glm: textOnly, qwen: withImages },
	modeApiConfigs = {},
	customModes = [visionMode],
	locked = false,
	unreadable = [],
}: Setup = {}) {
	const entries: ProviderSettingsEntry[] = Object.keys(profiles).map((name) => ({ name, id: `id-${name}` }))
	const host = {
		isApiConfigLockedAcrossModes: () => locked,
		getCustomModes: async () => customModes,
		providerSettingsManager: {
			getModeConfigId: async (mode: string) => modeApiConfigs[mode],
			listConfig: async () => entries,
			getProfile: async (params: { name: string } | { id: string }) => {
				const name = "name" in params ? params.name : params.id.replace(/^id-/, "")
				if (unreadable.includes(name)) {
					throw new Error(`cannot read ${name}`)
				}
				return { name, id: `id-${name}`, ...profiles[name] }
			},
		},
	} as unknown as ModeProfileBindingHost
	return new ModeProfileBinding(host)
}

describe("ModeProfileBinding.findImageCapableModes", () => {
	it("lists only the modes pinned to a profile whose model supports images", async () => {
		const binding = makeBinding({
			// ask is unbound: it runs on the current (text-only) profile.
			modeApiConfigs: { code: "id-glm", vision: "id-qwen", architect: "id-deleted" },
		})

		expect(await binding.findImageCapableModes()).toEqual([{ slug: "vision", modelId: "qwen3.6-35b" }])
	})

	it("lists nothing when no image-capable profile is pinned (the incident setup)", async () => {
		const binding = makeBinding({ modeApiConfigs: { code: "id-glm", ask: "id-glm" } })

		expect(await binding.findImageCapableModes()).toEqual([])
	})

	it("ignores a pin left behind by a mode that no longer exists", async () => {
		const binding = makeBinding({ customModes: [], modeApiConfigs: { vision: "id-qwen" } })

		expect(await binding.findImageCapableModes()).toEqual([])
	})

	it("lists nothing while the workspace locks one profile across modes", async () => {
		const binding = makeBinding({ locked: true, modeApiConfigs: { vision: "id-qwen" } })

		expect(await binding.findImageCapableModes()).toEqual([])
	})

	it("skips a mode whose pinned profile cannot be read and keeps the others", async () => {
		const binding = makeBinding({
			profiles: { glm: textOnly, qwen: withImages, broken: withImages },
			modeApiConfigs: { code: "id-broken", vision: "id-qwen" },
			unreadable: ["broken"],
		})

		expect(await binding.findImageCapableModes()).toEqual([{ slug: "vision", modelId: "qwen3.6-35b" }])
	})

	it("skips a mode pinned to a profile of an unknown provider", async () => {
		const binding = makeBinding({
			profiles: { odd: { apiProvider: "no-such-provider" as ProviderSettings["apiProvider"] } },
			modeApiConfigs: { vision: "id-odd" },
		})

		expect(await binding.findImageCapableModes()).toEqual([])
	})

	it("uses the CLI's per-mode settings when present", async () => {
		const binding = makeBinding({ modeApiConfigs: { code: "id-qwen" } })
		binding.setCliModeProviderSettings({ base: textOnly, modes: { vision: withImages } })

		// The CLI settings replace the profile store: code falls back to the text-only base.
		expect(await binding.findImageCapableModes()).toEqual([{ slug: "vision", modelId: "qwen3.6-35b" }])
	})
})
