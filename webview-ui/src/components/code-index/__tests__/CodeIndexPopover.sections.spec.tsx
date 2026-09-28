/**
 * Characterization of the CodeIndexPopover form sections (roadmap item S5), written before the
 * popover was split into section components and a settings hook:
 * - status: the status line, the progress bar and which workspace's updates count;
 * - enable toggle, workspace toggles and the action buttons for each indexing state;
 * - setup: switching the embedder provider (model cleared, Bedrock region/profile filled);
 * - advanced: the two sliders and their reset buttons;
 * - save: the host's answer, and the discard dialog when closing with unsaved edits.
 * The per-provider fields and their validation are pinned in CodeIndexPopover.per-provider.spec.tsx.
 */

import React from "react"

import { act, fireEvent, render, renderHook, screen, waitFor } from "@/utils/test-utils"
import { PopoverTrigger } from "@/components/ui"
import { vscode } from "@/utils/vscode"

import { CODEBASE_INDEX_DEFAULTS, type IndexingStatus } from "@roo-code/types"

import { CodeIndexPopover } from "../CodeIndexPopover"
import { useCodeIndexSettings } from "../useCodeIndexSettings"

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

const mockExtensionState: any = {}

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionSelector: (selector: (s: never) => unknown) => selector(mockExtensionState as never),

	useExtensionState: () => mockExtensionState,
}))

const QDRANT_URL = "http://qdrant.local:6333"

const status = (overrides: Partial<IndexingStatus> = {}): IndexingStatus => ({
	systemStatus: "Standby",
	message: "",
	processedItems: 0,
	totalItems: 0,
	currentItemUnit: "items",
	...overrides,
})

/** A complete, valid OpenAI configuration: Save only needs an edit to become enabled. */
const savedConfig = {
	codebaseIndexEnabled: true,
	codebaseIndexQdrantUrl: QDRANT_URL,
	codebaseIndexEmbedderProvider: "openai",
	codebaseIndexEmbedderModelId: "text-embedding-3-small",
}

function resetState(overrides: Record<string, unknown> = {}) {
	for (const key of Object.keys(mockExtensionState)) delete mockExtensionState[key]
	Object.assign(mockExtensionState, {
		codebaseIndexConfig: savedConfig,
		codebaseIndexModels: { openai: { "text-embedding-3-small": { dimension: 1536 } } },
		cwd: "/workspace",
		apiConfiguration: {},
		...overrides,
	})
}

const popover = (indexingStatus: IndexingStatus) => (
	<CodeIndexPopover indexingStatus={indexingStatus}>
		<PopoverTrigger asChild>
			<button>open-popover</button>
		</PopoverTrigger>
	</CodeIndexPopover>
)

const hostMessage = (data: Record<string, unknown>) =>
	act(() => {
		window.dispatchEvent(new MessageEvent("message", { data }))
	})

function renderOpen(indexingStatus: IndexingStatus = status()) {
	const result = render(popover(indexingStatus))
	fireEvent.click(screen.getByText("open-popover"))
	// The saved OpenAI key exists on the host, so the form is valid without typing it.
	hostMessage({ type: "codeIndexSecretStatus", values: { hasOpenAiKey: true } })
	return result
}

const posted = () => vi.mocked(vscode.postMessage).mock.calls.map(([m]) => m as any)
const postedOfType = (type: string) => posted().filter((m) => m.type === type)

const saveButton = () => screen.getByText("settings:codeIndex.saveSettings").closest("button")!

const openSetup = () => fireEvent.click(screen.getByText("settings:codeIndex.setupConfigLabel"))
const openAdvanced = () => fireEvent.click(screen.getByText("settings:codeIndex.advancedConfigLabel"))

const typeQdrantUrl = (value: string) =>
	fireEvent.input(screen.getByPlaceholderText("settings:codeIndex.qdrantUrlPlaceholder"), { target: { value } })

