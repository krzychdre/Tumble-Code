// Characterization of the create-mode dialog and the import/export flow of ModesView,
// pinned before they move out into CreateModeDialog and useModeImportExport (WEB-9).

import { act, fireEvent, render, screen, waitFor } from "@/utils/test-utils"

import { TOOL_GROUPS } from "@roo-code/types"
import type { ToolGroup } from "@roo-code/types"

import ModesView from "../ModesView"
import { ExtensionStateContext } from "@src/context/ExtensionStateContext"
import { vscode } from "@src/utils/vscode"

vi.mock("@src/utils/vscode", () => ({
	vscode: { postMessage: vi.fn() },
}))

vi.mock("react-i18next", () => ({
	Trans: ({ i18nKey, children }: any) => <span data-i18n={i18nKey}>{children}</span>,
	useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
	initReactI18next: { type: "3rdParty", init: () => {} },
}))

// The toolkit's web components do not behave in jsdom; native stand-ins keep the
// product's event handling (it reads `target.value` / `target.checked`).
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeTextArea: ({ value, onChange, resize: _resize, ...props }: any) => (
		<textarea value={value ?? ""} onChange={onChange} {...props} />
	),
	VSCodeTextField: ({ value, onChange, ...props }: any) => (
		<input type="text" value={value ?? ""} onChange={onChange} {...props} />
	),
}))

const availableGroups = (Object.keys(TOOL_GROUPS) as ToolGroup[]).filter((group) => !TOOL_GROUPS[group].alwaysAvailable)

const baseState = {
	customModePrompts: {},
	listApiConfigMeta: [],
	mode: "code",
	customModes: [],
	currentApiConfigName: "",
	customInstructions: "",
	setCustomInstructions: vi.fn(),
	mcpServers: [{ name: "github" }, { name: "jira" }],
}

const renderModesView = (state: Record<string, unknown> = {}) =>
	render(
		<ExtensionStateContext.Provider value={{ ...baseState, ...state } as any}>
			<ModesView onSelectApiConfiguration={vi.fn()} />
		</ExtensionStateContext.Provider>,
	)

const postMessage = () => vi.mocked(vscode.postMessage)
const sent = (type: string) => postMessage().mock.calls.filter(([m]) => (m as any).type === type)
const hostMessage = (data: Record<string, unknown>) =>
	act(() => {
		window.dispatchEvent(new MessageEvent("message", { data }))
	})

// Create dialog helpers: fields are found through their label, like a user would.
const openCreateDialog = async () => {
	fireEvent.click(screen.getByTestId("add-mode-button"))
	return (await screen.findByText("prompts:createModeDialog.title")).closest(".fixed") as HTMLElement
}
const field = (labelKey: string) =>
	screen.getByText(labelKey).parentElement!.querySelector("input, textarea") as HTMLInputElement
const type = (labelKey: string, value: string) => fireEvent.change(field(labelKey), { target: { value } })
const clickCreate = () =>
	fireEvent.click(screen.getByRole("button", { name: "prompts:createModeDialog.buttons.create" }))
const groupCheckbox = (group: string) =>
	screen.getByLabelText(`prompts:tools.toolNames.${group}`, { selector: "input" }) as HTMLInputElement

const NAME = "prompts:createModeDialog.name.label"
const SLUG = "prompts:createModeDialog.slug.label"
const ROLE = "prompts:createModeDialog.roleDefinition.label"
const DESCRIPTION = "prompts:createModeDialog.description.label"
const WHEN_TO_USE = "prompts:createModeDialog.whenToUse.label"
const CUSTOM_INSTRUCTIONS = "prompts:createModeDialog.customInstructions.label"

Element.prototype.scrollIntoView = vi.fn()

