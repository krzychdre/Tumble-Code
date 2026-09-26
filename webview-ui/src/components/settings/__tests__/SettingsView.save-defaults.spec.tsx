// What the Settings "Save" button sends (characterization for WEB-3).
//
// DEF-C25: when the webview state has no value for a setting, the payload
// falls back to a default per field; those fallbacks must agree with the host
// defaults, otherwise the first Save silently rewrites settings the user never
// touched. The second suite pins the exact payload for a fully populated state,
// so moving the payload into a declarative schema cannot drop or rename a key.
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { vi, describe, it, expect, beforeEach } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import React from "react"
import { SETTINGS_DEFAULTS } from "@roo-code/types"

// vi.mock is hoisted above the imports, so the spy must be hoisted too.
const { mockPostMessage } = vi.hoisted(() => ({ mockPostMessage: vi.fn() }))
vi.mock("@src/utils/vscode", () => ({
	vscode: { postMessage: mockPostMessage },
}))

// Import the actual component
import SettingsView from "../SettingsView"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { LabeledCheckbox as RealLabeledCheckbox } from "@/components/ui/labeled-checkbox"

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

// Marks the form dirty without changing a value, presses Save and returns
// every message the view posted, in order.
const saveWithState = async (state: Record<string, unknown>) => {
	;(useExtensionState as any).mockReturnValue(state)
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

	render(
		<QueryClientProvider client={queryClient}>
			<SettingsView onDone={vi.fn()} targetSection="terminal" />
		</QueryClientProvider>,
	)

	fireEvent.click(await screen.findByTestId("open-profile-picker"))
	const saveButton = screen.getByTestId("save-button") as HTMLButtonElement
	await waitFor(() => expect(saveButton.disabled).toBe(false))
	// Forget what the sections posted while mounting (skills, worktrees).
	mockPostMessage.mockClear()
	fireEvent.click(saveButton)

	return mockPostMessage.mock.calls.map(([message]) => message)
}

const saveUntouchedSettings = async () => {
	const messages = await saveWithState(untouchedState())
	const update = messages.find((message) => message.type === "updateSettings")
	expect(update).toBeDefined()
	return update.updatedSettings
}

// The full SettingsView tree is heavy to mount; under a parallel full-suite
// run the first render alone can exceed the 5 s default test timeout.
describe("SettingsView Save with every setting undefined (DEF-C25)", { timeout: 20_000 }, () => {
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
			soundEnabled: false, // DEF-C25: was true, now the host default
			soundVolume: 0.5,
			enableCheckpoints: true, // DEF-C25: was false, now the host default
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
			showRooIgnoredFiles: false, // was true, now the host default
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

	// Every fallback of a setting that has a static host default must be that
	// default, or the first Save rewrites a value the user never touched.
	it("falls back to the host default table for every setting it has", async () => {
		const payload = await saveUntouchedSettings()

		const drift = Object.entries(payload).filter(
			([key, value]) =>
				key in SETTINGS_DEFAULTS &&
				value !== undefined &&
				JSON.stringify(value) !== JSON.stringify(SETTINGS_DEFAULTS[key as keyof typeof SETTINGS_DEFAULTS]),
		)

		expect(drift).toEqual([])
	})
})

