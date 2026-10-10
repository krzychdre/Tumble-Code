// Characterization of the Settings view's Save buffer as seen through the
// real section components (D13): editing a field in any section writes the
// buffer, marks the form dirty, and Save posts exactly the messages pinned in
// the snapshot; discarding restores the buffer, cancelling keeps the edit.
//
// Every section is the real component; only the host, the translations and
// the Radix widgets jsdom cannot drive (slider, select) are replaced.

import { act, fireEvent, render, screen, within } from "@/utils/test-utils"

import { vscode } from "@src/utils/vscode"

import SettingsView from "../SettingsView"

vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage: vi.fn() } }))

const mockState = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))
vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: () => mockState.current,
	useExtensionSelector: (selector: (s: never) => unknown) => selector(mockState.current as never),
}))

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("react-i18next", () => ({
	Trans: ({ i18nKey }: { i18nKey?: string }) => <span>{i18nKey}</span>,
	useTranslation: () => ({ t: (key: string) => key }),
	initReactI18next: { type: "3rdParty", init: () => {} },
}))

// The Providers tab (the default one) is out of scope here.
vi.mock("../ApiConfigManager", () => ({ default: () => null }))
vi.mock("../ApiOptions", () => ({ default: () => null }))
vi.mock("../SettingsSearch", () => ({ SettingsSearch: () => null }))

vi.mock("@src/components/ui", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@src/components/ui")>()
	return {
		...actual,
		// Radix slider and select do not run in jsdom: native stand-ins that
		// call the same callbacks with the same argument shapes.
		Slider: ({ value, defaultValue, onValueChange, "data-testid": testId }: any) => (
			<input
				type="range"
				data-testid={testId}
				value={(value ?? defaultValue)?.[0] ?? 0}
				onChange={(e) => onValueChange?.([Number(e.target.value)])}
			/>
		),
		Select: ({ value, onValueChange, children }: any) => (
			<div data-testid="select" data-value={value}>
				<input data-testid="select-input" value={value ?? ""} onChange={(e) => onValueChange(e.target.value)} />
				{children}
			</div>
		),
		SelectTrigger: ({ children }: any) => <div>{children}</div>,
		SelectValue: () => null,
		SelectContent: () => null,
		SelectGroup: () => null,
		SelectItem: () => null,
		SelectSeparator: () => null,
	}
})

// A state with a non-default value for most buffered settings, so a lost or
// swapped field shows in the Save snapshot.
const baseState = () => ({
	currentApiConfigName: "default",
	listApiConfigMeta: [{ id: "p1", name: "default", apiProvider: "anthropic" }],
	uriScheme: "vscode",
	settingsImportedAt: undefined,
	apiConfiguration: { apiProvider: "anthropic" },
	debug: false,
	// Auto-approve
	autoApprovalEnabled: true,
	autoApprovalMode: "default",
	setAutoApprovalEnabled: vi.fn(),
	setAutoApprovalMode: vi.fn(),
	alwaysAllowReadOnly: true,
	alwaysAllowWrite: false,
	alwaysAllowExecute: true,
	allowedCommands: ["git status"],
	deniedCommands: ["rm -rf"],
	allowedMaxRequests: 25,
	allowedMaxCost: 3,
	followupAutoApproveTimeoutMs: 45000,
	// Checkpoints
	enableCheckpoints: true,
	checkpointTimeout: 20,
	// Memory
	autoMemoryEnabled: true,
	autoMemoryDirectory: "/mem",
	memoryRecallEnabled: true,
	autoDreamEnabled: false,
	autoDreamMinHours: 12,
	autoDreamMinSessions: 3,
	memoryWriterApiConfigId: "",
	// Web tools
	webToolsEnabled: false,
	searxngBaseUrl: "http://searx.local",
	webSearchMaxResults: 7,
	// Notifications
	soundEnabled: false,
	soundVolume: 0.4,
	// Context management
	autoCondenseContext: true,
	autoCondenseContextPercent: 80,
	maxOpenTabsContext: 15,
	maxWorkspaceFiles: 150,
	showRooIgnoredFiles: false,
	enableSubfolderRules: false,
	maxImageFileSize: 4,
	maxTotalImageSize: 18,
	profileThresholds: {},
	includeDiagnosticMessages: true,
	maxDiagnosticMessages: 40,
	writeDelayMs: 900,
	includeCurrentTime: true,
	includeCurrentCost: false,
	maxGitStatusFiles: 9,
	customSupportPrompts: { ENHANCE: "Improve: ${userInput}" },
	// Terminal
	terminalOutputPreviewSize: "medium",
	terminalShellIntegrationTimeout: 8000,
	terminalShellIntegrationDisabled: true,
	terminalCommandDelay: 0,
	terminalZshOhMy: false,
	// Subagents
	parallelTasksMaxConcurrency: 2,
	subagentFollowupTimeoutSec: 30,
	// Prompts
	includeTaskHistoryInEnhance: false,
	enhancementApiConfigId: "",
	setEnhancementApiConfigId: vi.fn(),
	setIncludeTaskHistoryInEnhance: vi.fn(),
	// UI
	reasoningBlockCollapsed: true,
	enterBehavior: "send",
	uiDensity: "comfortable",
	// Experimental
	experiments: { preventFocusDisruption: false, imageGeneration: false },
	// Language
	language: "en",
})

