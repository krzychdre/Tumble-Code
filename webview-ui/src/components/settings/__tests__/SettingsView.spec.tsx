// The Settings view over its Save buffer (the cachedState rule of AGENTS.md):
// the real sections read and write the buffer through useSetting, Save posts
// it, discarding restores it, and a profile switch or an import replaces it.
//
// Every section is the real component; the host, the translations, the
// Providers tab and the Radix widgets jsdom cannot drive (slider, select) are
// replaced. The lazy Modes/MCP tabs and search: SettingsView.lazy-tabs.spec.tsx.

import { act, fireEvent, render, screen, within } from "@/utils/test-utils"

import { vscode } from "@src/utils/vscode"

import SettingsView from "../SettingsView"
import { buildUpdatedSettings, pickCachedSettings } from "../schema"

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

// The Providers tab: stand-ins that call SettingsView's callbacks the way the
// real profile manager and provider form do.
vi.mock("../ApiConfigManager", () => ({
	default: ({ onSelectConfig, onDeleteConfig, onRenameConfig, onUpsertConfig }: any) => (
		<div>
			<button onClick={() => onSelectConfig("other-profile")}>select-profile</button>
			<button onClick={() => onDeleteConfig("old-profile")}>delete-profile</button>
			<button onClick={() => onRenameConfig("default", "renamed")}>rename-profile</button>
			<button onClick={() => onUpsertConfig("new-profile")}>upsert-profile</button>
		</div>
	),
}))
vi.mock("../ApiOptions", () => ({
	default: ({ apiConfiguration, setApiConfigurationField, setErrorMessage }: any) => (
		<div>
			<span data-testid="model-id">{apiConfiguration?.apiModelId ?? ""}</span>
			<button data-testid="edit-model" onClick={() => setApiConfigurationField("apiModelId", "user-edit")}>
				edit
			</button>
			<button data-testid="set-error" onClick={() => setErrorMessage("invalid key")}>
				error
			</button>
		</div>
	),
}))
vi.mock("../SettingsSearch", () => ({ SettingsSearch: () => null }))
vi.mock("@src/components/modes/ModesView", () => ({
	default: ({ onSelectApiConfiguration }: { onSelectApiConfiguration: (name: string) => void }) => (
		<button data-testid="modes-select-profile" onClick={() => onSelectApiConfiguration("other-profile")}>
			select profile in Modes
		</button>
	),
}))
vi.mock("@src/components/mcp/McpView", () => ({ default: () => null }))

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
// swapped field shows in the Save payload.
const baseState = () => ({
	currentApiConfigName: "default",
	listApiConfigMeta: [{ id: "p1", name: "default", apiProvider: "anthropic" }],
	uriScheme: "vscode",
	settingsImportedAt: undefined as number | undefined,
	apiConfiguration: { apiProvider: "anthropic", apiModelId: "live-model" },
	debug: false,
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
	enableCheckpoints: true,
	checkpointTimeout: 20,
	autoMemoryEnabled: true,
	autoMemoryDirectory: "/mem",
	memoryRecallEnabled: true,
	autoDreamEnabled: false,
	autoDreamMinHours: 12,
	autoDreamMinSessions: 3,
	memoryWriterApiConfigId: "",
	webToolsEnabled: false,
	searxngBaseUrl: "http://searx.local",
	webSearchMaxResults: 7,
	soundEnabled: false,
	soundVolume: 0.4,
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
	terminalOutputPreviewSize: "medium",
	terminalShellIntegrationTimeout: 8000,
	terminalShellIntegrationDisabled: true,
	terminalCommandDelay: 0,
	terminalZshOhMy: false,
	parallelTasksMaxConcurrency: 2,
	subagentFollowupTimeoutSec: 30,
	includeTaskHistoryInEnhance: false,
	enhancementApiConfigId: "",
	setEnhancementApiConfigId: vi.fn(),
	setIncludeTaskHistoryInEnhance: vi.fn(),
	reasoningBlockCollapsed: true,
	enterBehavior: "send",
	uiDensity: "comfortable",
	experiments: { preventFocusDisruption: false },
	language: "en",
})

