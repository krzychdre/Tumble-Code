import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { vi, describe, it, expect, beforeEach, afterEach, type MockInstance } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import React from "react"

import SettingsView from "../SettingsView"

// Mock vscode API
const mockPostMessage = vi.fn()
const mockVscode = {
	postMessage: mockPostMessage,
}
;(global as any).acquireVsCodeApi = () => mockVscode

// Mock the extension state context
vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: vi.fn(),
}))

// Mock the translation context
vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
	useTranslation: () => ({
		t: (key: string) => key,
	}),
}))

// Mock UI components
vi.mock("@src/components/ui", () => ({
	// The real checkbox (a native input), not a stub: only the barrel is mocked.
	LabeledCheckbox: (props: any) => <RealLabeledCheckbox {...props} />,
	Link: ({ children, ...props }: any) => <a {...props}>{children}</a>,
	ToggleSwitch: ({ checked, onChange, "aria-label": ariaLabel, "data-testid": dataTestId }: any) => (
		<button role="switch" aria-checked={checked} aria-label={ariaLabel} data-testid={dataTestId} onClick={onChange}>
			Toggle
		</button>
	),
	Input: ({ value, onChange, placeholder, id, type, className, ...props }: any) => (
		<input
			type={type || "text"}
			value={value}
			onChange={onChange}
			placeholder={placeholder}
			id={id}
			className={className}
			{...props}
		/>
	),
	Textarea: ({ value, onChange, placeholder, id, className, ...props }: any) => (
		<textarea
			value={value}
			onChange={onChange}
			placeholder={placeholder}
			id={id}
			className={className}
			{...props}
		/>
	),
	Checkbox: ({ checked, onCheckedChange, id, className, ...props }: any) => (
		<input
			type="checkbox"
			checked={checked}
			onChange={(e) => onCheckedChange?.(e.target.checked)}
			id={id}
			className={className}
			{...props}
		/>
	),
	AlertDialog: ({ open, children }: any) => (open ? <div data-testid="alert-dialog">{children}</div> : null),
	AlertDialogContent: ({ children }: any) => <div>{children}</div>,
	AlertDialogTitle: ({ children }: any) => <div>{children}</div>,
	AlertDialogDescription: ({ children }: any) => <div>{children}</div>,
	AlertDialogCancel: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
	AlertDialogAction: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
	AlertDialogHeader: ({ children }: any) => <div>{children}</div>,
	AlertDialogFooter: ({ children }: any) => <div>{children}</div>,
	Button: ({ children, onClick, disabled, ...props }: any) => (
		<button onClick={onClick} disabled={disabled} {...props}>
			{children}
		</button>
	),
	Tooltip: ({ children }: any) => <>{children}</>,
	TooltipContent: ({ children }: any) => <div>{children}</div>,
	TooltipProvider: ({ children }: any) => <>{children}</>,
	TooltipTrigger: ({ children }: any) => <>{children}</>,
	StandardTooltip: ({ children, content }: any) => <div title={content}>{children}</div>,
	Popover: ({ children }: any) => <>{children}</>,
	PopoverTrigger: ({ children }: any) => <>{children}</>,
	PopoverContent: ({ children }: any) => <div>{children}</div>,
	Select: ({ children, value, onValueChange }: any) => (
		<div data-testid="select" data-value={value}>
			<button onClick={() => onValueChange && onValueChange("test-change")}>{value}</button>
			{children}
		</div>
	),
	SelectContent: ({ children }: any) => <div data-testid="select-content">{children}</div>,
	SelectGroup: ({ children }: any) => <div data-testid="select-group">{children}</div>,
	SelectItem: ({ children, value }: any) => (
		<div data-testid={`select-item-${value}`} data-value={value}>
			{children}
		</div>
	),
	SelectTrigger: ({ children }: any) => <div data-testid="select-trigger">{children}</div>,
	SelectValue: ({ placeholder }: any) => <div data-testid="select-value">{placeholder}</div>,
	Slider: ({ value, onValueChange, "data-testid": dataTestId }: any) => (
		<input
			type="range"
			value={value?.[0] ?? 0}
			onChange={(e) => onValueChange?.([parseFloat(e.target.value)])}
			data-testid={dataTestId}
		/>
	),
	SearchableSelect: ({ value, onValueChange, options, placeholder }: any) => (
		<select value={value} onChange={(e) => onValueChange(e.target.value)} data-testid="searchable-select">
			{placeholder && <option value="">{placeholder}</option>}
			{options?.map((opt: any) => (
				<option key={opt.value} value={opt.value}>
					{opt.label}
				</option>
			))}
		</select>
	),
	Collapsible: ({ children, open }: any) => (
		<div className="collapsible-mock" data-open={open}>
			{children}
		</div>
	),
	CollapsibleTrigger: ({ children, className, onClick }: any) => (
		<div className={`collapsible-trigger-mock ${className || ""}`} onClick={onClick}>
			{children}
		</div>
	),
	CollapsibleContent: ({ children, className }: any) => (
		<div className={`collapsible-content-mock ${className || ""}`}>{children}</div>
	),
	Dialog: ({ children, ...props }: any) => (
		<div data-testid="dialog" {...props}>
			{children}
		</div>
	),
	DialogContent: ({ children, ...props }: any) => (
		<div data-testid="dialog-content" {...props}>
			{children}
		</div>
	),
	DialogHeader: ({ children, ...props }: any) => (
		<div data-testid="dialog-header" {...props}>
			{children}
		</div>
	),
	DialogTitle: ({ children, ...props }: any) => (
		<div data-testid="dialog-title" {...props}>
			{children}
		</div>
	),
	DialogDescription: ({ children, ...props }: any) => (
		<div data-testid="dialog-description" {...props}>
			{children}
		</div>
	),
	DialogFooter: ({ children, ...props }: any) => (
		<div data-testid="dialog-footer" {...props}>
			{children}
		</div>
	),
}))