const renderView = () => {
	const onDone = vi.fn()
	render(<SettingsView onDone={onDone} />)
	return { onDone }
}

const openTab = (id: string) => {
	fireEvent.click(screen.getByTestId(`tab-${id}`))
	return screen.getByTestId("settings-content")
}

const checkbox = (content: HTMLElement, name: string) => within(content).getByRole("checkbox", { name })

const postedMessages = () => vi.mocked(vscode.postMessage).mock.calls.map(([message]) => message)

type Edit = { tab: string; edit: (content: HTMLElement) => void }

// One edit per section, each through the control a user would use.
const EDITS: Record<string, Edit> = {
	autoApprove: {
		tab: "autoApprove",
		edit: (content) => {
			fireEvent.click(checkbox(content, "settings:autoApprove.readOnly.outsideWorkspace.label"))
			fireEvent.change(within(content).getByTestId("command-input"), { target: { value: "npm test" } })
			fireEvent.click(within(content).getByTestId("add-command-button"))
		},
	},
	checkpoints: {
		tab: "checkpoints",
		edit: (content) => {
			fireEvent.change(within(content).getByTestId("checkpoint-timeout-slider"), { target: { value: "42" } })
		},
	},
	memory: {
		tab: "memory",
		edit: (content) => {
			fireEvent.input(within(content).getByTestId("memory-directory-input"), { target: { value: "/other" } })
		},
	},
	web: {
		tab: "web",
		edit: (content) => {
			fireEvent.click(within(content).getByTestId("web-tools-enabled-checkbox"))
		},
	},
	notifications: {
		tab: "notifications",
		edit: (content) => {
			fireEvent.click(within(content).getByTestId("sound-enabled-checkbox"))
		},
	},
	contextManagement: {
		tab: "contextManagement",
		edit: (content) => {
			fireEvent.click(within(content).getByTestId("show-rooignored-files-checkbox"))
			fireEvent.change(within(content).getByTestId("write-delay-slider"), { target: { value: "1200" } })
		},
	},
	terminal: {
		tab: "terminal",
		edit: (content) => {
			fireEvent.click(checkbox(content, "settings:terminal.shellIntegrationDisabled.label"))
		},
	},
	subagents: {
		tab: "subagents",
		edit: (content) => {
			fireEvent.change(within(content).getByTestId("subagents-max-concurrency-slider"), {
				target: { value: "4" },
			})
		},
	},
	prompts: {
		tab: "prompts",
		edit: (content) => {
			fireEvent.click(checkbox(content, "prompts:supportPrompts.enhance.includeTaskHistory"))
		},
	},
	ui: {
		tab: "ui",
		edit: (content) => {
			fireEvent.click(within(content).getByTestId("enter-behavior-checkbox"))
		},
	},
	experimental: {
		tab: "experimental",
		edit: (content) => {
			fireEvent.click(checkbox(content, "settings:experimental.PREVENT_FOCUS_DISRUPTION.name"))
		},
	},
	language: {
		tab: "language",
		edit: (content) => {
			fireEvent.change(within(content).getByTestId("select-input"), { target: { value: "de" } })
		},
	},
	about: {
		tab: "about",
		edit: (content) => {
			fireEvent.click(checkbox(content, "settings:about.debugMode.label"))
		},
	},
}