// A new onDone wrapper per element: SettingsView is memoized, and the mocked
// state is no context, so only new props make a rerender reach it.
const view = (props: { onDone?: () => void; targetSection?: string } = {}) => (
	<SettingsView onDone={() => props.onDone?.()} targetSection={props.targetSection} />
)

const renderView = (props: { targetSection?: string } = {}) => {
	const onDone = vi.fn()
	const result = render(view({ onDone, ...props }))
	// A host state push: the view re-renders with the new live state.
	const pushState = (patch: Record<string, unknown>) => {
		mockState.current = { ...mockState.current, ...patch }
		result.rerender(view({ onDone, ...props }))
	}
	return { onDone, pushState, rerender: result.rerender }
}

const openTab = (id: string) => {
	fireEvent.click(screen.getByTestId(`tab-${id}`))
	return screen.getByTestId("settings-content")
}

const content = () => screen.getByTestId("settings-content")
const saveButton = () => screen.getByTestId("save-button")
const checkbox = (name: string) => within(content()).getByRole("checkbox", { name })
const byTestId = (id: string) => within(content()).getByTestId(id)
const postedMessages = () => vi.mocked(vscode.postMessage).mock.calls.map(([message]) => message as any)
const messagesOfType = (type: string) => postedMessages().filter((message) => message.type === type)
const dialogTitle = () => screen.queryByText("settings:unsavedChangesDialog.title")
const isMarked = (id: string) => screen.getByTestId(`tab-${id}`).getAttribute("data-unsaved") === "true"

/** The keys of a Save payload that differ from the payload of the untouched state. */
const changedKeys = (payload: Record<string, unknown>) => {
	const untouched = buildUpdatedSettings(pickCachedSettings(baseState() as never)) as Record<string, unknown>
	return Object.fromEntries(
		Object.entries(payload).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(untouched[key])),
	)
}

// One edit per section, through the control a user would use: what the edit
// posts at once and which keys of the Save payload it changes.
const EDITS: { tab: string; edit: () => void; immediate: unknown[]; changed: Record<string, unknown> }[] = [
	{
		tab: "autoApprove",
		edit: () => {
			fireEvent.click(checkbox("settings:autoApprove.readOnly.outsideWorkspace.label"))
			fireEvent.change(byTestId("command-input"), { target: { value: "npm test" } })
			fireEvent.click(byTestId("add-command-button"))
		},
		immediate: [{ type: "updateSettings", updatedSettings: { allowedCommands: ["git status", "npm test"] } }],
		changed: { allowedCommands: ["git status", "npm test"], alwaysAllowReadOnlyOutsideWorkspace: true },
	},
	{
		tab: "checkpoints",
		edit: () => fireEvent.change(byTestId("checkpoint-timeout-slider"), { target: { value: "42" } }),
		immediate: [],
		changed: { checkpointTimeout: 42 },
	},
	{
		tab: "memory",
		edit: () => fireEvent.input(byTestId("memory-directory-input"), { target: { value: "/other" } }),
		immediate: [],
		changed: { autoMemoryDirectory: "/other" },
	},
	{
		tab: "web",
		edit: () => fireEvent.click(byTestId("web-tools-enabled-checkbox")),
		immediate: [],
		changed: { webToolsEnabled: true },
	},
	{
		tab: "notifications",
		edit: () => fireEvent.click(byTestId("sound-enabled-checkbox")),
		immediate: [],
		changed: { soundEnabled: true },
	},
	{
		tab: "contextManagement",
		edit: () => {
			fireEvent.click(byTestId("show-rooignored-files-checkbox"))
			fireEvent.change(byTestId("write-delay-slider"), { target: { value: "100" } })
		},
		immediate: [],
		changed: { showRooIgnoredFiles: true, writeDelayMs: 100 },
	},
	{
		tab: "terminal",
		edit: () => fireEvent.click(checkbox("settings:terminal.shellIntegrationDisabled.label")),
		immediate: [],
		changed: { terminalShellIntegrationDisabled: false },
	},
	{
		tab: "subagents",
		edit: () => fireEvent.change(byTestId("subagents-max-concurrency-slider"), { target: { value: "4" } }),
		immediate: [],
		changed: { parallelTasksMaxConcurrency: 4 },
	},
	{
		tab: "prompts",
		edit: () => fireEvent.click(checkbox("prompts:supportPrompts.enhance.includeTaskHistory")),
		immediate: [{ type: "updateSettings", updatedSettings: { includeTaskHistoryInEnhance: true } }],
		changed: { includeTaskHistoryInEnhance: true },
	},
	{
		tab: "ui",
		edit: () => fireEvent.click(byTestId("enter-behavior-checkbox")),
		immediate: [],
		changed: { enterBehavior: "newline" },
	},
	{
		tab: "experimental",
		edit: () => fireEvent.click(checkbox("settings:experimental.PREVENT_FOCUS_DISRUPTION.name")),
		immediate: [],
		changed: { experiments: { preventFocusDisruption: true } },
	},
	{
		tab: "language",
		edit: () => fireEvent.change(byTestId("select-input"), { target: { value: "de" } }),
		immediate: [],
		changed: { language: "de" },
	},
]

