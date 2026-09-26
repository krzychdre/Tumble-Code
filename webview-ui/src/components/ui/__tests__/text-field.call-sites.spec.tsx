// Since the last DEP-9 step the toolkit is no longer installed: these specs
// now run on the replacement components and keep pinning the behaviour the
// toolkit had (the toolkit-only branches in the helpers are unused).

// Characterization of the webview's VSCodeTextField call sites (refactor DEP-9:
// the deprecated toolkit text field is being replaced). The toolkit is NOT
// mocked. Its native <input> lives in the host's shadow root (the host also
// carries a hidden form proxy input), so the helpers reach the shadow input,
// or take the replacement's input.
//
// What is pinned: WHEN a call site hears about typing (`onInput` on every
// keystroke; `onChange` only on `change`, i.e. when the field is left or
// Enter is pressed after an edit; `onBlur` on leaving), the input type, the
// label passed as children, key handling and the FormattedTextField filter.

import React from "react"

import { act, fireEvent, render, screen, waitFor } from "@/utils/test-utils"

import type { ProviderSettings } from "@roo-code/types"

import { ApiKeyField } from "@src/components/settings/providers/shared"
import { QwenCode } from "@src/components/settings/providers/QwenCode"
import { CreateModeDialog } from "@src/components/modes/CreateModeDialog"
import ModesView from "@src/components/modes/ModesView"
import ApiConfigManager from "@src/components/settings/ApiConfigManager"
import { MaxCostInput } from "@src/components/settings/MaxCostInput"
import { ExtensionStateContext } from "@src/context/ExtensionStateContext"
import { vscode } from "@src/utils/vscode"

vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage: vi.fn() } }))

vi.mock("react-i18next", () => ({
	Trans: ({ i18nKey, children }: any) => <span data-i18n={i18nKey}>{children}</span>,
	useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
	initReactI18next: { type: "3rdParty", init: () => {} },
}))

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

/** The native input of a field: in the toolkit host's shadow root, or the element itself. */
const control = (el: Element) => (el.shadowRoot?.querySelector("input") ?? el) as HTMLInputElement

/** Every text field on the page, in document order (toolkit hosts or replacement inputs). */
const fields = () => [...document.querySelectorAll("vscode-text-field, input.ui-text-field-control")].map(control)

/** Types like a user whose caret stays in the field: sets the text and fires `input`. */
const type = (el: HTMLInputElement, text: string) =>
	act(() => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, text)
		el.dispatchEvent(new Event("input", { bubbles: true, composed: true }))
	})

/** Leaves the field after editing: the native `change` event, then `blur`. */
const leave = (el: HTMLInputElement) => {
	fireEvent.change(el)
	fireEvent.blur(el)
}

/** Waits until the toolkit has rendered its shadow input (immediate for the replacement). */
const ready = () => waitFor(() => expect(fields().every((f) => f.tagName === "INPUT")).toBe(true))

/** Text of the label shown above the input (the field's children), if any. */
const labelText = (input: HTMLInputElement) => {
	const host = input.getRootNode() instanceof ShadowRoot ? (input.getRootNode() as ShadowRoot).host : null
	if (host) return host.textContent?.replace(/\s+/g, " ").trim() || null
	const label = input.id ? document.querySelector(`label[for="${input.id}"]`) : null
	return label?.textContent?.replace(/\s+/g, " ").trim() || null
}

describe("VSCodeTextField call sites: provider forms", () => {
	it("ApiKeyField is a password field labelled by its child and reports every keystroke", async () => {
		const set = vi.fn()
		render(
			<ApiKeyField
				apiConfiguration={{ openAiApiKey: "sk-old" } as ProviderSettings}
				setApiConfigurationField={set}
				field="openAiApiKey"
				labelKey="settings:providers.apiKey"
				getKeyUrl="https://example.com/keys"
				getKeyLabelKey="settings:providers.getOpenAiApiKey"
			/>,
		)
		await ready()
		const [key] = fields()
		await waitFor(() => expect(key.value).toBe("sk-old"))

		expect(key.type).toBe("password")
		expect(key.placeholder).toBe("settings:placeholders.apiKey")
		expect(labelText(key)).toBe("settings:providers.apiKey")

		type(key, "sk-n")
		type(key, "sk-new")
		expect(set.mock.calls).toEqual([
			["openAiApiKey", "sk-n"],
			["openAiApiKey", "sk-new"],
		])
	})

	it("QwenCode: a text label, per-keystroke updates, and the default path restored when left empty", async () => {
		const set = vi.fn()
		render(<QwenCode apiConfiguration={{ qwenCodeOauthPath: "/x.json" }} setApiConfigurationField={set} />)
		await ready()
		const [path] = fields()
		await waitFor(() => expect(path.value).toBe("/x.json"))
		expect(labelText(path)).toBe("OAuth Credentials Path")

		type(path, "")
		expect(set).toHaveBeenLastCalledWith("qwenCodeOauthPath", "")
		leave(path)
		expect(set).toHaveBeenLastCalledWith("qwenCodeOauthPath", "~/.qwen/oauth_creds.json")
	})
})

