// DEF-C25: what the Settings "Save" button sends when the webview state has
// no value for a setting. The payload falls back to a hard-coded default per
// field; those fallbacks must agree with the host defaults, otherwise the
// first Save silently rewrites settings the user never touched.
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { vi, describe, it, expect, beforeEach } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import React from "react"

// vi.mock is hoisted above the imports, so the spy must be hoisted too.
const { mockPostMessage } = vi.hoisted(() => ({ mockPostMessage: vi.fn() }))
vi.mock("@src/utils/vscode", () => ({
	vscode: { postMessage: mockPostMessage },
}))

// Import the actual component
import SettingsView from "../SettingsView"
import { useExtensionState } from "@src/context/ExtensionStateContext"

// Mock the extension state context
vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: vi.fn(),
}))

// Mock the translation context
vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

// Mock UI components
vi.mock("@src/components/ui", () => ({
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
	AlertDialogTitle: ({ children }: any) => <div data-testid="alert-title">{children}</div>,
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
	StandardTooltip: ({ children }: any) => <>{children}</>,
	Popover: ({ children }: any) => <>{children}</>,
	PopoverTrigger: ({ children }: any) => <>{children}</>,
	PopoverContent: ({ children }: any) => <div>{children}</div>,
	Tooltip: ({ children }: any) => <>{children}</>,
	TooltipProvider: ({ children }: any) => <>{children}</>,
	TooltipTrigger: ({ children }: any) => <>{children}</>,
	TooltipContent: ({ children }: any) => <div>{children}</div>,
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
	default: () => null,
}))

vi.mock("@src/components/mcp/McpView", () => ({
	default: () => null,
}))

// Mock Tab components
vi.mock("../common/Tab", () => ({
	Tab: ({ children }: any) => <div>{children}</div>,
	TabContent: React.forwardRef<HTMLDivElement, any>(({ children }, ref) => <div ref={ref}>{children}</div>),
	TabHeader: ({ children }: any) => <div>{children}</div>,
	TabList: ({ children }: any) => <div>{children}</div>,
	TabTrigger: React.forwardRef<HTMLButtonElement, any>(({ children }, ref) => <button ref={ref}>{children}</button>),
}))

// Mock all child components to isolate the test
vi.mock("../ApiConfigManager", () => ({
	default: () => null,
}))

vi.mock("../ApiOptions", () => ({
	default: () => null,
}))

vi.mock("../AutoApproveSettings", () => ({
	AutoApproveSettings: () => null,
}))

vi.mock("../SectionHeader", () => ({
	SectionHeader: ({ children }: any) => <div>{children}</div>,
}))

vi.mock("../Section", () => ({
	Section: ({ children }: any) => <div>{children}</div>,
}))

// Mock all settings components
vi.mock("../CheckpointSettings", () => ({
	CheckpointSettings: () => null,
}))
vi.mock("../NotificationSettings", () => ({
	NotificationSettings: () => null,
}))
vi.mock("../ContextManagementSettings", () => ({
	ContextManagementSettings: () => null,
}))
vi.mock("../TerminalSettings", () => ({
	// Opening the terminal profile picker marks the form dirty without
	// changing any value, which lets the test press Save on an untouched state.
	TerminalSettings: ({ onTerminalProfilePickerOpened }: any) => (
		<button data-testid="open-profile-picker" onClick={onTerminalProfilePickerOpened}>
			open picker
		</button>
	),
}))
vi.mock("../ExperimentalSettings", () => ({
	ExperimentalSettings: () => null,
}))
vi.mock("../LanguageSettings", () => ({
	LanguageSettings: () => null,
}))
vi.mock("../About", () => ({
	About: () => null,
}))
vi.mock("../PromptsSettings", () => ({
	default: () => null,
}))
vi.mock("../SlashCommandsSettings", () => ({
	SlashCommandsSettings: () => null,
}))
vi.mock("../UISettings", () => ({
	UISettings: () => null,
}))

vi.mock("../SettingsSearch", () => ({
	SettingsSearch: () => null,
}))

// Only what SettingsView needs to render; every setting is left undefined.
const untouchedState = () => ({
	currentApiConfigName: "default",
	listApiConfigMeta: [],
	uriScheme: "vscode",
	settingsImportedAt: undefined,
	apiConfiguration: {},
})

const saveUntouchedSettings = async () => {
	;(useExtensionState as any).mockReturnValue(untouchedState())
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

	render(
		<QueryClientProvider client={queryClient}>
			<SettingsView onDone={vi.fn()} targetSection="terminal" />
		</QueryClientProvider>,
	)

	fireEvent.click(await screen.findByTestId("open-profile-picker"))
	const saveButton = screen.getByTestId("save-button") as HTMLButtonElement
	await waitFor(() => expect(saveButton.disabled).toBe(false))
	fireEvent.click(saveButton)

	const call = mockPostMessage.mock.calls.find(([message]) => message.type === "updateSettings")
	expect(call).toBeDefined()
	return call![0].updatedSettings
}

describe("SettingsView Save with every setting undefined (DEF-C25)", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	// Characterization: pins the whole payload so any change to a fallback is
	// a visible diff in this test. Keys whose fallback is undefined are
	// dropped by JSON.stringify on the way to the host, so they are omitted.
	it("sends today's fallback for every field", async () => {
		const payload = await saveUntouchedSettings()

		expect(payload).toEqual({
			allowedCommands: [],
			deniedCommands: [],
			allowedMaxRequests: null,
			allowedMaxCost: null,
			soundEnabled: true,
			soundVolume: 0.5,
			enableCheckpoints: false,
			checkpointTimeout: 15,
			autoMemoryEnabled: true,
			memoryRecallEnabled: true,
			autoDreamEnabled: true,
			autoDreamMinHours: 24,
			autoDreamMinSessions: 5,
			webToolsEnabled: false,
			webSearchBackend: "searxng",
			searxngBaseUrl: "",
			webSearchMaxResults: 5,
			webFetchMaxBytes: 51200,
			pruneBeforeCondense: true,
			pruneToolResultBudget: 4096,
			terminalShellIntegrationTimeout: 30000,
			terminalProfile: "",
			terminalOutputPreviewSize: "medium",
			maxOpenTabsContext: 20,
			maxWorkspaceFiles: 200,
			showRooIgnoredFiles: true,
			enableSubfolderRules: false,
			maxImageFileSize: 5,
			maxTotalImageSize: 20,
			includeDiagnosticMessages: true,
			maxDiagnosticMessages: 50,
			alwaysAllowFollowupQuestions: false,
			includeTaskHistoryInEnhance: true,
			reasoningBlockCollapsed: true,
			enterBehavior: "send",
			includeCurrentTime: true,
			includeCurrentCost: true,
			maxGitStatusFiles: 0,
		})
	})

	// Owner decisions 4a and 4b: the Save fallback must match the host defaults
	// (30,000 ms shell integration timeout, sound off, checkpoints on).
	it("falls back to the decided defaults for the three disputed settings", async () => {
		const payload = await saveUntouchedSettings()

		expect(payload.terminalShellIntegrationTimeout).toBe(30_000)
		expect(payload.soundEnabled).toBe(false)
		expect(payload.enableCheckpoints).toBe(true)
	})
})