// Every setting the Save payload carries, each with a value that differs from
// its fallback, plus fields the view must never forward (chat messages, task
// history, context setters).
const populatedState = () => ({
	currentApiConfigName: "work",
	listApiConfigMeta: [{ id: "p1", name: "work", apiProvider: "anthropic" }],
	uriScheme: "vscode",
	settingsImportedAt: undefined,
	apiConfiguration: { apiProvider: "anthropic", apiModelId: "claude-test", apiKey: "sk-test" },
	clineMessages: [{ ts: 1, type: "say", say: "text", text: "must not be sent" }],
	taskHistory: [{ id: "t1", ts: 1, task: "must not be sent" }],
	setSoundEnabled: vi.fn(),
	telemetrySetting: "enabled",
	debug: true,

	language: "pl",
	alwaysAllowReadOnly: true,
	alwaysAllowReadOnlyOutsideWorkspace: true,
	alwaysAllowWrite: true,
	alwaysAllowWriteOutsideWorkspace: true,
	alwaysAllowWriteProtected: true,
	alwaysAllowExecute: true,
	alwaysAllowMcp: true,
	alwaysAllowModeSwitch: true,
	allowedCommands: ["git status"],
	deniedCommands: ["rm -rf"],
	allowedMaxRequests: 7,
	allowedMaxCost: 1.5,
	autoCondenseContext: false,
	autoCondenseContextPercent: 64,
	soundEnabled: true,
	soundVolume: 0.25,
	enableCheckpoints: false,
	checkpointTimeout: 42,
	autoMemoryEnabled: false,
	autoMemoryDirectory: "/tmp/memory",
	autoMemoryShareWithClaudeCode: true,
	memoryRecallEnabled: false,
	autoDreamEnabled: false,
	autoDreamMinHours: 12,
	autoDreamMinSessions: 3,
	memoryWriterApiConfigId: "p-writer",
	autoCondenseContextApiConfigId: "p-condense",
	webToolsEnabled: true,
	webSearchBackend: "searxng",
	searxngBaseUrl: "http://searx.local",
	webSearchMaxResults: 9,
	webFetchMaxBytes: 1234,
	pruneBeforeCondense: false,
	pruneToolResultBudget: 999,
	writeDelayMs: 250,
	terminalShellIntegrationTimeout: 7000,
	terminalShellIntegrationDisabled: false,
	terminalCommandDelay: 30,
	terminalPowershellCounter: true,
	terminalZshClearEolMark: false,
	terminalZshOhMy: true,
	terminalZshP10k: true,
	terminalZdotdir: true,
	terminalProfile: "zsh",
	terminalOutputPreviewSize: "large",
	mcpEnabled: false,
	maxOpenTabsContext: 900, // clamped to 500
	maxWorkspaceFiles: -3, // clamped to 0
	showRooIgnoredFiles: false,
	enableSubfolderRules: true,
	maxImageFileSize: 8,
	maxTotalImageSize: 40,
	includeDiagnosticMessages: false,
	maxDiagnosticMessages: 11,
	alwaysAllowSubtasks: true,
	alwaysApprovePlan: true,
	alwaysAllowFollowupQuestions: true,
	followupAutoApproveTimeoutMs: 4000,
	includeTaskHistoryInEnhance: false,
	reasoningBlockCollapsed: false,
	enterBehavior: "newline",
	includeCurrentTime: false,
	includeCurrentCost: false,
	maxGitStatusFiles: 33,
	parallelTasksMaxConcurrency: 6,
	subagentFollowupTimeoutSec: 90,
	profileThresholds: { p1: 55 },
	imageGenerationProvider: "openrouter",
	openRouterImageApiKey: "or-key",
	openRouterImageGenerationSelectedModel: "img-model",
	experiments: { preventFocusDisruption: true },
	customSupportPrompts: { ENHANCE: "better" },
})