beforeEach(() => {
	vi.clearAllMocks()
	mockState.current = baseState()
})

describe("SettingsView Save buffer through the real sections", () => {
	it.each(EDITS)("$tab: an edit marks the form dirty and Save sends it", ({ tab, edit, immediate, changed }) => {
		renderView()
		openTab(tab)
		expect(saveButton()).toBeDisabled()

		// Only what the edit and Save post, not the requests a tab sends on mount.
		vi.mocked(vscode.postMessage).mockClear()
		edit()
		expect(saveButton()).toBeEnabled()
		expect(postedMessages()).toEqual(immediate)

		vi.mocked(vscode.postMessage).mockClear()
		fireEvent.click(saveButton())
		const [update] = messagesOfType("updateSettings")
		expect(changedKeys(update.updatedSettings)).toEqual(changed)
		expect(saveButton()).toBeDisabled()
	})

	it("Save posts the settings, then the provider profile, then the debug flag", () => {
		renderView()
		openTab("about")
		fireEvent.click(checkbox("settings:about.debugMode.label"))
		vi.mocked(vscode.postMessage).mockClear()

		fireEvent.click(saveButton())

		expect(postedMessages().map((message) => message.type)).toEqual([
			"updateSettings",
			"upsertApiConfiguration",
			"debugSetting",
		])
		expect(postedMessages()[1]).toEqual({
			type: "upsertApiConfiguration",
			text: "default",
			apiConfiguration: { apiProvider: "anthropic", apiModelId: "live-model" },
		})
		expect(postedMessages()[2]).toEqual({ type: "debugSetting", bool: true })
	})

	// The host writes the picked profile into the state; Save must be possible meanwhile.
	it("opening the terminal profile picker enables Save without changing a value", () => {
		mockState.current.terminalShellIntegrationDisabled = false
		renderView()
		openTab("terminal")

		fireEvent.click(byTestId("terminal-profile-configure-button"))

		expect(postedMessages()).toContainEqual({ type: "openTerminalProfilePicker" })
		expect(saveButton()).toBeEnabled()
	})

	it("the buffer, not the live state, drives the control after an edit", () => {
		renderView()
		openTab("notifications")
		const sound = byTestId("sound-enabled-checkbox")

		fireEvent.click(sound)

		expect(sound).toBeChecked()
		expect(mockState.current.soundEnabled).toBe(false)
		expect(messagesOfType("updateSettings")).toEqual([])
	})

	it("an edit survives switching tabs and back", () => {
		renderView()
		fireEvent.click(within(openTab("web")).getByTestId("web-tools-enabled-checkbox"))
		openTab("about")

		expect(within(openTab("web")).getByTestId("web-tools-enabled-checkbox")).toBeChecked()
		expect(saveButton()).toBeEnabled()
	})

	it("Done without edits leaves at once", () => {
		const { onDone } = renderView()

		fireEvent.click(screen.getByRole("button", { name: "settings:common.done" }))

		expect(onDone).toHaveBeenCalledTimes(1)
		expect(dialogTitle()).toBeNull()
	})

	it("discarding restores every edited field, clears the dirty flag and then leaves", async () => {
		const { onDone } = renderView()
		openTab("ui")
		fireEvent.click(byTestId("enter-behavior-checkbox"))
		fireEvent.click(byTestId("collapse-thinking-checkbox"))

		fireEvent.click(screen.getByRole("button", { name: "settings:common.done" }))
		expect(onDone).not.toHaveBeenCalled()
		await act(async () => {
			fireEvent.click(await screen.findByText("settings:unsavedChangesDialog.discardButton"))
		})

		expect(onDone).toHaveBeenCalledTimes(1)
		expect(byTestId("enter-behavior-checkbox")).not.toBeChecked()
		expect(byTestId("collapse-thinking-checkbox")).toBeChecked()
		expect(saveButton()).toBeDisabled()
	})

	it("cancelling the discard dialog keeps the edit and the dirty flag", async () => {
		const { onDone } = renderView()
		fireEvent.click(within(openTab("web")).getByTestId("web-tools-enabled-checkbox"))

		fireEvent.click(screen.getByRole("button", { name: "settings:common.done" }))
		await act(async () => {
			fireEvent.click(await screen.findByText("settings:unsavedChangesDialog.cancelButton"))
		})

		expect(onDone).not.toHaveBeenCalled()
		expect(byTestId("web-tools-enabled-checkbox")).toBeChecked()
		expect(saveButton()).toBeEnabled()
	})

	it("an invalid provider form disables Save", () => {
		renderView()
		fireEvent.click(screen.getByTestId("edit-model"))
		expect(saveButton()).toBeEnabled()

		fireEvent.click(screen.getByTestId("set-error"))

		expect(saveButton()).toBeDisabled()
	})
})

