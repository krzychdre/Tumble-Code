/**
 * Blurring an empty Qdrant URL field fills in the default URL. That default
 * must count as an unsaved change: the Save button has to become enabled so
 * the user can persist it.
 *
 * The component used to assign the default straight into the current settings
 * object before calling updateSetting. Right after the settings load, that
 * object is the same reference as the "initial settings" snapshot, so the
 * mutation changed the snapshot too and the change was invisible.
 */

import React from "react"

import { render, screen, fireEvent } from "@/utils/test-utils"
import { PopoverTrigger } from "@/components/ui"

import { CodeIndexPopover } from "../CodeIndexPopover"

vi.mock("react-i18next", () => ({
	Trans: ({ children }: any) => <>{children}</>,
	useTranslation: () => ({ t: (key: string) => key }),
	initReactI18next: { type: "3rdParty", init: () => {} },
}))

vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("@/utils/vscode", () => ({
	vscode: { postMessage: vi.fn() },
}))

vi.mock("@/components/ui/hooks/useOpenRouterModelProviders", () => ({
	useOpenRouterModelProviders: () => ({ data: undefined, isLoading: false }),
	OPENROUTER_DEFAULT_PROVIDER_NAME: "[default]",
}))

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeButton: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
	VSCodeLink: ({ children }: any) => <a>{children}</a>,
	VSCodeCheckbox: ({ checked, onChange, children }: any) => (
		<label>
			<input
				type="checkbox"
				checked={checked || false}
				onChange={(e: any) => onChange?.({ target: { checked: e.target.checked } })}
			/>
			{children}
		</label>
	),
	VSCodeTextField: ({ value, onInput, onBlur, placeholder }: any) => (
		<input
			type="text"
			value={value ?? ""}
			placeholder={placeholder}
			onChange={(e: any) => onInput?.({ target: { value: e.target.value } })}
			onBlur={(e: any) => onBlur?.({ target: { value: e.target.value } })}
		/>
	),
	VSCodeDropdown: ({ children }: any) => <select>{children}</select>,
	VSCodeOption: ({ children, value }: any) => <option value={value}>{children}</option>,
}))

const mockExtensionState = {
	codebaseIndexConfig: {
		codebaseIndexEnabled: true,
		codebaseIndexQdrantUrl: "",
		codebaseIndexEmbedderProvider: "openai",
		codebaseIndexEmbedderModelId: "text-embedding-3-small",
	},
	codebaseIndexModels: {},
	cwd: "/workspace",
	apiConfiguration: {},
}

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => mockExtensionState,
}))

const indexingStatus = {
	systemStatus: "Standby",
	message: "",
	processedItems: 0,
	totalItems: 0,
	currentItemUnit: "items",
}

describe("CodeIndexPopover Qdrant URL default on blur", () => {
	it("fills the default URL and enables Save when the empty field loses focus", () => {
		render(
			<CodeIndexPopover indexingStatus={indexingStatus}>
				<PopoverTrigger asChild>
					<button>open-popover</button>
				</PopoverTrigger>
			</CodeIndexPopover>,
		)

		fireEvent.click(screen.getByText("open-popover"))
		fireEvent.click(screen.getByText("settings:codeIndex.setupConfigLabel"))

		const saveButton = screen.getByText("settings:codeIndex.saveSettings").closest("button")!
		expect(saveButton).toBeDisabled()

		const qdrantField = screen.getByPlaceholderText("settings:codeIndex.qdrantUrlPlaceholder") as HTMLInputElement
		expect(qdrantField.value).toBe("")

		fireEvent.blur(qdrantField)

		expect(qdrantField.value).toBe("http://localhost:6333")
		expect(saveButton).toBeEnabled()
	})
})
