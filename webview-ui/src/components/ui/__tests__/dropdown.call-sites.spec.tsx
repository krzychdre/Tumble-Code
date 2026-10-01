// The single-choice fields that used to be the toolkit-style dropdown and are
// now the shared Radix `Select`: the base URL / entrypoint choice of MiniMax,
// Moonshot and Z.ai (rendered by ProviderDescriptorForm), the embedding model
// of the codebase index (ModelDropdownField) and the image generation model
// (ImageGenerationSettings). The trigger is a combobox named by the field's
// label; the options exist only while the list is open.

import React, { useState } from "react"

import { fireEvent, render, screen, waitFor } from "@/utils/test-utils"

import type { ProviderSettings } from "@roo-code/types"

import { ProviderDescriptorForm } from "@src/components/settings/providers/ProviderDescriptorForm"
import { ModelDropdownField, type EmbedderFormContext } from "@src/components/code-index/EmbedderFormFields"
import { ImageGenerationSettings } from "@src/components/settings/ImageGenerationSettings"

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage: vi.fn() } }))

// While the list is open Radix hides the rest of the page from assistive tech, the trigger too.
const trigger = () => screen.getByRole("combobox", { hidden: true })
const text = (el: Element) => el.textContent?.replace(/\s+/g, " ").trim()
const options = () => screen.getAllByRole("option")
const optionTexts = () => options().map(text)
/** What the closed field shows. */
const selectedText = () => text(trigger())

/** Opens the list and returns the option texts, then closes it again with Escape. */
const listOptions = async () => {
	fireEvent.click(trigger())
	await waitFor(() => expect(trigger()).toHaveAttribute("aria-expanded", "true"))
	const texts = optionTexts()
	fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" })
	await waitFor(() => expect(trigger()).toHaveAttribute("aria-expanded", "false"))
	return texts
}

/** Opens the list with a click on the field and clicks the option named `name`. */
const choose = async (name: string) => {
	fireEvent.click(trigger())
	await waitFor(() => expect(trigger()).toHaveAttribute("aria-expanded", "true"))
	const option = options().find((o) => text(o) === name)
	expect(option).toBeDefined()
	fireEvent.click(option!)
	await waitFor(() => expect(trigger()).toHaveAttribute("aria-expanded", "false"))
}

describe("Select call sites: provider base URL", () => {
	it("MiniMax lists both hosts, shows the stored one and saves a choice once, without echoing prop changes", async () => {
		const set = vi.fn()
		const config: ProviderSettings = { minimaxBaseUrl: "https://api.minimaxi.com/v1" }
		const { rerender } = render(
			<ProviderDescriptorForm provider="minimax" apiConfiguration={config} setApiConfigurationField={set} />,
		)

		await waitFor(() => expect(selectedText()).toBe("api.minimaxi.com"))
		expect(await listOptions()).toEqual(["api.minimax.io", "api.minimaxi.com"])
		expect(trigger()).toHaveAccessibleName()

		await choose("api.minimax.io")
		expect(set.mock.calls.filter(([field]) => field === "minimaxBaseUrl")).toEqual([
			["minimaxBaseUrl", "https://api.minimax.io/v1"],
		])

		set.mockClear()
		rerender(
			<ProviderDescriptorForm
				provider="minimax"
				apiConfiguration={{ minimaxBaseUrl: "https://api.minimax.io/v1" }}
				setApiConfigurationField={set}
			/>,
		)
		await waitFor(() => expect(selectedText()).toBe("api.minimax.io"))
		rerender(
			<ProviderDescriptorForm
				provider="minimax"
				apiConfiguration={{ minimaxBaseUrl: "https://api.minimaxi.com/v1" }}
				setApiConfigurationField={set}
			/>,
		)
		await waitFor(() => expect(selectedText()).toBe("api.minimaxi.com"))
		expect(set).not.toHaveBeenCalled()
	})

	it("MiniMax without a stored base URL shows the first host and saves nothing", async () => {
		const set = vi.fn()
		render(<ProviderDescriptorForm provider="minimax" apiConfiguration={{}} setApiConfigurationField={set} />)

		await waitFor(() => expect(selectedText()).toBe("api.minimax.io"))
		expect(set).not.toHaveBeenCalled()
	})

	it("Moonshot saves the chosen host", async () => {
		const set = vi.fn()
		render(
			<ProviderDescriptorForm
				provider="moonshot"
				apiConfiguration={{ moonshotBaseUrl: "https://api.moonshot.ai/v1" }}
				setApiConfigurationField={set}
			/>,
		)

		await waitFor(() => expect(selectedText()).toBe("api.moonshot.ai"))
		await choose("api.moonshot.cn")
		expect(set).toHaveBeenCalledWith("moonshotBaseUrl", "https://api.moonshot.cn/v1")
	})

	it("Z.ai falls back to the international coding line and saves the chosen line id", async () => {
		const set = vi.fn()
		render(<ProviderDescriptorForm provider="zai" apiConfiguration={{}} setApiConfigurationField={set} />)

		await waitFor(() => expect(selectedText()).toMatch(/^International Coding/))
		const texts = await listOptions()
		expect(texts.length).toBeGreaterThan(1)
		expect(set).not.toHaveBeenCalled()

		const china = texts.find((text) => /^China Coding/.test(text ?? ""))!
		await choose(china)
		expect(set).toHaveBeenCalledWith("zaiApiLine", "china_coding")
	})

	it("two choices in a row save both hosts in turn", async () => {
		const saved: string[] = []
		const Harness = () => {
			const [config, setConfig] = useState<ProviderSettings>({ minimaxBaseUrl: "https://api.minimax.io/v1" })
			return (
				<ProviderDescriptorForm
					provider="minimax"
					apiConfiguration={config}
					setApiConfigurationField={(field, value) => {
						if (field === "minimaxBaseUrl") saved.push(value as string)
						setConfig((prev) => ({ ...prev, [field]: value }))
					}}
				/>
			)
		}
		render(<Harness />)

		await choose("api.minimaxi.com")
		await choose("api.minimax.io")

		await waitFor(() => expect(saved).toEqual(["https://api.minimaxi.com/v1", "https://api.minimax.io/v1"]))
		await waitFor(() => expect(selectedText()).toBe("api.minimax.io"))
	})
})