describe("ModesView create-mode dialog", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("validation", () => {
		it("rejects a blank role definition and keeps the dialog open", async () => {
			renderModesView()
			const dialog = await openCreateDialog()
			type(ROLE, "   ")

			clickCreate()

			expect(await screen.findByText("Role definition is required")).toBeInTheDocument()
			expect(sent("updateCustomMode")).toHaveLength(0)
			expect(sent("mode")).toHaveLength(0)
			expect(dialog).toBeInTheDocument()
		})

		it("reports an empty name and the empty slug it produces", async () => {
			renderModesView()
			await openCreateDialog()
			type(ROLE, "You review code.")
			type(NAME, "")

			clickCreate()

			expect(await screen.findByText("Name is required")).toBeInTheDocument()
			expect(screen.getByText("Slug must contain only letters numbers and dashes")).toBeInTheDocument()
			expect(sent("updateCustomMode")).toHaveLength(0)
		})

		it("reports a hand-typed slug with invalid characters, and nothing else", async () => {
			renderModesView()
			await openCreateDialog()
			type(ROLE, "You review code.")
			type(SLUG, "bad slug!")

			clickCreate()

			expect(await screen.findByText("Slug must contain only letters numbers and dashes")).toBeInTheDocument()
			expect(screen.queryByText("Name is required")).not.toBeInTheDocument()
			expect(screen.queryByText("Role definition is required")).not.toBeInTheDocument()
			expect(sent("updateCustomMode")).toHaveLength(0)
		})

		it("clears the errors of the previous attempt before validating again", async () => {
			renderModesView()
			await openCreateDialog()
			type(ROLE, "")
			type(SLUG, "bad slug!")
			clickCreate()
			expect(await screen.findByText("Role definition is required")).toBeInTheDocument()

			type(ROLE, "You review code.")
			clickCreate()

			await waitFor(() => expect(screen.queryByText("Role definition is required")).not.toBeInTheDocument())
			expect(screen.getByText("Slug must contain only letters numbers and dashes")).toBeInTheDocument()
		})
	})

	describe("updateCustomMode payload", () => {
		it("sends the defaults when only the role definition is filled in", async () => {
			renderModesView()
			await openCreateDialog()
			type(ROLE, "  You review code.  ")

			clickCreate()

			expect(sent("updateCustomMode")).toEqual([
				[
					{
						type: "updateCustomMode",
						slug: "new-custom-mode",
						modeConfig: {
							slug: "new-custom-mode",
							name: "New Custom Mode",
							description: undefined,
							roleDefinition: "You review code.",
							whenToUse: undefined,
							customInstructions: undefined,
							groups: availableGroups,
							source: "global",
							allowedMcpServers: undefined,
						},
					},
				],
			])
			expect(sent("mode")).toEqual([[{ type: "mode", text: "new-custom-mode" }]])
			await waitFor(() => expect(screen.queryByText("prompts:createModeDialog.title")).not.toBeInTheDocument())
		})

		it("sends every field the user set: trimmed texts, project source, groups and MCP servers", async () => {
			renderModesView()
			await openCreateDialog()
			type(NAME, "Code Reviewer!")
			expect(field(SLUG).value).toBe("code-reviewer")
			fireEvent.click(screen.getByDisplayValue("project"))
			type(ROLE, " You review code. ")
			type(DESCRIPTION, "  Reviews diffs  ")
			type(WHEN_TO_USE, "   ")
			type(CUSTOM_INSTRUCTIONS, " Be terse. ")
			fireEvent.click(groupCheckbox("edit"))
			fireEvent.click(screen.getByTestId("create-restrict-mcp-servers-toggle"))
			fireEvent.click(screen.getByTestId("create-mcp-server-checkbox-github"))

			clickCreate()

			expect(sent("updateCustomMode")).toEqual([
				[
					{
						type: "updateCustomMode",
						slug: "code-reviewer",
						modeConfig: {
							slug: "code-reviewer",
							name: "Code Reviewer!",
							description: "Reviews diffs",
							roleDefinition: "You review code.",
							whenToUse: undefined,
							customInstructions: "Be terse.",
							groups: availableGroups.filter((g) => g !== "edit"),
							source: "project",
							allowedMcpServers: ["github"],
						},
					},
				],
			])
			expect(sent("mode")).toEqual([[{ type: "mode", text: "code-reviewer" }]])
		})

		it("regenerates the slug from the name even after the slug was edited by hand", async () => {
			renderModesView()
			await openCreateDialog()
			type(SLUG, "my-own-slug")
			type(NAME, "Second Name")

			expect(field(SLUG).value).toBe("second-name")
		})

		it("offers the MCP server restriction only while the mcp group is checked", async () => {
			renderModesView()
			await openCreateDialog()
			expect(screen.getByTestId("create-restrict-mcp-servers-toggle")).toBeInTheDocument()

			fireEvent.click(groupCheckbox("mcp"))

			expect(screen.queryByTestId("create-restrict-mcp-servers-toggle")).not.toBeInTheDocument()
		})
	})
})

describe("ModesView import and export", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	const importButton = () => screen.getByRole("button", { name: "prompts:importMode.import" })

	it("imports at the chosen level, stays busy until the host answers, then closes the dialog", async () => {
		renderModesView()
		fireEvent.click(screen.getByTestId("import-mode-toolbar-button"))
		const globalRadio = screen.getByDisplayValue("global") as HTMLInputElement
		expect((screen.getByDisplayValue("project") as HTMLInputElement).checked).toBe(true)
		fireEvent.click(globalRadio)

		fireEvent.click(importButton())
		fireEvent.click(screen.getByRole("button", { name: "prompts:importMode.importing" }))

		expect(sent("importMode")).toEqual([[{ type: "importMode", source: "global" }]])
		expect(screen.getByTestId("import-mode-toolbar-button")).toBeDisabled()

		hostMessage({ type: "importModeResult", success: false, error: "cancelled" })

		await waitFor(() => expect(screen.queryByText("prompts:importMode.selectLevel")).not.toBeInTheDocument())
		expect(screen.getByTestId("import-mode-toolbar-button")).not.toBeDisabled()
	})

	it("reopens the import dialog at the project level after a cancel", async () => {
		renderModesView()
		fireEvent.click(screen.getByTestId("import-mode-toolbar-button"))
		fireEvent.click(screen.getByDisplayValue("global"))
		fireEvent.click(screen.getByRole("button", { name: "prompts:createModeDialog.buttons.cancel" }))

		fireEvent.click(screen.getByTestId("import-mode-toolbar-button"))

		expect((screen.getByDisplayValue("project") as HTMLInputElement).checked).toBe(true)
	})

	it("exports the selected mode once until the host reports the result", async () => {
		renderModesView({ mode: "architect" })
		const exportButton = screen.getByTestId("export-mode-toolbar-button")

		fireEvent.click(exportButton)
		fireEvent.click(exportButton)

		expect(sent("exportMode")).toEqual([[{ type: "exportMode", slug: "architect" }]])
		expect(exportButton).toBeDisabled()

		hostMessage({ type: "exportModeResult", success: true })

		await waitFor(() => expect(exportButton).not.toBeDisabled())
	})

	it("asks the host once whether the selected mode has rules to export", async () => {
		renderModesView({ mode: "architect" })

		hostMessage({ type: "checkRulesDirectoryResult", slug: "architect", hasContent: true })

		expect(sent("checkRulesDirectory")).toEqual([[{ type: "checkRulesDirectory", slug: "architect" }]])
	})
})