describe("VSCodeTextField call sites: modes", () => {
	const baseState = {
		customModePrompts: {},
		listApiConfigMeta: [],
		mode: "code",
		customModes: [],
		currentApiConfigName: "",
		customInstructions: "",
		setCustomInstructions: vi.fn(),
		mcpServers: [],
	}

	beforeEach(() => vi.mocked(vscode.postMessage).mockClear())

	it("ModesView description: nothing is saved while typing, the trimmed text when the field is left", async () => {
		render(
			<ExtensionStateContext.Provider value={baseState as any}>
				<ModesView onSelectApiConfiguration={vi.fn()} />
			</ExtensionStateContext.Provider>,
		)
		const description = control(screen.getByTestId("code-description-textfield"))
		await waitFor(() => expect(description.value).not.toBe(""))

		type(description, "  Writes code.  ")
		const updates = () =>
			vi
				.mocked(vscode.postMessage)
				.mock.calls.map(([m]) => m as any)
				.filter((m) => m.type === "updatePrompt")
		expect(updates()).toEqual([])

		leave(description)
		expect(updates().at(-1)).toEqual({
			type: "updatePrompt",
			promptMode: "code",
			customPrompt: { description: "Writes code." },
		})
	})

	it("CreateModeDialog: the description is taken when the field is left", async () => {
		const onCreate = vi.fn()
		render(<CreateModeDialog modes={[]} mcpServers={[]} onCreate={onCreate} onClose={() => {}} />)
		await ready()
		const textarea = document.querySelector("textarea")!
		fireEvent.change(textarea, { target: { value: "You are a tester." } })
		const [description] = fields()
		expect(fields()).toHaveLength(1)

		fireEvent.change(
			screen.getByText("prompts:createModeDialog.name.label").parentElement!.querySelector("input")!,
			{ target: { value: "My Tester" } },
		)
		type(description, "Tests things")
		leave(description)
		fireEvent.click(screen.getByText("prompts:createModeDialog.buttons.create"))

		expect(onCreate).toHaveBeenCalledWith(
			expect.objectContaining({ name: "My Tester", slug: "my-tester", description: "Tests things" }),
		)
	})
})

describe("VSCodeTextField call site: ApiConfigManager rename", () => {
	it("Enter saves the typed name, Escape cancels", async () => {
		const onRenameConfig = vi.fn()
		render(
			<ApiConfigManager
				currentApiConfigName="default"
				listApiConfigMeta={[{ id: "1", name: "default" }]}
				onSelectConfig={vi.fn()}
				onDeleteConfig={vi.fn()}
				onRenameConfig={onRenameConfig}
				onUpsertConfig={vi.fn()}
			/>,
		)
		fireEvent.click(screen.getByTestId("rename-profile-button"))
		await ready()
		let [name] = fields()
		await waitFor(() => expect(name.value).toBe("default"))

		type(name, "work")
		fireEvent.keyDown(name, { key: "Enter" })
		expect(onRenameConfig).toHaveBeenCalledWith("default", "work")

		fireEvent.click(screen.getByTestId("rename-profile-button"))
		await ready()
		;[name] = fields()
		type(name, "other")
		fireEvent.keyDown(name, { key: "Escape" })
		expect(screen.queryByTestId("rename-form")).not.toBeInTheDocument()
		expect(onRenameConfig).toHaveBeenCalledTimes(1)
	})
})

describe("VSCodeTextField call site: FormattedTextField (MaxCostInput)", () => {
	it("filters the typed text, reports the parsed value and shows the formatted value after leaving", async () => {
		const onValueChange = vi.fn()
		const { rerender } = render(<MaxCostInput allowedMaxCost={undefined} onValueChange={onValueChange} />)
		await ready()
		const [cost] = fields()
		expect(cost.placeholder).toBe("settings:autoApprove.apiCostLimit.unlimited")

		type(cost, "1a2.5")
		await waitFor(() => expect(cost.value).toBe("12.5"))
		expect(onValueChange).toHaveBeenLastCalledWith(12.5)

		rerender(<MaxCostInput allowedMaxCost={12.5} onValueChange={onValueChange} />)
		leave(cost)
		await waitFor(() => expect(cost.value).toBe("12.5"))
		expect(screen.getByText("$")).toBeInTheDocument()
	})
})