describe("SettingsView Save buffer through the real sections", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockState.current = baseState()
	})

	it.each(Object.keys(EDITS))("%s: an edit marks the form dirty and Save posts the pinned messages", (name) => {
		const { tab, edit } = EDITS[name]
		renderView()
		const content = openTab(tab)
		const saveButton = screen.getByTestId("save-button")
		expect(saveButton).toBeDisabled()

		// Only what the edit and Save post, not the requests a tab sends on mount.
		vi.mocked(vscode.postMessage).mockClear()
		edit(content)
		expect(saveButton).toBeEnabled()
		const immediate = postedMessages()

		vi.mocked(vscode.postMessage).mockClear()
		fireEvent.click(saveButton)
		expect({ immediate, save: postedMessages() }).toMatchSnapshot()
		expect(saveButton).toBeDisabled()
	})

	it("the buffer, not the live state, drives the control after an edit", () => {
		renderView()
		const content = openTab("notifications")
		const sound = within(content).getByTestId("sound-enabled-checkbox")
		expect(sound).not.toBeChecked()

		fireEvent.click(sound)
		expect(sound).toBeChecked()
		// The live state never changed: the edit lives in the buffer only.
		expect(mockState.current.soundEnabled).toBe(false)
		expect(vscode.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "updateSettings" }))
	})

	it("discarding restores every edited field and clears the dirty flag", async () => {
		const { onDone } = renderView()
		let content = openTab("ui")
		fireEvent.click(within(content).getByTestId("enter-behavior-checkbox"))
		fireEvent.click(within(content).getByTestId("collapse-thinking-checkbox"))
		expect(within(content).getByTestId("enter-behavior-checkbox")).toBeChecked()
		expect(within(content).getByTestId("collapse-thinking-checkbox")).not.toBeChecked()

		fireEvent.click(screen.getByRole("button", { name: "settings:common.done" }))
		expect(onDone).not.toHaveBeenCalled()
		await act(async () => {
			fireEvent.click(await screen.findByText("settings:unsavedChangesDialog.discardButton"))
		})
		expect(onDone).toHaveBeenCalledTimes(1)

		content = screen.getByTestId("settings-content")
		expect(within(content).getByTestId("enter-behavior-checkbox")).not.toBeChecked()
		expect(within(content).getByTestId("collapse-thinking-checkbox")).toBeChecked()
		expect(screen.getByTestId("save-button")).toBeDisabled()

		// Another tab sees the restored buffer too.
		content = openTab("notifications")
		expect(within(content).getByTestId("sound-enabled-checkbox")).not.toBeChecked()
	})

	it("cancelling the discard dialog keeps the edit and the dirty flag", async () => {
		const { onDone } = renderView()
		const content = openTab("web")
		fireEvent.click(within(content).getByTestId("web-tools-enabled-checkbox"))

		fireEvent.click(screen.getByRole("button", { name: "settings:common.done" }))
		await act(async () => {
			fireEvent.click(await screen.findByText("settings:unsavedChangesDialog.cancelButton"))
		})
		expect(onDone).not.toHaveBeenCalled()
		expect(within(screen.getByTestId("settings-content")).getByTestId("web-tools-enabled-checkbox")).toBeChecked()
		expect(screen.getByTestId("save-button")).toBeEnabled()
	})

	it("an edit survives switching tabs and back", () => {
		renderView()
		let content = openTab("web")
		fireEvent.click(within(content).getByTestId("web-tools-enabled-checkbox"))
		openTab("about")
		content = openTab("web")
		expect(within(content).getByTestId("web-tools-enabled-checkbox")).toBeChecked()
		expect(screen.getByTestId("save-button")).toBeEnabled()
	})
})