// §2.10: a dot on Save and on each tab with unsaved edits.
describe("SettingsView unsaved-edit dots", () => {
	it("marks Save and every edited tab, names it for screen readers, and clears all on Save", () => {
		renderView()
		const saveDot = () => within(saveButton()).queryByTestId("unsaved-dot")
		expect(saveDot()).toBeNull()

		fireEvent.click(within(openTab("web")).getByTestId("web-tools-enabled-checkbox"))
		fireEvent.click(within(openTab("notifications")).getByTestId("sound-enabled-checkbox"))

		expect(saveDot()).not.toBeNull()
		expect([isMarked("web"), isMarked("notifications"), isMarked("terminal")]).toEqual([true, true, false])
		expect(within(screen.getByTestId("tab-web")).getByText("settings:header.unsavedChanges")).toHaveClass("sr-only")

		fireEvent.click(saveButton())

		expect([isMarked("web"), isMarked("notifications")]).toEqual([false, false])
		expect(saveDot()).toBeNull()
	})
})

describe("SettingsView provider profiles", () => {
	it.each([
		["select-profile", { type: "loadApiConfiguration", text: "other-profile" }],
		["delete-profile", { type: "deleteApiConfiguration", text: "old-profile" }],
		[
			"rename-profile",
			{
				type: "renameApiConfiguration",
				values: { oldName: "default", newName: "renamed" },
				apiConfiguration: { apiProvider: "anthropic", apiModelId: "live-model" },
			},
		],
		[
			"upsert-profile",
			{
				type: "upsertApiConfiguration",
				text: "new-profile",
				apiConfiguration: { apiProvider: "anthropic", apiModelId: "live-model" },
			},
		],
	])("%s posts %o", (button, message) => {
		renderView()

		fireEvent.click(screen.getByText(button))

		expect(postedMessages()).toEqual([message])
	})

	it("a renamed profile is not mistaken for a profile switch: the edits stay", () => {
		const { pushState } = renderView()
		fireEvent.click(screen.getByTestId("edit-model"))
		fireEvent.click(screen.getByText("rename-profile"))

		pushState({ currentApiConfigName: "renamed" })

		expect(screen.getByTestId("model-id").textContent).toBe("user-edit")
		expect(saveButton()).toBeEnabled()
	})

	it("a loaded profile (new currentApiConfigName) replaces the Save buffer and clears the unsaved flag", () => {
		const { pushState } = renderView()
		fireEvent.click(screen.getByTestId("edit-model"))

		pushState({ currentApiConfigName: "other", apiConfiguration: { apiProvider: "openai", apiModelId: "gpt" } })

		expect(screen.getByTestId("model-id").textContent).toBe("gpt")
		expect(saveButton()).toBeDisabled()
	})

	// The Modes tab has its own profile picker; a loaded profile overwrites the
	// Save buffer, so it must ask first like the Providers tab does.
	const editThenPickProfileInModesTab = async () => {
		renderView()
		fireEvent.click(screen.getByTestId("edit-model"))
		openTab("modes")
		fireEvent.click(await screen.findByTestId("modes-select-profile"))
	}

	it("asks before discarding unsaved edits and loads the profile only on confirm", async () => {
		await editThenPickProfileInModesTab()

		expect(await screen.findByText("settings:unsavedChangesDialog.title")).toBeInTheDocument()
		expect(messagesOfType("loadApiConfiguration")).toEqual([])

		fireEvent.click(screen.getByText("settings:unsavedChangesDialog.discardButton"))

		expect(messagesOfType("loadApiConfiguration")).toEqual([
			{ type: "loadApiConfiguration", text: "other-profile" },
		])
	})

	it("keeps the unsaved edits and the current profile when the user cancels", async () => {
		await editThenPickProfileInModesTab()

		fireEvent.click(await screen.findByText("settings:unsavedChangesDialog.cancelButton"))

		expect(messagesOfType("loadApiConfiguration")).toEqual([])
		expect(saveButton()).toBeEnabled()
	})

	it("loads the profile at once when nothing is unsaved", async () => {
		renderView()
		openTab("modes")
		fireEvent.click(await screen.findByTestId("modes-select-profile"))

		expect(dialogTitle()).toBeNull()
		expect(messagesOfType("loadApiConfiguration")).toEqual([
			{ type: "loadApiConfiguration", text: "other-profile" },
		])
	})
})

