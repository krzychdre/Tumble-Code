// Characterization of every form section of ModesView (roadmap item S5): which fields each
// section shows for built-in and custom modes, and the exact message each edit posts to the
// extension host. Written before ModesView was split into section components, so the split
// has to keep all of it.

import { act, fireEvent, render, screen, waitFor } from "@/utils/test-utils"

import ModesView from "../ModesView"
import { ExtensionStateContext } from "@src/context/ExtensionStateContext"
import { vscode } from "@src/utils/vscode"

vi.mock("@src/utils/vscode", () => ({
	vscode: { postMessage: vi.fn() },
}))

// `Trans` renders its `components` too, so the "load from file" links can be clicked.
vi.mock("react-i18next", () => ({
	Trans: ({ i18nKey, children, components }: any) => (
		<span data-i18n={i18nKey}>
			{children}
			{components &&
				Object.entries(components).map(([key, element]: [string, any]) => (
					<span key={key} data-component={key}>
						{element}
					</span>
				))}
		</span>
	),
	useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
	initReactI18next: { type: "3rdParty", init: () => {} },
}))

Element.prototype.scrollIntoView = vi.fn()

const customMode = {
	slug: "reviewer",
	name: "Reviewer",
	roleDefinition: "You review code.",
	description: "Reviews code",
	whenToUse: "When reviewing",
	customInstructions: "Be strict",
	groups: ["read"],
	source: "project" as const,
}

const baseState = {
	customModePrompts: {},
	listApiConfigMeta: [
		{ id: "config1", name: "Config 1" },
		{ id: "config2", name: "Config 2" },
	],
	mode: "code",
	customModes: [customMode],
	currentApiConfigName: "Config 1",
	customInstructions: "Global rules",
	setCustomInstructions: vi.fn(),
	mcpServers: [],
}

const view = (state: Record<string, unknown> = {}, onSelectApiConfiguration = vi.fn()) => (
	<ExtensionStateContext.Provider value={{ ...baseState, ...state } as any}>
		<ModesView onSelectApiConfiguration={onSelectApiConfiguration} />
	</ExtensionStateContext.Provider>
)

const renderView = (state: Record<string, unknown> = {}) => render(view(state))

const posted = () => vi.mocked(vscode.postMessage).mock.calls.map(([m]) => m as any)
const postedOfType = (type: string) => posted().filter((m) => m.type === type)

/** Fires the toolkit text area "change" event the way the existing ModesView specs do. */
const changeTextArea = (el: HTMLElement, value: string) =>
	fireEvent(el, new CustomEvent("change", { detail: { target: { value } } }))

/** The native input: inside the toolkit host's shadow root, or the element itself. */
const control = (el: Element) => (el.shadowRoot?.querySelector("input") ?? el) as HTMLInputElement

const setNativeValue = (el: HTMLInputElement, text: string) =>
	Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, text)

const changeTextField = (el: HTMLElement, value: string) => {
	const input = control(el)
	setNativeValue(input, value)
	fireEvent.change(input)
}

const typeInto = (el: HTMLElement, value: string) => {
	const input = control(el)
	act(() => {
		setNativeValue(input, value)
		input.dispatchEvent(new Event("input", { bubbles: true, composed: true }))
	})
}

const dispatchHostMessage = (data: Record<string, unknown>) =>
	act(() => {
		window.dispatchEvent(new MessageEvent("message", { data }))
	})

const selectMode = async (slug: string) => {
	fireEvent.click(screen.getByTestId("mode-select-trigger"))
	fireEvent.click(await screen.findByTestId(`mode-option-${slug}`))
}