describe("Select call site: codebase index embedding model", () => {
	const context = (modelId: string, error?: string): EmbedderFormContext => ({
		settings: { codebaseIndexEmbedderModelId: modelId } as EmbedderFormContext["settings"],
		formErrors: error ? { codebaseIndexEmbedderModelId: error } : {},
		updateSetting: vi.fn(),
		models: [
			{ id: "text-embedding-3-small", profile: { dimension: 1536 } },
			{ id: "custom-model", profile: undefined },
		],
		openRouterEmbeddingProviders: undefined,
		t: ((key: string, options?: { dimension?: number }) =>
			options?.dimension ? `${key}:${options.dimension}` : key) as EmbedderFormContext["t"],
	})

	it("lists every model with its dimension and shows the placeholder for an empty or unknown id", async () => {
		const { unmount } = render(<ModelDropdownField context={context("")} />)

		await waitFor(() => expect(selectedText()).toBe("settings:codeIndex.selectModel"))
		expect(trigger()).toHaveAccessibleName("settings:codeIndex.modelLabel")
		expect(await listOptions()).toEqual([
			"text-embedding-3-small settings:codeIndex.modelDimensions:1536",
			"custom-model",
		])
		unmount()

		render(<ModelDropdownField context={context("retired-model")} />)
		expect(selectedText()).toBe("settings:codeIndex.selectModel")
	})

	it("saves the chosen model id and carries the call site's classes, incl. the error class", async () => {
		const ctx = context("text-embedding-3-small", "required")
		render(<ModelDropdownField context={ctx} />)

		await waitFor(() =>
			expect(selectedText()).toBe("text-embedding-3-small settings:codeIndex.modelDimensions:1536"),
		)
		expect(trigger()).toHaveClass("w-full", "border-[var(--vscode-inputValidation-errorBorder)]")
		expect(screen.getByText("required")).toBeInTheDocument()

		await choose("custom-model")
		expect(ctx.updateSetting).toHaveBeenCalledWith("codebaseIndexEmbedderModelId", "custom-model")
		expect(ctx.updateSetting).toHaveBeenCalledTimes(1)
	})
})

describe("Select call site: image generation model", () => {
	it("shows the stored model and saves another one", async () => {
		const setModel = vi.fn()
		render(
			<ImageGenerationSettings
				enabled
				onChange={() => {}}
				imageGenerationProvider="openrouter"
				openRouterImageApiKey="key"
				openRouterImageGenerationSelectedModel={undefined}
				setImageGenerationProvider={() => {}}
				setOpenRouterImageApiKey={() => {}}
				setImageGenerationSelectedModel={setModel}
			/>,
		)

		await waitFor(() => expect(selectedText()).toBeTruthy())
		const texts = await listOptions()
		expect(texts.length).toBeGreaterThan(1)
		expect(selectedText()).toBe(texts[0])
		expect(setModel).not.toHaveBeenCalled()

		await choose(texts[1]!)
		expect(setModel).toHaveBeenCalledTimes(1)
		expect(setModel.mock.calls[0][0]).toEqual(expect.any(String))
		expect(setModel.mock.calls[0][0]).not.toBe("")
	})
})