describe("SettingsView Save with every setting populated (WEB-3)", { timeout: 20_000 }, () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("posts exactly these four messages", async () => {
		const messages = await saveWithState(populatedState())

		expect(messages.map((message) => message.type)).toEqual([
			"updateSettings",
			"upsertApiConfiguration",
			"telemetrySetting",
			"debugSetting",
		])
		expect(messages[1]).toEqual({
			type: "upsertApiConfiguration",
			text: "work",
			apiConfiguration: { apiProvider: "anthropic", apiModelId: "claude-test", apiKey: "sk-test" },
		})
		expect(messages[2]).toEqual({ type: "telemetrySetting", text: "enabled" })
		expect(messages[3]).toEqual({ type: "debugSetting", bool: true })
	})

	// Characterization: toStrictEqual also fails on a key that is present with
	// the value undefined, so an added or dropped key is a visible diff.
	it("sends every setting with its own value", async () => {
		const messages = await saveWithState(populatedState())

		expect(messages[0].updatedSettings).toStrictEqual({
			language: "pl",
			alwaysAllowReadOnly: true,
			alwaysAllowReadOnlyOutsideWorkspace: true,
			alwaysAllowWrite: true,
			alwaysAllowWriteOutsideWorkspace: true,
			alwaysAllowWriteProtected: true,
			alwaysAllowExecute: true,
			alwaysAllowMcp: true,
			alwaysAllowModeSwitch: true,
			allowedCommands: ["git status"],
			deniedCommands: ["rm -rf"],
			allowedMaxRequests: 7,
			allowedMaxCost: 1.5,
			autoCondenseContext: false,
			autoCondenseContextPercent: 64,
			soundEnabled: true,
			soundVolume: 0.25,
			enableCheckpoints: false,
			checkpointTimeout: 42,
			autoMemoryEnabled: false,
			autoMemoryDirectory: "/tmp/memory",
			autoMemoryShareWithClaudeCode: true,
			memoryRecallEnabled: false,
			autoDreamEnabled: false,
			autoDreamMinHours: 12,
			autoDreamMinSessions: 3,
			memoryWriterApiConfigId: "p-writer",
			autoCondenseContextApiConfigId: "p-condense",
			webToolsEnabled: true,
			webSearchBackend: "searxng",
			searxngBaseUrl: "http://searx.local",
			webSearchMaxResults: 9,
			webFetchMaxBytes: 1234,
			pruneBeforeCondense: false,
			pruneToolResultBudget: 999,
			writeDelayMs: 250,
			terminalShellIntegrationTimeout: 7000,
			terminalShellIntegrationDisabled: false,
			terminalCommandDelay: 30,
			terminalPowershellCounter: true,
			terminalZshClearEolMark: false,
			terminalZshOhMy: true,
			terminalZshP10k: true,
			terminalZdotdir: true,
			terminalProfile: "zsh",
			terminalOutputPreviewSize: "large",
			maxOpenTabsContext: 500,
			maxWorkspaceFiles: 0,
			showRooIgnoredFiles: false,
			enableSubfolderRules: true,
			maxImageFileSize: 8,
			maxTotalImageSize: 40,
			includeDiagnosticMessages: false,
			maxDiagnosticMessages: 11,
			alwaysAllowSubtasks: true,
			alwaysApprovePlan: true,
			alwaysAllowFollowupQuestions: true,
			followupAutoApproveTimeoutMs: 4000,
			includeTaskHistoryInEnhance: false,
			reasoningBlockCollapsed: false,
			enterBehavior: "newline",
			includeCurrentTime: false,
			includeCurrentCost: false,
			maxGitStatusFiles: 33,
			parallelTasksMaxConcurrency: 6,
			subagentFollowupTimeoutSec: 90,
			profileThresholds: { p1: 55 },
			imageGenerationProvider: "openrouter",
			openRouterImageApiKey: "or-key",
			openRouterImageGenerationSelectedModel: "img-model",
			experiments: { preventFocusDisruption: true },
			customSupportPrompts: { ENHANCE: "better" },
		})
	})

	// Decision 18: an emptied profile or directory field is sent as "", so the
	// host clears it (undefined would be dropped by JSON and the host would keep
	// the old value). null clears the two limits.
	it("sends emptied optional ids and directory as empty strings, so the host clears them", async () => {
		const messages = await saveWithState({
			...populatedState(),
			autoMemoryDirectory: "",
			memoryWriterApiConfigId: "",
			autoCondenseContextApiConfigId: "",
			searxngBaseUrl: "",
			terminalProfile: "",
			allowedMaxRequests: undefined,
			allowedMaxCost: undefined,
		})
		const payload = JSON.parse(JSON.stringify(messages[0].updatedSettings))

		expect(payload.autoMemoryDirectory).toBe("")
		expect(payload.memoryWriterApiConfigId).toBe("")
		expect(payload.autoCondenseContextApiConfigId).toBe("")
		expect(payload.searxngBaseUrl).toBe("")
		expect(payload.terminalProfile).toBe("")
		expect(payload.allowedMaxRequests).toBeNull()
		expect(payload.allowedMaxCost).toBeNull()
	})
})

// The "Enable MCP" checkbox in the MCP tab writes mcpEnabled to the host and
// the live state at once; nothing in the settings form edits it.
describe("SettingsView Save after the MCP tab toggled MCP", { timeout: 20_000 }, () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("does not send the value mcpEnabled had when the settings opened", async () => {
		;(useExtensionState as any).mockReturnValue({ ...populatedState(), mcpEnabled: true })
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
		const view = (
			<QueryClientProvider client={queryClient}>
				<SettingsView onDone={vi.fn()} targetSection="terminal" />
			</QueryClientProvider>
		)
		const { rerender } = render(view)

		// The toggle turned MCP off: the host pushes the new state.
		;(useExtensionState as any).mockReturnValue({ ...populatedState(), mcpEnabled: false })
		rerender(view)

		fireEvent.click(await screen.findByTestId("open-profile-picker"))
		const saveButton = screen.getByTestId("save-button") as HTMLButtonElement
		await waitFor(() => expect(saveButton.disabled).toBe(false))
		mockPostMessage.mockClear()
		fireEvent.click(saveButton)

		const update = mockPostMessage.mock.calls.map(([message]) => message).find((m) => m.type === "updateSettings")
		expect(update.updatedSettings.mcpEnabled).not.toBe(true)
	})
})