describe("ModesView sections", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("header toolbar", () => {
		it("opens the config menu and posts the global and project mode file messages", () => {
			renderView()
			const menuButton = document.querySelector(".codicon-json")!.closest("button")!

			fireEvent.click(menuButton)
			fireEvent.mouseDown(screen.getByText("prompts:modes.editGlobalModes"))
			expect(posted()).toContainEqual({ type: "openCustomModesSettings" })
			expect(screen.queryByText("prompts:modes.editGlobalModes")).not.toBeInTheDocument()

			fireEvent.click(menuButton)
			fireEvent.mouseDown(screen.getByText("prompts:modes.editProjectModes"))
			expect(posted()).toContainEqual({
				type: "openFile",
				text: "./.roomodes",
				values: { create: true, content: JSON.stringify({ customModes: [] }, null, 2) },
			})
			expect(screen.queryByText("prompts:modes.editProjectModes")).not.toBeInTheDocument()
		})

		it("closes the config menu on a click anywhere in the document", () => {
			renderView()
			fireEvent.click(document.querySelector(".codicon-json")!.closest("button")!)
			expect(screen.getByText("prompts:modes.editGlobalModes")).toBeInTheDocument()

			fireEvent.click(document.body)
			expect(screen.queryByText("prompts:modes.editGlobalModes")).not.toBeInTheDocument()
		})

		it("asks the webview to open the marketplace on the mode tab", () => {
			const windowPost = vi.spyOn(window, "postMessage")
			renderView()
			fireEvent.click(document.querySelector(".codicon-extensions")!.closest("button")!)
			expect(windowPost).toHaveBeenCalledWith(
				{ type: "action", action: "marketplaceButtonClicked", values: { marketplaceTab: "mode" } },
				"*",
			)
			windowPost.mockRestore()
		})
	})

	describe("mode selector row", () => {
		it("disables rename and delete for a built-in mode and enables them for a custom mode", async () => {
			renderView()
			expect(screen.getByTestId("rename-mode-button")).toBeDisabled()
			expect(screen.getByTestId("delete-mode-button")).toBeDisabled()

			await selectMode("reviewer")
			expect(posted()).toContainEqual({ type: "mode", text: "reviewer" })
			expect(screen.getByTestId("rename-mode-button")).toBeEnabled()
			expect(screen.getByTestId("delete-mode-button")).toBeEnabled()
		})

		it("renames a custom mode, shows the new name at once and posts updateCustomMode", async () => {
			renderView({ mode: "reviewer" })
			fireEvent.click(screen.getByTestId("rename-mode-button"))
			const input = document.querySelector(
				'[placeholder="prompts:createModeDialog.name.placeholder"]',
			) as HTMLElement
			expect(control(input).value).toBe("Reviewer")

			typeInto(input, "  Strict Reviewer  ")
			fireEvent.click(screen.getByTestId("save-mode-rename-button"))

			expect(postedOfType("updateCustomMode")).toEqual([
				{
					type: "updateCustomMode",
					slug: "reviewer",
					modeConfig: { ...customMode, name: "Strict Reviewer", source: "project" },
				},
			])
			expect(screen.getByTestId("mode-select-trigger")).toHaveTextContent("Strict Reviewer")
		})

		it("keeps the rename field open and posts nothing when the name is taken by another mode", () => {
			renderView({ mode: "reviewer" })
			fireEvent.click(screen.getByTestId("rename-mode-button"))
			const input = document.querySelector(
				'[placeholder="prompts:createModeDialog.name.placeholder"]',
			) as HTMLElement

			typeInto(input, "💻 code")
			fireEvent.click(screen.getByTestId("save-mode-rename-button"))

			expect(postedOfType("updateCustomMode")).toHaveLength(0)
			expect(screen.getByTestId("save-mode-rename-button")).toBeInTheDocument()
		})

		it("cancels a rename without posting anything", () => {
			renderView({ mode: "reviewer" })
			fireEvent.click(screen.getByTestId("rename-mode-button"))
			fireEvent.click(screen.getByTestId("cancel-mode-rename-button"))

			expect(postedOfType("updateCustomMode")).toHaveLength(0)
			expect(screen.getByTestId("mode-select-trigger")).toHaveTextContent("Reviewer")
		})

		it("deletes a custom mode: check first, confirm after the host answers", async () => {
			renderView({ mode: "reviewer" })
			fireEvent.click(screen.getByTestId("delete-mode-button"))
			expect(posted()).toContainEqual({ type: "deleteCustomMode", slug: "reviewer", checkOnly: true })
			expect(screen.queryByText("prompts:deleteMode.title")).not.toBeInTheDocument()

			// An answer for another slug is ignored.
			dispatchHostMessage({ type: "deleteCustomModeCheck", slug: "other" })
			expect(screen.queryByText("prompts:deleteMode.title")).not.toBeInTheDocument()

			dispatchHostMessage({ type: "deleteCustomModeCheck", slug: "reviewer", rulesFolderPath: "/rules-reviewer" })
			expect(await screen.findByText("prompts:deleteMode.title")).toBeInTheDocument()

			fireEvent.click(screen.getByText("prompts:deleteMode.confirm"))
			expect(posted()).toContainEqual({ type: "deleteCustomMode", slug: "reviewer" })
		})

		it("exports the selected mode", () => {
			renderView({ mode: "reviewer" })
			fireEvent.click(screen.getByTestId("export-mode-toolbar-button"))
			expect(posted()).toContainEqual({ type: "exportMode", slug: "reviewer" })
		})

		it("follows a mode change pushed by the host", () => {
			const { rerender } = render(view({ mode: "code" }))
			expect(screen.getByTestId("mode-select-trigger")).toHaveTextContent("Code")

			rerender(view({ mode: "reviewer" }))
			expect(screen.getByTestId("mode-select-trigger")).toHaveTextContent("Reviewer")
			expect(screen.getByTestId("reviewer-prompt-textarea")).toBeInTheDocument()
		})
	})

	describe("API configuration", () => {
		it("shows the current profile and hands a picked profile to the owner", async () => {
			const onSelectApiConfiguration = vi.fn()
			render(view({}, onSelectApiConfiguration))
			const trigger = screen
				.getByText("prompts:apiConfiguration.title")
				.parentElement!.querySelector("button[role=combobox]") as HTMLElement
			expect(trigger).toHaveTextContent("Config 1")

			fireEvent.keyDown(trigger, { key: "Enter" })
			fireEvent.click(await screen.findByRole("option", { name: "Config 2" }))

			expect(onSelectApiConfiguration).toHaveBeenCalledWith("Config 2")
			// Picking a profile is left to the owner (SettingsView); nothing is posted from here.
			expect(postedOfType("loadApiConfiguration")).toHaveLength(0)
		})
	})

	describe("role definition, description and when-to-use", () => {
		it("built-in mode: shows the reset buttons and posts updatePrompt with only the edited field", () => {
			renderView({ customModePrompts: { code: { customInstructions: "keep" } } })
			expect(screen.getByTestId("role-definition-reset")).toBeInTheDocument()
			expect(screen.getByTestId("description-reset")).toBeInTheDocument()
			expect(screen.getByTestId("when-to-use-reset")).toBeInTheDocument()
			expect(screen.getByTestId("custom-instructions-reset")).toBeInTheDocument()

			changeTextField(screen.getByTestId("code-description-textfield"), "  Short text  ")
			changeTextArea(screen.getByTestId("code-when-to-use-textarea"), "Use for code")
			changeTextArea(screen.getByTestId("code-prompt-textarea"), "")

			expect(postedOfType("updatePrompt")).toEqual([
				{
					type: "updatePrompt",
					promptMode: "code",
					customPrompt: { customInstructions: "keep", description: "Short text" },
				},
				{
					type: "updatePrompt",
					promptMode: "code",
					customPrompt: { customInstructions: "keep", whenToUse: "Use for code" },
				},
				{
					type: "updatePrompt",
					promptMode: "code",
					customPrompt: { customInstructions: "keep", roleDefinition: undefined },
				},
			])
		})

		it("built-in mode: the reset buttons remove exactly one field from the stored prompt", () => {
			const stored = {
				roleDefinition: "r",
				description: "d",
				whenToUse: "w",
				customInstructions: "c",
			}
			renderView({ customModePrompts: { code: stored } })

			fireEvent.click(screen.getByTestId("description-reset"))
			fireEvent.click(screen.getByTestId("when-to-use-reset"))
			fireEvent.click(screen.getByTestId("custom-instructions-reset"))

			const without = (key: string) => {
				const copy: Record<string, string> = { ...stored }
				delete copy[key]
				return copy
			}
			expect(postedOfType("updatePrompt")).toEqual([
				{ type: "updatePrompt", promptMode: "code", customPrompt: without("description") },
				{ type: "updatePrompt", promptMode: "code", customPrompt: without("whenToUse") },
				{ type: "updatePrompt", promptMode: "code", customPrompt: without("customInstructions") },
			])
		})

		it("built-in mode: shows the stored override, then the built-in default", () => {
			const { rerender } = render(view({ customModePrompts: { code: { roleDefinition: "Overridden role" } } }))
			expect((screen.getByTestId("code-prompt-textarea") as any).value).toBe("Overridden role")

			rerender(view({ customModePrompts: {} }))
			expect((screen.getByTestId("code-prompt-textarea") as any).value).not.toBe("Overridden role")
			expect((screen.getByTestId("code-prompt-textarea") as any).value.length).toBeGreaterThan(0)
		})

		it("custom mode: hides the reset buttons and posts updateCustomMode with the whole config", () => {
			renderView({ mode: "reviewer" })
			expect(screen.queryByTestId("role-definition-reset")).not.toBeInTheDocument()
			expect(screen.queryByTestId("description-reset")).not.toBeInTheDocument()
			expect(screen.queryByTestId("when-to-use-reset")).not.toBeInTheDocument()
			expect(screen.queryByTestId("custom-instructions-reset")).not.toBeInTheDocument()

			expect((screen.getByTestId("reviewer-prompt-textarea") as any).value).toBe("You review code.")
			expect(control(screen.getByTestId("reviewer-description-textfield")).value).toBe("Reviews code")
			expect((screen.getByTestId("reviewer-when-to-use-textarea") as any).value).toBe("When reviewing")

			changeTextArea(screen.getByTestId("reviewer-prompt-textarea"), "   ")
			changeTextField(screen.getByTestId("reviewer-description-textfield"), "")
			changeTextArea(screen.getByTestId("reviewer-when-to-use-textarea"), " Always ")

			expect(postedOfType("updateCustomMode").map((m) => [m.slug, m.modeConfig])).toEqual([
				["reviewer", { ...customMode, roleDefinition: "" }],
				["reviewer", { ...customMode, description: undefined }],
				["reviewer", { ...customMode, whenToUse: "Always" }],
			])
		})

		it("custom mode without a source is saved as a global mode", () => {
			const { source: _source, ...withoutSource } = customMode
			renderView({ mode: "reviewer", customModes: [withoutSource] })

			changeTextArea(screen.getByTestId("reviewer-when-to-use-textarea"), "x")
			expect(postedOfType("updateCustomMode")[0].modeConfig).toEqual({
				...withoutSource,
				whenToUse: "x",
				source: "global",
			})
		})
	})

	describe("tools", () => {
		it("built-in mode: lists the enabled groups read-only with the edit restriction text", () => {
			renderView({ mode: "architect" })
			expect(screen.getByText("prompts:tools.builtInModesText")).toBeInTheDocument()
			expect(
				screen.getByText(
					"prompts:tools.toolNames.read, prompts:tools.toolNames.edit (Markdown files only), prompts:tools.toolNames.mcp, prompts:tools.toolNames.web",
				),
			).toBeInTheDocument()
			expect(document.querySelector(".codicon-edit.codicon")?.closest("button")).not.toBeNull()
			// No tools edit toggle for built-in modes (the only edit icon is the disabled rename button).
			expect(document.querySelectorAll(".codicon-edit")).toHaveLength(1)
		})

		it("built-in mode with the mcp group: saves the server allowlist through updatePrompt", () => {
			renderView({ mode: "code", mcpServers: [{ name: "github", status: "connected" }] })
			expect(screen.getByTestId("mcp-server-restriction")).toBeInTheDocument()
		})

		it("custom mode without tools shows the translated none text", () => {
			renderView({ mode: "reviewer", customModes: [{ ...customMode, groups: [] }] })
			expect(screen.getByText("prompts:tools.noTools")).toBeInTheDocument()
			expect(screen.queryByText("prompts:tools.builtInModesText")).not.toBeInTheDocument()
		})

		it("custom mode: edit toggle shows checkboxes, ticking a group posts the new groups", () => {
			renderView({ mode: "reviewer" })
			const toggle = document.querySelectorAll(".codicon-edit")[1].closest("button")!
			fireEvent.click(toggle)

			const commandLabel = screen.getByText("prompts:tools.toolNames.command")
			const checkbox = commandLabel.closest("label")!.querySelector("input[type=checkbox]") as HTMLInputElement
			fireEvent.click(checkbox)

			expect(postedOfType("updateCustomMode").map((m) => m.modeConfig.groups)).toEqual([["read", "command"]])

			const readCheckbox = screen
				.getByText("prompts:tools.toolNames.read")
				.closest("label")!
				.querySelector("input[type=checkbox]") as HTMLInputElement
			expect(readCheckbox.checked).toBe(true)
			fireEvent.click(readCheckbox)
			expect(postedOfType("updateCustomMode").at(-1).modeConfig.groups).toEqual([])
		})

		it("custom mode with mcp enabled shows the server restriction only while editing tools", () => {
			renderView({ mode: "reviewer", customModes: [{ ...customMode, groups: ["read", "mcp"] }] })
			expect(screen.queryByTestId("mcp-server-restriction")).not.toBeInTheDocument()

			fireEvent.click(document.querySelectorAll(".codicon-edit")[1].closest("button")!)
			expect(screen.getByTestId("mcp-server-restriction")).toBeInTheDocument()
		})

		it("switching to another mode leaves the tools edit mode", async () => {
			renderView({
				mode: "reviewer",
				customModes: [customMode, { ...customMode, slug: "other", name: "Other", source: "global" }],
			})
			fireEvent.click(document.querySelectorAll(".codicon-edit")[1].closest("button")!)
			expect(document.querySelector(".codicon-check")).not.toBeNull()

			await selectMode("other")
			expect(screen.getByTestId("other-prompt-textarea")).toBeInTheDocument()
			expect(document.querySelector(".codicon-check")).toBeNull()
		})
	})

	describe("mode-specific custom instructions", () => {
		it("built-in mode: posts the trimmed text through updatePrompt", () => {
			renderView({ customModePrompts: { code: { description: "keep" } } })
			changeTextArea(screen.getByTestId("code-custom-instructions-textarea"), "  Rules  ")
			changeTextArea(screen.getByTestId("code-custom-instructions-textarea"), "   ")

			expect(postedOfType("updatePrompt").map((m) => m.customPrompt)).toEqual([
				{ description: "keep", customInstructions: "Rules" },
				{ description: "keep", customInstructions: undefined },
			])
		})

		it("custom mode: posts the raw text, keeping whitespace and the empty string", () => {
			renderView({ mode: "reviewer" })
			expect((screen.getByTestId("reviewer-custom-instructions-textarea") as any).value).toBe("Be strict")

			changeTextArea(screen.getByTestId("reviewer-custom-instructions-textarea"), "  Rules  ")
			changeTextArea(screen.getByTestId("reviewer-custom-instructions-textarea"), "")

			expect(postedOfType("updateCustomMode").map((m) => m.modeConfig.customInstructions)).toEqual([
				"  Rules  ",
				"",
			])
		})

		it("the load-from-file link opens the mode's rules file", () => {
			renderView({ mode: "reviewer" })
			const link = document.querySelector(
				'[data-i18n="prompts:customInstructions.loadFromFile"] [data-component="span"] span',
			) as HTMLElement
			fireEvent.click(link)
			expect(posted()).toContainEqual({
				type: "openFile",
				text: "./.roo/rules-reviewer/rules.md",
				values: { create: true, content: "" },
			})
		})
	})

	describe("system prompt", () => {
		it("preview asks the host and shows its answer in a closable dialog", async () => {
			renderView({ mode: "reviewer" })
			fireEvent.click(screen.getByTestId("preview-prompt-button"))
			expect(posted()).toContainEqual({ type: "getSystemPrompt", mode: "reviewer" })

			// An empty answer does not open the dialog.
			dispatchHostMessage({ type: "systemPrompt", text: "", mode: "reviewer" })
			expect(screen.queryByText("System Prompt (reviewer mode)")).not.toBeInTheDocument()

			dispatchHostMessage({ type: "systemPrompt", text: "You are Tumble.", mode: "reviewer" })
			expect(await screen.findByText("System Prompt (reviewer mode)")).toBeInTheDocument()
			expect(screen.getByText("You are Tumble.")).toBeInTheDocument()

			fireEvent.click(screen.getByText("prompts:createModeDialog.close"))
			await waitFor(() => expect(screen.queryByText("You are Tumble.")).not.toBeInTheDocument())
		})

		it("copy asks the host to copy the current mode's prompt", () => {
			renderView()
			fireEvent.click(screen.getByTestId("copy-prompt-button"))
			expect(posted()).toContainEqual({ type: "copySystemPrompt", mode: "code" })
		})
	})

	describe("global custom instructions", () => {
		it("shows the stored text and posts every edit, keeping the empty string", () => {
			const setCustomInstructions = vi.fn()
			renderView({ setCustomInstructions })
			const textarea = screen.getByTestId("global-custom-instructions-textarea") as any
			expect(textarea.value).toBe("Global rules")

			changeTextArea(textarea, " New rules ")
			expect(setCustomInstructions).toHaveBeenCalledWith(" New rules ")
			expect(posted()).toContainEqual({ type: "customInstructions", text: " New rules " })
		})

		it("the load-from-file link opens the workspace rules file", () => {
			renderView()
			const link = document.querySelector(
				'[data-i18n="prompts:globalCustomInstructions.loadFromFile"] [data-component="span"] span',
			) as HTMLElement
			fireEvent.click(link)
			expect(posted()).toContainEqual({
				type: "openFile",
				text: "./.roo/rules/rules.md",
				values: { create: true, content: "" },
			})
		})
	})
})