describe("CodeIndexPopover sections", () => {
	beforeEach(() => {
		vi.mocked(vscode.postMessage).mockClear()
		resetState()
	})

	describe("opening", () => {
		it("asks the host for the indexing status and the secret status", () => {
			renderOpen()
			expect(posted()).toContainEqual({ type: "requestIndexingStatus" })
			expect(postedOfType("requestCodeIndexSecretStatus").length).toBeGreaterThan(0)
		})

		it("asks again when the workspace changes while open", () => {
			renderOpen()
			vi.mocked(vscode.postMessage).mockClear()
			hostMessage({ type: "workspaceUpdated" })
			expect(posted()).toEqual([{ type: "requestIndexingStatus" }, { type: "requestCodeIndexSecretStatus" }])
		})

		it("remembers which disclosures were open after the popover is closed and opened again", () => {
			renderOpen()
			openSetup()
			expect(screen.getByPlaceholderText("settings:codeIndex.qdrantUrlPlaceholder")).toBeInTheDocument()

			fireEvent.keyDown(window, { key: "Escape" })
			expect(screen.queryByText("settings:codeIndex.title")).not.toBeInTheDocument()

			fireEvent.click(screen.getByText("open-popover"))
			expect(screen.getByPlaceholderText("settings:codeIndex.qdrantUrlPlaceholder")).toBeInTheDocument()
			expect(screen.queryByTestId("search-min-score-slider")).not.toBeInTheDocument()
		})
	})

	describe("status", () => {
		it("shows the status and message, and a progress bar only while indexing", () => {
			const { rerender } = renderOpen(status({ systemStatus: "Indexed", message: "Done" }))
			expect(screen.getByText(/settings:codeIndex\.indexingStatuses\.indexed - Done/)).toBeInTheDocument()
			expect(document.querySelector("[style*=translateX]")).toBeNull()

			rerender(popover(status({ systemStatus: "Indexing", processedItems: 1, totalItems: 4 })))
			expect(screen.getByText(/settings:codeIndex\.indexingStatuses\.indexing/)).toBeInTheDocument()
			const indicator = document.querySelector("[style*=translateX]") as HTMLElement
			expect(indicator.style.transform).toBe("translateX(-75%)")
		})

		it("applies status updates for this workspace or without a workspace, ignores other workspaces", () => {
			renderOpen()
			hostMessage({
				type: "indexingStatusUpdate",
				values: { systemStatus: "Indexed", message: "other", workspacePath: "/elsewhere" },
			})
			expect(screen.queryByText(/ - other/)).not.toBeInTheDocument()

			hostMessage({
				type: "indexingStatusUpdate",
				values: { systemStatus: "Indexed", message: "mine", workspacePath: "/workspace" },
			})
			expect(screen.getByText(/settings:codeIndex\.indexingStatuses\.indexed - mine/)).toBeInTheDocument()

			hostMessage({
				type: "indexingStatusUpdate",
				values: { systemStatus: "Error", message: "global", processedItems: 0, totalItems: 0 },
			})
			expect(screen.getByText(/settings:codeIndex\.indexingStatuses\.error - global/)).toBeInTheDocument()
		})
	})

	describe("enable toggle and workspace toggles", () => {
		it("posts the auto-enable and workspace toggles and explains a disabled workspace", () => {
			renderOpen(status({ autoEnableDefault: false, workspaceEnabled: false }))
			expect(screen.getByText("settings:codeIndex.workspaceDisabledMessage")).toBeInTheDocument()

			const autoEnable = document.getElementById("auto-enable-default-toggle") as HTMLInputElement
			const workspace = document.getElementById("workspace-indexing-toggle") as HTMLInputElement
			expect(autoEnable.checked).toBe(false)
			expect(workspace.checked).toBe(false)

			fireEvent.click(autoEnable)
			fireEvent.click(workspace)
			expect(posted()).toContainEqual({ type: "setAutoEnableDefault", bool: true })
			expect(posted()).toContainEqual({ type: "toggleWorkspaceIndexing", bool: true })
		})

		it("defaults auto-enable to on and hides the disabled message for an enabled workspace", () => {
			renderOpen(status({ workspaceEnabled: true }))
			expect((document.getElementById("auto-enable-default-toggle") as HTMLInputElement).checked).toBe(true)
			expect(screen.queryByText("settings:codeIndex.workspaceDisabledMessage")).not.toBeInTheDocument()
		})

		it("unticking the enable box hides the toggles and actions and makes Save available", () => {
			renderOpen(status({ systemStatus: "Standby" }))
			expect(saveButton()).toBeDisabled()
			expect(screen.getByText("settings:codeIndex.startIndexingButton")).toBeInTheDocument()

			const enable = screen
				.getByText("settings:codeIndex.enableLabel")
				.closest("label")!
				.querySelector("input[type=checkbox]") as HTMLInputElement
			fireEvent.click(enable)

			expect(document.getElementById("auto-enable-default-toggle")).toBeNull()
			expect(document.getElementById("workspace-indexing-toggle")).toBeNull()
			expect(screen.queryByText("settings:codeIndex.startIndexingButton")).not.toBeInTheDocument()
			expect(saveButton()).toBeEnabled()

			fireEvent.click(saveButton())
			expect(postedOfType("saveCodeIndexSettingsAtomic")[0].codeIndexSettings).toEqual(
				expect.objectContaining({ codebaseIndexEnabled: false }),
			)
		})
	})

	describe("action buttons", () => {
		it("Standby: Start posts startIndexing and is disabled while there are unsaved edits", () => {
			renderOpen(status({ systemStatus: "Standby" }))
			const start = screen.getByText("settings:codeIndex.startIndexingButton").closest("button")!
			fireEvent.click(start)
			expect(posted()).toContainEqual({ type: "startIndexing" })

			openSetup()
			typeQdrantUrl("http://changed:6333")
			expect(screen.getByText("settings:codeIndex.startIndexingButton").closest("button")).toBeDisabled()
		})

		it("Indexing: Stop posts stopIndexing; Stopping: a disabled button", () => {
			const { rerender } = renderOpen(status({ systemStatus: "Indexing", totalItems: 2 }))
			expect(screen.queryByText("settings:codeIndex.startIndexingButton")).not.toBeInTheDocument()
			fireEvent.click(screen.getByText("settings:codeIndex.stopIndexingButton"))
			expect(posted()).toContainEqual({ type: "stopIndexing" })

			rerender(popover(status({ systemStatus: "Stopping" })))
			expect(screen.getByText("settings:codeIndex.stoppingButton").closest("button")).toBeDisabled()
		})

		it("Indexed: clearing the index asks for confirmation first", async () => {
			renderOpen(status({ systemStatus: "Indexed" }))
			expect(screen.queryByText("settings:codeIndex.startIndexingButton")).not.toBeInTheDocument()

			fireEvent.click(screen.getByText("settings:codeIndex.clearIndexDataButton"))
			expect(postedOfType("clearIndexData")).toHaveLength(0)
			fireEvent.click(await screen.findByText("settings:codeIndex.clearDataDialog.confirmButton"))
			expect(posted()).toContainEqual({ type: "clearIndexData" })
		})

		it("Error: both Start and Clear are offered", () => {
			renderOpen(status({ systemStatus: "Error" }))
			expect(screen.getByText("settings:codeIndex.startIndexingButton")).toBeInTheDocument()
			expect(screen.getByText("settings:codeIndex.clearIndexDataButton")).toBeInTheDocument()
		})
	})

	describe("setup: embedder provider", () => {
		const chooseProvider = async (label: string) => {
			const trigger = screen
				.getByText("settings:codeIndex.embedderProviderLabel")
				.parentElement!.querySelector("button[role=combobox]") as HTMLElement
			fireEvent.keyDown(trigger, { key: "Enter" })
			fireEvent.click(await screen.findByRole("option", { name: label }))
		}

		it("clears the model when the provider changes", async () => {
			renderOpen()
			openSetup()
			await chooseProvider("settings:codeIndex.ollamaProvider")

			expect(screen.getByPlaceholderText("settings:codeIndex.ollamaUrlPlaceholder")).toBeInTheDocument()
			expect((screen.getByPlaceholderText("settings:codeIndex.modelPlaceholder") as HTMLInputElement).value).toBe(
				"",
			)
		})

		it("fills an empty Bedrock region and profile from a Bedrock API profile", async () => {
			resetState({
				apiConfiguration: { apiProvider: "bedrock", awsRegion: "eu-west-1", awsProfile: "work" },
			})
			renderOpen()
			openSetup()
			await chooseProvider("settings:codeIndex.bedrockProvider")

			expect(
				(screen.getByPlaceholderText("settings:codeIndex.bedrockRegionPlaceholder") as HTMLInputElement).value,
			).toBe("eu-west-1")
			expect(
				(screen.getByPlaceholderText("settings:codeIndex.bedrockProfilePlaceholder") as HTMLInputElement).value,
			).toBe("work")
		})

		it("does not fill Bedrock fields from a non-Bedrock API profile", async () => {
			resetState({ apiConfiguration: { apiProvider: "openai", awsRegion: "eu-west-1" } })
			renderOpen()
			openSetup()
			await chooseProvider("settings:codeIndex.bedrockProvider")

			expect(
				(screen.getByPlaceholderText("settings:codeIndex.bedrockRegionPlaceholder") as HTMLInputElement).value,
			).toBe("")
		})

		it("shows the Qdrant API key field as a password field and sends a typed key", () => {
			renderOpen()
			openSetup()
			const key = screen.getByPlaceholderText("settings:codeIndex.qdrantApiKeyPlaceholder") as HTMLInputElement
			expect(key.type).toBe("password")
			fireEvent.input(key, { target: { value: "qd-key" } })
			fireEvent.click(saveButton())
			expect(postedOfType("saveCodeIndexSettingsAtomic")[0].codeIndexSettings.codeIndexQdrantApiKey).toBe(
				"qd-key",
			)
		})
	})

	describe("advanced sliders", () => {
		it("shows the defaults, follows keyboard edits and resets to the defaults", () => {
			renderOpen()
			openAdvanced()

			const minScore = screen.getByTestId("search-min-score-slider")
			const maxResults = screen.getByTestId("search-max-results-slider")
			const minScoreValue = minScore.nextElementSibling as HTMLElement
			const maxResultsValue = maxResults.nextElementSibling as HTMLElement
			expect(minScoreValue).toHaveTextContent(CODEBASE_INDEX_DEFAULTS.DEFAULT_SEARCH_MIN_SCORE.toFixed(2))
			expect(maxResultsValue).toHaveTextContent(String(CODEBASE_INDEX_DEFAULTS.DEFAULT_SEARCH_RESULTS))

			fireEvent.keyDown(minScore.querySelector("[role=slider]")!, { key: "ArrowRight" })
			fireEvent.keyDown(maxResults.querySelector("[role=slider]")!, { key: "ArrowRight" })
			expect(minScoreValue).toHaveTextContent(
				(CODEBASE_INDEX_DEFAULTS.DEFAULT_SEARCH_MIN_SCORE + CODEBASE_INDEX_DEFAULTS.SEARCH_SCORE_STEP).toFixed(
					2,
				),
			)
			expect(maxResultsValue).toHaveTextContent(
				String(CODEBASE_INDEX_DEFAULTS.DEFAULT_SEARCH_RESULTS + CODEBASE_INDEX_DEFAULTS.SEARCH_RESULTS_STEP),
			)
			expect(saveButton()).toBeEnabled()

			const resets = screen.getAllByTitle("settings:codeIndex.resetToDefault")
			fireEvent.click(resets[0])
			fireEvent.click(resets[1])
			expect(minScoreValue).toHaveTextContent(CODEBASE_INDEX_DEFAULTS.DEFAULT_SEARCH_MIN_SCORE.toFixed(2))
			expect(maxResultsValue).toHaveTextContent(String(CODEBASE_INDEX_DEFAULTS.DEFAULT_SEARCH_RESULTS))
			expect(saveButton()).toBeDisabled()
		})

		it("shows saved slider values from the configuration", () => {
			resetState({
				codebaseIndexConfig: {
					...savedConfig,
					codebaseIndexSearchMinScore: 0.7,
					codebaseIndexSearchMaxResults: 20,
				},
			})
			renderOpen()
			openAdvanced()
			expect(screen.getByTestId("search-min-score-slider").nextElementSibling).toHaveTextContent("0.70")
			expect(screen.getByTestId("search-max-results-slider").nextElementSibling).toHaveTextContent("20")
		})
	})

	describe("save and discard", () => {
		it("shows Saving while waiting, then a successful answer makes the form clean again", () => {
			renderOpen()
			openSetup()
			typeQdrantUrl("http://changed:6333")
			fireEvent.click(saveButton())

			expect(screen.getByText("settings:codeIndex.saving").closest("button")).toBeDisabled()
			expect(postedOfType("saveCodeIndexSettingsAtomic")[0].codeIndexSettings.codebaseIndexQdrantUrl).toBe(
				"http://changed:6333",
			)

			vi.mocked(vscode.postMessage).mockClear()
			hostMessage({ type: "codeIndexSettingsSaved", success: true })
			expect(saveButton()).toBeDisabled()
			expect(posted()).toContainEqual({ type: "requestCodeIndexSecretStatus" })

			// Closing now needs no confirmation.
			fireEvent.keyDown(window, { key: "Escape" })
			expect(screen.queryByText("settings:codeIndex.title")).not.toBeInTheDocument()
		})

		describe("a failed save", () => {
			afterEach(() => {
				vi.useRealTimers()
			})

			// The popover is opened with real timers; only the save answer runs on fake ones, so
			// the 5 second error timer can be stepped through.
			function failSave(error: string) {
				const result = renderOpen()
				openSetup()
				typeQdrantUrl("http://changed:6333")
				fireEvent.click(saveButton())
				vi.useFakeTimers()
				hostMessage({ type: "codeIndexSettingsSaved", success: false, error })
				return result
			}

			it("shows the error for 5 seconds, keeps the edits and lets the user save again", () => {
				failSave("disk full")

				expect(screen.getByText("disk full")).toBeInTheDocument()
				expect(saveButton()).toBeEnabled()
				expect(
					(screen.getByPlaceholderText("settings:codeIndex.qdrantUrlPlaceholder") as HTMLInputElement).value,
				).toBe("http://changed:6333")

				act(() => {
					vi.advanceTimersByTime(4999)
				})
				expect(screen.getByText("disk full")).toBeInTheDocument()

				act(() => {
					vi.advanceTimersByTime(1)
				})
				expect(screen.queryByText("disk full")).not.toBeInTheDocument()
				expect(saveButton()).toBeEnabled()
			})

			it("a new save during those 5 seconds is not reset to idle by the old timer", () => {
				failSave("disk full")

				fireEvent.click(saveButton())
				expect(screen.queryByText("disk full")).not.toBeInTheDocument()
				expect(screen.getByText("settings:codeIndex.saving").closest("button")).toBeDisabled()

				act(() => {
					vi.advanceTimersByTime(5000)
				})
				expect(screen.getByText("settings:codeIndex.saving").closest("button")).toBeDisabled()
			})

			it("unmounting clears the pending timer", () => {
				// The settings hook alone: the popover's own UI (Radix focus handling) also sets
				// timers on unmount, which would blur the count.
				vi.useFakeTimers()
				const { unmount } = renderHook(() => useCodeIndexSettings(undefined, (key: string) => key))
				hostMessage({ type: "codeIndexSettingsSaved", success: false, error: "disk full" })
				expect(vi.getTimerCount()).toBe(1)

				unmount()
				expect(vi.getTimerCount()).toBe(0)
			})
		})

		it("closing with unsaved edits asks first; cancel keeps them, discard resets and closes", async () => {
			renderOpen()
			openSetup()
			typeQdrantUrl("not-a-url")
			fireEvent.click(saveButton())
			expect(screen.getByText("settings:codeIndex.validation.invalidQdrantUrl")).toBeInTheDocument()

			fireEvent.keyDown(window, { key: "Escape" })
			expect(await screen.findByText("settings:unsavedChangesDialog.title")).toBeInTheDocument()
			fireEvent.click(screen.getByText("settings:unsavedChangesDialog.cancelButton"))
			await waitFor(() =>
				expect(screen.queryByText("settings:unsavedChangesDialog.title")).not.toBeInTheDocument(),
			)
			expect(
				(screen.getByPlaceholderText("settings:codeIndex.qdrantUrlPlaceholder") as HTMLInputElement).value,
			).toBe("not-a-url")

			fireEvent.keyDown(window, { key: "Escape" })
			fireEvent.click(await screen.findByText("settings:unsavedChangesDialog.discardButton"))
			await waitFor(() => expect(screen.queryByText("settings:codeIndex.title")).not.toBeInTheDocument())

			fireEvent.click(screen.getByText("open-popover"))
			expect(
				(screen.getByPlaceholderText("settings:codeIndex.qdrantUrlPlaceholder") as HTMLInputElement).value,
			).toBe(QDRANT_URL)
			expect(screen.queryByText("settings:codeIndex.validation.invalidQdrantUrl")).not.toBeInTheDocument()
			expect(saveButton()).toBeDisabled()
		})

		it("a stored secret shows as a placeholder that is not an unsaved edit", () => {
			renderOpen()
			openSetup()
			hostMessage({ type: "codeIndexSecretStatus", values: { hasQdrantApiKey: true } })
			const key = screen.getByPlaceholderText("settings:codeIndex.qdrantApiKeyPlaceholder") as HTMLInputElement
			expect(key.value).not.toBe("")
			expect(saveButton()).toBeDisabled()
		})
	})
})