// The host sets settingsImportedAt for one state push after an import and then
// clears it with `undefined`, which postMessage drops: every later push still
// carries the same, stale timestamp.
describe("SettingsView settings import signal (settingsImportedAt)", () => {
	it("keeps an edit made after an import when an unrelated state update arrives", () => {
		const { pushState } = renderView()
		pushState({ settingsImportedAt: 1000, apiConfiguration: { apiProvider: "openai", apiModelId: "imported" } })
		expect(screen.getByTestId("model-id").textContent).toBe("imported")

		fireEvent.click(screen.getByTestId("edit-model"))
		pushState({ soundEnabled: true })

		expect(screen.getByTestId("model-id").textContent).toBe("user-edit")
		expect(saveButton()).toBeEnabled()
	})

	it("resets the Save buffer once for each new import", () => {
		const { pushState } = renderView()
		fireEvent.click(screen.getByTestId("edit-model"))

		pushState({ settingsImportedAt: 1000, apiConfiguration: { apiProvider: "openai", apiModelId: "first" } })
		expect(screen.getByTestId("model-id").textContent).toBe("first")
		expect(saveButton()).toBeDisabled()

		fireEvent.click(screen.getByTestId("edit-model"))
		pushState({ settingsImportedAt: 2000, apiConfiguration: { apiProvider: "openai", apiModelId: "second" } })
		expect(screen.getByTestId("model-id").textContent).toBe("second")
		expect(saveButton()).toBeDisabled()
	})
})

describe("SettingsView target section", () => {
	it("opens the tab the host names, and ignores a name that is no tab", () => {
		const { rerender } = renderView({ targetSection: "web" })
		expect(byTestId("web-tools-enabled-checkbox")).toBeInTheDocument()

		rerender(view({ targetSection: "notifications" }))
		expect(byTestId("sound-enabled-checkbox")).toBeInTheDocument()

		rerender(view({ targetSection: "no-such-tab" }))
		expect(byTestId("sound-enabled-checkbox")).toBeInTheDocument()
	})
})