// Mock ModesView and McpView since they're rendered during indexing
vi.mock("@src/components/modes/ModesView", () => ({
	default: ({ onSelectApiConfiguration }: { onSelectApiConfiguration?: (name: string) => void }) => (
		<button data-testid="modes-select-profile" onClick={() => onSelectApiConfiguration?.("other-profile")}>
			Select profile in Modes
		</button>
	),
}))

vi.mock("@src/components/mcp/McpView", () => ({
	default: () => null,
}))

// Mock Tab components
vi.mock("../common/Tab", () => ({
	Tab: ({ children }: any) => <div>{children}</div>,
	TabContent: React.forwardRef<HTMLDivElement, any>(({ children }, ref) => <div ref={ref}>{children}</div>),
	TabHeader: ({ children }: any) => <div>{children}</div>,
	TabList: ({ children }: any) => <div data-testid="settings-tab-list">{children}</div>,
	TabTrigger: React.forwardRef<HTMLButtonElement, any>(({ children, onClick }, ref) => (
		<button ref={ref} onClick={onClick}>
			{children}
		</button>
	)),
}))

// Mock child components that are complex
// Mock ApiConfigManager to not interact with props
vi.mock("../ApiConfigManager", () => ({
	default: vi.fn(() => <div data-testid="api-config-manager">ApiConfigManager</div>),
}))

vi.mock("../ApiOptions", () => ({
	default: vi.fn(() => <div data-testid="api-options">ApiOptions</div>),
}))

// Mock other settings components - ensure they don't interact with props
vi.mock("../AutoApproveSettings", () => ({
	AutoApproveSettings: vi.fn(() => <div>AutoApproveSettings</div>),
}))
vi.mock("../CheckpointSettings", () => ({
	CheckpointSettings: vi.fn(() => <div>CheckpointSettings</div>),
}))
vi.mock("../NotificationSettings", () => ({
	NotificationSettings: vi.fn(() => <div>NotificationSettings</div>),
}))
vi.mock("../ContextManagementSettings", () => ({
	ContextManagementSettings: vi.fn(() => <div>ContextManagementSettings</div>),
}))
vi.mock("../TerminalSettings", () => ({
	TerminalSettings: vi.fn(() => <div>TerminalSettings</div>),
}))
vi.mock("../ExperimentalSettings", () => ({
	ExperimentalSettings: vi.fn(() => <div>ExperimentalSettings</div>),
}))
vi.mock("../LanguageSettings", () => ({
	LanguageSettings: vi.fn(() => <div>LanguageSettings</div>),
}))
vi.mock("../About", () => ({
	About: vi.fn(() => <div>About</div>),
}))
vi.mock("../PromptsSettings", () => ({
	default: vi.fn(() => <div>PromptsSettings</div>),
}))
vi.mock("../SlashCommandsSettings", () => ({
	SlashCommandsSettings: vi.fn(() => <div>SlashCommandsSettings</div>),
}))
vi.mock("../UISettings", () => ({
	UISettings: vi.fn(() => <div>UISettings</div>),
}))
vi.mock("../SectionHeader", () => ({
	SectionHeader: ({ children }: any) => <div>{children}</div>,
}))
vi.mock("../Section", () => ({
	Section: ({ children }: any) => <div>{children}</div>,
}))
vi.mock("../SettingsSearch", () => ({
	SettingsSearch: () => null,
}))

