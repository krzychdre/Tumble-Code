// Characterization of the webview's VSCodeDropdown / VSCodeOption call sites
// (refactor DEP-9: the deprecated toolkit dropdown is being replaced). The
// toolkit is NOT mocked: its host has role="combobox" and its options are
// light-DOM elements with role="option" and aria-selected, so the assertions
// go through those roles and hold for the replacement too. Call sites: the
// base URL / entrypoint choice of MiniMax, Moonshot and Z.ai, the embedding
// model of the codebase index (ModelDropdownField) and the image generation
// model (ImageGenerationSettings). The toolkit also puts a hidden native
// <select> (its form proxy) into the host, so options are found through their
// explicit role attribute rather than getAllByRole.

import React, { useState } from "react"

import { fireEvent, render, screen, waitFor } from "@/utils/test-utils"

import type { ProviderSettings } from "@roo-code/types"

import { MiniMax } from "@src/components/settings/providers/MiniMax"
import { Moonshot } from "@src/components/settings/providers/Moonshot"
import { ZAi } from "@src/components/settings/providers/ZAi"
import { ModelDropdownField, type EmbedderFormContext } from "@src/components/code-index/EmbedderFormFields"
import { ImageGenerationSettings } from "@src/components/settings/ImageGenerationSettings"

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage: vi.fn() } }))

const text = (el: Element) => el.textContent?.replace(/\s+/g, " ").trim()
const options = () => [...document.querySelectorAll<HTMLElement>('[role="option"]')]
const optionTexts = () => options().map(text)
const selectedText = () => {
	const selected = options().find((o) => o.getAttribute("aria-selected") === "true")
	return selected && text(selected)
}

/** Opens the list with a click on the dropdown and clicks the option named `name`. */
const choose = async (name: string) => {
	fireEvent.click(screen.getByRole("combobox"))
	await waitFor(() => expect(screen.getByRole("combobox")).toHaveAttribute("aria-expanded", "true"))
	const option = options().find((o) => text(o) === name)
	expect(option).toBeDefined()
	fireEvent.click(option!)
	await waitFor(() => expect(screen.getByRole("combobox")).toHaveAttribute("aria-expanded", "false"))
}

describe("VSCodeDropdown call sites: provider base URL", () => {
	it("MiniMax lists both hosts, shows the stored one and saves a choice once, without echoing prop changes", async () => {
		const set = vi.fn()
		const config: ProviderSettings = { minimaxBaseUrl: "https://api.minimaxi.com/v1" }
		const { rerender } = render(<MiniMax apiConfiguration={config} setApiConfigurationField={set} />)

		await waitFor(() => expect(selectedText()).toBe("api.minimaxi.com"))
		expect(optionTexts()).toEqual(["api.minimax.io", "api.minimaxi.com"])
		expect(screen.getByRole("combobox")).toHaveAttribute("aria-haspopup", "listbox")

		await choose("api.minimax.io")
		expect(set.mock.calls.filter(([field]) => field === "minimaxBaseUrl")).toEqual([
			["minimaxBaseUrl", "https://api.minimax.io/v1"],
		])

		set.mockClear()
		rerender(
			<MiniMax
				apiConfiguration={{ minimaxBaseUrl: "https://api.minimax.io/v1" }}
				setApiConfigurationField={set}
			/>,
		)
		await waitFor(() => expect(selectedText()).toBe("api.minimax.io"))
		rerender(
			<MiniMax
				apiConfiguration={{ minimaxBaseUrl: "https://api.minimaxi.com/v1" }}
				setApiConfigurationField={set}
			/>,
		)
		await waitFor(() => expect(selectedText()).toBe("api.minimaxi.com"))
		expect(set).not.toHaveBeenCalled()
	})

	it("MiniMax without a stored base URL shows the first host and saves nothing", async () => {
		const set = vi.fn()
		render(<MiniMax apiConfiguration={{}} setApiConfigurationField={set} />)

		await waitFor(() => expect(selectedText()).toBe("api.minimax.io"))
		expect(set).not.toHaveBeenCalled()
	})

	it("Moonshot saves the chosen host", async () => {
		const set = vi.fn()
		render(
			<Moonshot
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
		render(<ZAi apiConfiguration={{}} setApiConfigurationField={set} />)

		await waitFor(() => expect(selectedText()).toMatch(/^International Coding/))
		expect(options().length).toBeGreaterThan(1)
		expect(set).not.toHaveBeenCalled()

		const china = optionTexts().find((text) => /^China Coding/.test(text ?? ""))!
		await choose(china)
		expect(set).toHaveBeenCalledWith("zaiApiLine", "china_coding")
	})

	it("ArrowDown on the closed dropdown saves the next host at once", async () => {
		const set = vi.fn()
		render(
			<MiniMax
				apiConfiguration={{ minimaxBaseUrl: "https://api.minimax.io/v1" }}
				setApiConfigurationField={set}
			/>,
		)
		await waitFor(() => expect(selectedText()).toBe("api.minimax.io"))

		fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" })

		await waitFor(() => expect(set).toHaveBeenCalledWith("minimaxBaseUrl", "https://api.minimaxi.com/v1"))
		expect(screen.getByRole("combobox")).toHaveAttribute("aria-expanded", "false")
	})

	it("a mouse choice followed by ArrowUp saves both hosts in turn", async () => {
		const saved: string[] = []
		const Harness = () => {
			const [config, setConfig] = useState<ProviderSettings>({ minimaxBaseUrl: "https://api.minimax.io/v1" })
			return (
				<MiniMax
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
		fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowUp" })

		await waitFor(() => expect(saved).toEqual(["https://api.minimaxi.com/v1", "https://api.minimax.io/v1"]))
		await waitFor(() => expect(selectedText()).toBe("api.minimax.io"))
	})
})

describe("VSCodeDropdown call site: codebase index embedding model", () => {
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

	it("lists a placeholder plus every model with its dimension, the placeholder selected for an empty id", async () => {
		render(<ModelDropdownField context={context("")} />)

		await waitFor(() => expect(selectedText()).toBe("settings:codeIndex.selectModel"))
		expect(optionTexts()).toEqual([
			"settings:codeIndex.selectModel",
			"text-embedding-3-small settings:codeIndex.modelDimensions:1536",
			"custom-model",
		])
	})

	it("saves the chosen model id and carries the call site's classes, incl. the error class", async () => {
		const ctx = context("text-embedding-3-small", "required")
		render(<ModelDropdownField context={ctx} />)

		await waitFor(() =>
			expect(selectedText()).toBe("text-embedding-3-small settings:codeIndex.modelDimensions:1536"),
		)
		expect(screen.getByRole("combobox")).toHaveClass("w-full", "border-red-500")
		expect(screen.getByText("required")).toBeInTheDocument()

		await choose("custom-model")
		expect(ctx.updateSetting).toHaveBeenCalledWith("codebaseIndexEmbedderModelId", "custom-model")
		expect(ctx.updateSetting).toHaveBeenCalledTimes(1)
	})
})

describe("VSCodeDropdown call site: image generation model", () => {
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
		const texts = optionTexts()
		expect(texts.length).toBeGreaterThan(1)
		expect(selectedText()).toBe(texts[0])
		expect(setModel).not.toHaveBeenCalled()

		await choose(texts[1]!)
		expect(setModel).toHaveBeenCalledTimes(1)
		expect(setModel.mock.calls[0][0]).toEqual(expect.any(String))
		expect(setModel.mock.calls[0][0]).not.toBe("")
	})
})
