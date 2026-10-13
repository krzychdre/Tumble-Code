// npx vitest run core/webview/__tests__/ModeProfileBinding.findImageCapableModes.spec.ts
//
// Which modes run on a model that can see images: only modes whose own
// provider settings (a pinned profile, or a CLI per-mode entry) resolve,
// through the shared model resolver, to a model with supportsImages. The
// unsupported-image notice of read_file names exactly these modes.
//
// `vision` is a built-in mode; a user custom mode with the same slug overrides
// it (the owner kept one in the global custom_modes.yaml before it was built in).

import {
	openAiModelInfoSaneDefaults,
	type ModeConfig,
	type ProviderSettings,
	type ProviderSettingsEntry,
} from "@tumble-code/types"

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

const customVision: ModeConfig = { slug: "vision", name: "Vision", roleDefinition: "Eyes.", groups: ["read"] }
const designerMode: ModeConfig = { slug: "designer", name: "Designer", roleDefinition: "Draws.", groups: ["read"] }

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
	customModes = [],
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

	it("offers the built-in vision mode when its pinned profile supports images", async () => {
		const binding = makeBinding({ modeApiConfigs: { vision: "id-qwen" } })

		expect(await binding.findImageCapableModes()).toEqual([{ slug: "vision", modelId: "qwen3.6-35b" }])
	})

	it("does not offer the built-in vision mode while its pinned profile is text-only", async () => {
		const binding = makeBinding({ modeApiConfigs: { vision: "id-glm" } })

		expect(await binding.findImageCapableModes()).toEqual([])
	})

	it("does not offer the built-in vision mode while nothing is pinned to it", async () => {
		const binding = makeBinding({ modeApiConfigs: { code: "id-glm" } })

		expect(await binding.findImageCapableModes()).toEqual([])
	})

	it("lists vision once when a custom mode overrides the built-in one", async () => {
		const binding = makeBinding({ customModes: [customVision], modeApiConfigs: { vision: "id-qwen" } })

		expect(await binding.findImageCapableModes()).toEqual([{ slug: "vision", modelId: "qwen3.6-35b" }])
	})

	it("lists an image-capable custom mode after the built-in vision mode", async () => {
		const binding = makeBinding({
			customModes: [designerMode],
			modeApiConfigs: { vision: "id-qwen", designer: "id-qwen" },
		})

		expect(await binding.findImageCapableModes()).toEqual([
			{ slug: "vision", modelId: "qwen3.6-35b" },
			{ slug: "designer", modelId: "qwen3.6-35b" },
		])
	})

	it("ignores a pin left behind by a mode that no longer exists", async () => {
		const binding = makeBinding({ modeApiConfigs: { designer: "id-qwen" } })

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

	describe("with the settings the CLI builds from models.<id>.supportsImages", () => {
		// The shape apps/cli's toProviderSettings writes for the openai provider:
		// the sane defaults with the entry's keys on top, or null for an entry
		// that sets none of them.
		const cliModel = (id: string, info: ProviderSettings["openAiCustomModelInfo"]): ProviderSettings => ({
			apiProvider: "openai",
			openAiModelId: id,
			openAiBaseUrl: "http://x/v1",
			openAiCustomModelInfo: info,
		})
		const glm = cliModel("GLM-5.3-NVFP4", {
			...openAiModelInfoSaneDefaults,
			contextWindow: 262_144,
			supportsImages: false,
		})
		const qwen = cliModel("Qwen3.8-27B", {
			...openAiModelInfoSaneDefaults,
			contextWindow: 262_144,
			supportsImages: true,
		})

		it("lists only the mode bound to the model that sees images when the base is text-only", async () => {
			const binding = makeBinding()
			binding.setCliModeProviderSettings({ base: glm, modes: { vision: qwen, architect: glm } })

			expect(await binding.findImageCapableModes()).toEqual([{ slug: "vision", modelId: "Qwen3.8-27B" }])
		})

		it("lists every mode on the base when the base sees images, except a text-only one", async () => {
			const binding = makeBinding()
			binding.setCliModeProviderSettings({ base: qwen, modes: { code: glm } })

			const slugs = (await binding.findImageCapableModes()).map(({ slug }) => slug)
			expect(slugs).not.toContain("code")
			expect(slugs).toEqual(expect.arrayContaining(["architect", "ask", "debug", "vision"]))
		})

		it("counts a model without model info as seeing images (the openai sane defaults)", async () => {
			const binding = makeBinding()
			binding.setCliModeProviderSettings({ base: glm, modes: { vision: cliModel("unlisted", null) } })

			expect(await binding.findImageCapableModes()).toEqual([{ slug: "vision", modelId: "unlisted" }])
		})
	})
})