import { useExtensionState } from "@src/context/ExtensionStateContext"
import ApiOptions from "../ApiOptions"
import { vscode } from "@src/utils/vscode"
import { LabeledCheckbox as RealLabeledCheckbox } from "@/components/ui/labeled-checkbox"

describe("SettingsView - Unsaved Changes Detection", () => {
	let queryClient: QueryClient

	const defaultExtensionState = {
		currentApiConfigName: "default",
		listApiConfigMeta: [],
		uriScheme: "vscode",
		settingsImportedAt: undefined,
		apiConfiguration: {
			apiProvider: "openai",
			apiModelId: "", // Empty string initially
		},
		alwaysAllowReadOnly: false,
		alwaysAllowReadOnlyOutsideWorkspace: false,
		allowedCommands: [],
		deniedCommands: [],
		allowedMaxRequests: undefined,
		allowedMaxCost: undefined,
		language: "en",
		alwaysAllowExecute: false,
		alwaysAllowMcp: false,
		alwaysAllowModeSwitch: false,
		alwaysAllowSubtasks: false,
		alwaysAllowWrite: false,
		alwaysAllowWriteOutsideWorkspace: false,
		alwaysAllowWriteProtected: false,
		autoCondenseContext: false,
		autoCondenseContextPercent: 50,
		enableCheckpoints: false,
		experiments: {},
		maxOpenTabsContext: 10,
		maxWorkspaceFiles: 200,
		mcpEnabled: false,
		soundEnabled: false,
		soundVolume: 0.5,
		telemetrySetting: "unset",
		terminalOutputLineLimit: 500,
		terminalOutputCharacterLimit: 50000,
		terminalShellIntegrationTimeout: 3000,
		terminalShellIntegrationDisabled: false,
		terminalCommandDelay: 0,
		terminalPowershellCounter: false,
		terminalZshClearEolMark: false,
		terminalZshOhMy: false,
		terminalZshP10k: false,
		terminalZdotdir: false,
		writeDelayMs: 0,
		showRooIgnoredFiles: false,
		maxReadFileLine: -1,
		maxImageFileSize: 5,
		maxTotalImageSize: 20,
		customCondensingPrompt: "",
		customSupportPrompts: {},
		profileThresholds: {},
		alwaysAllowFollowupQuestions: false,
		followupAutoApproveTimeoutMs: undefined,
		includeDiagnosticMessages: false,
		maxDiagnosticMessages: 50,
		includeTaskHistoryInEnhance: true,
		openRouterImageApiKey: undefined,
		openRouterImageGenerationSelectedModel: undefined,
		reasoningBlockCollapsed: true,
	}

	beforeEach(() => {
		vi.clearAllMocks()
		// Reset the ApiOptions mock to its default implementation
		vi.mocked(ApiOptions).mockImplementation(() => {
			// Don't do anything with props, just render a div
			return <div data-testid="api-options">ApiOptions</div>
		})
		queryClient = new QueryClient({
			defaultOptions: {
				queries: { retry: false },
				mutations: { retry: false },
			},
		})
		;(useExtensionState as any).mockReturnValue(defaultExtensionState)
	})

	it("should not show unsaved changes when settings are automatically initialized", async () => {
		const onDone = vi.fn()

		render(
			<QueryClientProvider client={queryClient}>
				<SettingsView onDone={onDone} />
			</QueryClientProvider>,
		)

		// Wait for the component to render
		await waitFor(() => {
			expect(screen.getByTestId("api-options")).toBeInTheDocument()
		})

		// Wait for any async state updates to complete
		await waitFor(() => {
			const saveButton = screen.getByTestId("save-button") as HTMLButtonElement
			expect(saveButton.disabled).toBe(true)
		})

		// Click the Done button
		const doneButton = screen.getByText("settings:common.done")
		fireEvent.click(doneButton)

		// Should not show unsaved changes dialog - onDone should be called immediately
		await waitFor(() => {
			expect(onDone).toHaveBeenCalled()
		})

		// Verify no dialog appeared
		expect(screen.queryByText("settings:unsavedChangesDialog.title")).not.toBeInTheDocument()
	})

	it("should not trigger unsaved changes for automatic model initialization", async () => {
		const onDone = vi.fn()

		// Mock ApiOptions to simulate ModelPicker initialization
		vi.mocked(ApiOptions).mockImplementation(({ setApiConfigurationField, apiConfiguration }) => {
			const [hasInitialized, setHasInitialized] = React.useState(false)

			React.useEffect(() => {
				// Only run once and only if not already initialized
				if (!hasInitialized && apiConfiguration?.apiModelId === "") {
					// Simulate automatic initialization from empty string to a value
					setApiConfigurationField("apiModelId", "default-model", false)
					setHasInitialized(true)
				}
			}, [hasInitialized, apiConfiguration?.apiModelId, setApiConfigurationField])

			return <div data-testid="api-options">ApiOptions with Init</div>
		})

		render(
			<QueryClientProvider client={queryClient}>
				<SettingsView onDone={onDone} />
			</QueryClientProvider>,
		)

		// Wait for the component to render and effects to run
		await waitFor(() => {
			expect(screen.getByTestId("api-options")).toBeInTheDocument()
		})

		// Give time for effects to complete
		await new Promise((resolve) => setTimeout(resolve, 100))

		// Check that save button is disabled (no changes detected)
		const saveButton = screen.getByTestId("save-button") as HTMLButtonElement
		expect(saveButton.disabled).toBe(true)

		// Click the Done button
		const doneButton = screen.getByText("settings:common.done")
		fireEvent.click(doneButton)

		// Should not show unsaved changes dialog
		expect(screen.queryByText("settings:unsavedChangesDialog.title")).not.toBeInTheDocument()

		// onDone should be called
		expect(onDone).toHaveBeenCalled()
	})

	it("should show unsaved changes when user makes actual changes", async () => {
		const onDone = vi.fn()

		// Create a custom mock for this test that simulates user interaction
		const ApiOptionsWithButton = vi.fn(({ setApiConfigurationField }) => {
			const handleUserChange = () => {
				// Simulate user action (isUserAction = true by default)
				setApiConfigurationField("apiModelId", "user-selected-model")
			}

			return (
				<div data-testid="api-options">
					<button onClick={handleUserChange} data-testid="change-model">
						Change Model
					</button>
				</div>
			)
		})

		// Override the mock for this specific test
		vi.mocked(ApiOptions).mockImplementation(ApiOptionsWithButton)

		render(
			<QueryClientProvider client={queryClient}>
				<SettingsView onDone={onDone} />
			</QueryClientProvider>,
		)

		// Wait for the component to render
		await waitFor(() => {
			expect(screen.getByTestId("api-options")).toBeInTheDocument()
		})

		// Simulate user changing a setting
		const changeButton = screen.getByTestId("change-model")
		fireEvent.click(changeButton)

		// Click the Done button
		const doneButton = screen.getByText("settings:common.done")
		fireEvent.click(doneButton)

		// Should show unsaved changes dialog
		await waitFor(() => {
			expect(screen.getByText("settings:unsavedChangesDialog.title")).toBeInTheDocument()
		})

		// onDone should not be called yet
		expect(onDone).not.toHaveBeenCalled()
	})

	it("should handle initialization from undefined to value without triggering unsaved changes", async () => {
		const onDone = vi.fn()

		// Start with undefined apiModelId
		const stateWithUndefined = {
			...defaultExtensionState,
			apiConfiguration: {
				apiProvider: "openai",
				apiModelId: undefined,
			},
		}
		;(useExtensionState as any).mockReturnValue(stateWithUndefined)

		render(
			<QueryClientProvider client={queryClient}>
				<SettingsView onDone={onDone} />
			</QueryClientProvider>,
		)

		// Wait for initialization
		await waitFor(() => {
			expect(screen.getByTestId("api-options")).toBeInTheDocument()
		})

		// Wait for save button to be disabled (no changes)
		await waitFor(() => {
			const saveButton = screen.getByTestId("save-button") as HTMLButtonElement
			expect(saveButton.disabled).toBe(true)
		})

		// Click Done button
		const doneButton = screen.getByText("settings:common.done")
		fireEvent.click(doneButton)

		// Should call onDone immediately without showing dialog
		await waitFor(() => {
			expect(onDone).toHaveBeenCalled()
		})

		// Verify no dialog appeared
		expect(screen.queryByText("settings:unsavedChangesDialog.title")).not.toBeInTheDocument()
	})

	it("should handle initialization from null to value without triggering unsaved changes", async () => {
		const onDone = vi.fn()

		// Start with null apiModelId
		const stateWithNull = {
			...defaultExtensionState,
			apiConfiguration: {
				apiProvider: "openai",
				apiModelId: null,
			},
		}
		;(useExtensionState as any).mockReturnValue(stateWithNull)

		render(
			<QueryClientProvider client={queryClient}>
				<SettingsView onDone={onDone} />
			</QueryClientProvider>,
		)

		// Wait for initialization
		await waitFor(() => {
			expect(screen.getByTestId("api-options")).toBeInTheDocument()
		})

		// Wait for save button to be disabled (no changes)
		await waitFor(() => {
			const saveButton = screen.getByTestId("save-button") as HTMLButtonElement
			expect(saveButton.disabled).toBe(true)
		})

		// Click Done button
		const doneButton = screen.getByText("settings:common.done")
		fireEvent.click(doneButton)

		// Should call onDone immediately without showing dialog
		await waitFor(() => {
			expect(onDone).toHaveBeenCalled()
		})

		// Verify no dialog appeared
		expect(screen.queryByText("settings:unsavedChangesDialog.title")).not.toBeInTheDocument()
	})

	it("should not trigger changes when ApiOptions syncs model IDs during mount", async () => {
		const onDone = vi.fn()

		// This specifically tests the bug we fixed where ApiOptions' useEffect
		// was syncing selectedModelId with apiModelId and incorrectly triggering
		// change detection because it wasn't passing isUserAction=false

		// Mock ApiOptions to simulate the actual sync behavior
		vi.mocked(ApiOptions).mockImplementation(({ setApiConfigurationField, apiConfiguration }) => {
			const [hasSynced, setHasSynced] = React.useState(false)

			React.useEffect(() => {
				// Simulate the automatic sync that happens in the real component
				// This should NOT trigger unsaved changes because isUserAction=false
				// Only sync once to avoid multiple calls
				if (!hasSynced && apiConfiguration?.apiModelId === "") {
					setApiConfigurationField("apiModelId", "synced-model", false)
					setHasSynced(true)
				}
			}, [hasSynced, apiConfiguration?.apiModelId, setApiConfigurationField])

			return <div data-testid="api-options">ApiOptions</div>
		})

		render(
			<QueryClientProvider client={queryClient}>
				<SettingsView onDone={onDone} />
			</QueryClientProvider>,
		)

		// Wait for component to fully mount and ApiOptions effect to run
		await waitFor(() => {
			expect(screen.getByTestId("api-options")).toBeInTheDocument()
		})

		// Wait for any async effects to complete
		await new Promise((resolve) => setTimeout(resolve, 100))

		// Save button should still be disabled (no user changes)
		const saveButton = screen.getByTestId("save-button") as HTMLButtonElement
		expect(saveButton.disabled).toBe(true)

		// Clicking done should not show dialog
		const doneButton = screen.getByText("settings:common.done")
		fireEvent.click(doneButton)

		// Should call onDone directly without showing unsaved changes dialog
		await waitFor(() => {
			expect(onDone).toHaveBeenCalled()
		})

		// No dialog should appear
		expect(screen.queryByText("settings:unsavedChangesDialog.title")).not.toBeInTheDocument()
	})

	describe("API profile picked in the Modes tab", () => {
		// ModesView is a tab of SettingsView and has its own API profile picker. Loading
		// another profile changes currentApiConfigName, and the profile-switch effect then
		// overwrites the whole Save buffer and clears the unsaved flag. The Providers tab
		// asks first (discard dialog); the Modes tab must do the same.
		const EditableApiOptions = ({ setApiConfigurationField }: any) => (
			<div data-testid="api-options">
				<button onClick={() => setApiConfigurationField("apiModelId", "user-edit")} data-testid="edit-model">
					Edit
				</button>
			</div>
		)

		// The acquireVsCodeApi stub above is assigned after the hoisted imports, so the
		// vscode wrapper never sees it; spy on the wrapper itself.
		let postMessageSpy: MockInstance
		const loadProfileCalls = () =>
			postMessageSpy.mock.calls.filter(([message]) => (message as any)?.type === "loadApiConfiguration")

		beforeEach(() => {
			vi.mocked(ApiOptions).mockImplementation(EditableApiOptions)
			postMessageSpy = vi.spyOn(vscode, "postMessage").mockImplementation(() => {})
		})

		afterEach(() => {
			postMessageSpy.mockRestore()
		})

		const editThenPickProfileInModesTab = async () => {
			render(
				<QueryClientProvider client={queryClient}>
					<SettingsView onDone={vi.fn()} />
				</QueryClientProvider>,
			)
			fireEvent.click(screen.getByTestId("edit-model"))
			await waitFor(() => expect((screen.getByTestId("save-button") as HTMLButtonElement).disabled).toBe(false))

			fireEvent.click(screen.getByTestId("tab-modes"))
			fireEvent.click(await screen.findByTestId("modes-select-profile"))
		}

		it("a loaded profile (new currentApiConfigName) replaces the Save buffer and clears the unsaved flag", async () => {
			// Why the question matters: once the host has loaded the profile, the edits are gone
			// without any prompt and the Save button goes grey.
			const view = render(
				<QueryClientProvider client={queryClient}>
					<SettingsView onDone={vi.fn()} />
				</QueryClientProvider>,
			)
			fireEvent.click(screen.getByTestId("edit-model"))
			await waitFor(() => expect((screen.getByTestId("save-button") as HTMLButtonElement).disabled).toBe(false))
			;(useExtensionState as any).mockReturnValue({ ...defaultExtensionState, currentApiConfigName: "other" })
			view.rerender(
				<QueryClientProvider client={queryClient}>
					<SettingsView onDone={vi.fn()} />
				</QueryClientProvider>,
			)

			await waitFor(() => expect((screen.getByTestId("save-button") as HTMLButtonElement).disabled).toBe(true))
		})

		it("asks before discarding unsaved edits and loads the profile only on confirm", async () => {
			await editThenPickProfileInModesTab()

			await waitFor(() => expect(screen.getByText("settings:unsavedChangesDialog.title")).toBeInTheDocument())
			expect(loadProfileCalls()).toHaveLength(0)

			fireEvent.click(screen.getByText("settings:unsavedChangesDialog.discardButton"))

			expect(loadProfileCalls()).toEqual([[{ type: "loadApiConfiguration", text: "other-profile" }]])
		})

		it("keeps the unsaved edits and the current profile when the user cancels", async () => {
			await editThenPickProfileInModesTab()

			await waitFor(() => expect(screen.getByText("settings:unsavedChangesDialog.title")).toBeInTheDocument())
			fireEvent.click(screen.getByText("settings:unsavedChangesDialog.cancelButton"))

			expect(loadProfileCalls()).toHaveLength(0)
			expect((screen.getByTestId("save-button") as HTMLButtonElement).disabled).toBe(false)
		})

		it("loads the profile at once when nothing is unsaved", async () => {
			render(
				<QueryClientProvider client={queryClient}>
					<SettingsView onDone={vi.fn()} />
				</QueryClientProvider>,
			)
			fireEvent.click(screen.getByTestId("tab-modes"))
			fireEvent.click(await screen.findByTestId("modes-select-profile"))

			expect(screen.queryByText("settings:unsavedChangesDialog.title")).not.toBeInTheDocument()
			expect(loadProfileCalls()).toEqual([[{ type: "loadApiConfiguration", text: "other-profile" }]])
		})
	})

	describe("settings import signal (settingsImportedAt)", () => {
		// The host sets settingsImportedAt to a timestamp for exactly one state
		// push after an import and then clears it with `undefined`. VS Code's
		// postMessage JSON-serializes the state, so the `undefined` never reaches
		// the webview and mergeExtensionState keeps the old timestamp. Every later
		// state push therefore still carries the same, stale timestamp.
		const EditableApiOptions = ({ setApiConfigurationField, apiConfiguration }: any) => (
			<div data-testid="api-options">
				<span data-testid="model-id">{apiConfiguration?.apiModelId ?? ""}</span>
				<button onClick={() => setApiConfigurationField("apiModelId", "user-edit")} data-testid="edit-model">
					Edit
				</button>
			</div>
		)

		const renderView = () => {
			const view = render(
				<QueryClientProvider client={queryClient}>
					<SettingsView onDone={vi.fn()} />
				</QueryClientProvider>,
			)
			const pushState = (state: any) => {
				;(useExtensionState as any).mockReturnValue(state)
				view.rerender(
					<QueryClientProvider client={queryClient}>
						<SettingsView onDone={vi.fn()} />
					</QueryClientProvider>,
				)
			}
			return { pushState }
		}

		const saveButton = () => screen.getByTestId("save-button") as HTMLButtonElement

		beforeEach(() => {
			vi.mocked(ApiOptions).mockImplementation(EditableApiOptions)
		})

		it("keeps an edit made after an import when an unrelated state update arrives", async () => {
			const { pushState } = renderView()

			// The import lands: one state push carrying the imported values and the timestamp.
			const importedState = {
				...defaultExtensionState,
				settingsImportedAt: 1000,
				apiConfiguration: { apiProvider: "openai", apiModelId: "imported-model" },
			}
			pushState(importedState)
			await waitFor(() => expect(screen.getByTestId("model-id").textContent).toBe("imported-model"))

			// The user edits a field after the import.
			fireEvent.click(screen.getByTestId("edit-model"))
			await waitFor(() => expect(screen.getByTestId("model-id").textContent).toBe("user-edit"))
			expect(saveButton().disabled).toBe(false)

			// An unrelated state push (e.g. a task message) arrives; the stale
			// timestamp is still in the merged state.
			pushState({ ...importedState, soundEnabled: true })

			expect(screen.getByTestId("model-id").textContent).toBe("user-edit")
			expect(saveButton().disabled).toBe(false)
		})

		it("resets the Save buffer once for each new import", async () => {
			const { pushState } = renderView()

			// An edit before the first import is replaced by the imported values.
			fireEvent.click(screen.getByTestId("edit-model"))
			await waitFor(() => expect(saveButton().disabled).toBe(false))

			const firstImport = {
				...defaultExtensionState,
				settingsImportedAt: 1000,
				apiConfiguration: { apiProvider: "openai", apiModelId: "first-import" },
			}
			pushState(firstImport)
			await waitFor(() => expect(screen.getByTestId("model-id").textContent).toBe("first-import"))
			expect(saveButton().disabled).toBe(true)

			// Edit again, then a second import with a new timestamp resets the buffer again.
			fireEvent.click(screen.getByTestId("edit-model"))
			await waitFor(() => expect(saveButton().disabled).toBe(false))

			const secondImport = {
				...firstImport,
				settingsImportedAt: 2000,
				apiConfiguration: { apiProvider: "openai", apiModelId: "second-import" },
			}
			pushState(secondImport)
			await waitFor(() => expect(screen.getByTestId("model-id").textContent).toBe("second-import"))
			expect(saveButton().disabled).toBe(true)

			// A later edit survives further pushes that repeat the same timestamp.
			fireEvent.click(screen.getByTestId("edit-model"))
			await waitFor(() => expect(saveButton().disabled).toBe(false))
			pushState({ ...secondImport, soundEnabled: true })
			expect(screen.getByTestId("model-id").textContent).toBe("user-edit")
			expect(saveButton().disabled).toBe(false)
		})
	})
})
