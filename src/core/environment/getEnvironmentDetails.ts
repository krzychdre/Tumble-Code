import path from "path"
import os from "os"

import * as vscode from "vscode"
import pWaitFor from "p-wait-for"
import delay from "delay"

import { type ExperimentId, SETTINGS_DEFAULTS, formatLanguage, isCompactProfile } from "@tumble-code/types"

import { getFullModeDetails } from "../prompts/modeDetails"
import { consolidateTokenUsage } from "@tumble-code/core/browser"
import { listFiles } from "../../services/glob/list-files"
import { TerminalRegistry } from "../../integrations/terminal/TerminalRegistry"
import { Terminal } from "../../integrations/terminal/Terminal"
import { arePathsEqual } from "../../utils/path"
import { formatResponse } from "../prompts/responses"
import { getGitStatus } from "../../utils/git"

import { Task } from "../task/Task"
import { type ProviderState } from "../webview/ProviderStateBuilder"
import { formatReminderSection } from "./reminder"
import { formatCompactCurrentTime, formatCurrentTime } from "./currentTime"

// Transient change-tracking per Task instance (never persisted, so a new or
// resumed task, including after a mode switch to a different context window,
// always starts from a full emission). Sections that rarely change between
// turns are omitted when identical to what the previous turn already sent:
// the model still has them in history, and re-sending churns every message
// with noise the model re-reads and re-reasons about each turn. See
// ai_plans/archive/2026-07/2026-07-12_glm-agent-loop-efficiency-implementation.md (WS-2).
interface EnvSectionSnapshot {
	visibleFiles: string
	openTabs: string
	mode: string
}

const lastEnvSnapshot = new WeakMap<Task, EnvSectionSnapshot>()

// The recursive workspace listing is by far the largest section: measured across
// 555 stored tasks it is 87.4% of all environment_details bytes in orchestrator
// mode and 51.9% in code mode. It is emitted on every *full* block, and
// TaskSubtasks#resumeAfterDelegation asks for a full block after every completed
// subtask, so 62.2% of orchestrator environment blocks carry a listing, against
// ~13% in the other modes. Those blocks live in the conversation history, so a
// long orchestration accumulates dozens of near-identical ~7.5 kB listings and
// re-sends all of them on every subsequent turn.
//
// Keyed per Task and never persisted, like lastEnvSnapshot: a resumed task, or
// one that switched to a mode with a different context window, starts from a
// full emission.
const lastFileDetails = new WeakMap<Task, string>()

/** Stands in for a listing the model already has verbatim earlier in this conversation. */
export const FILE_DETAILS_UNCHANGED_NOTE =
	"(Unchanged since the listing earlier in this conversation. Use list_files if you need a fresh view.)"

/**
 * The editors visible right now, relative to the task's working directory and
 * filtered through .rooignore, one path per line ("" when none).
 */
function getVisibleFilesText(task: Task, maxWorkspaceFiles: number): string {
	const visibleFilePaths = vscode.window.visibleTextEditors
		?.map((editor) => editor.document?.uri?.fsPath)
		.filter(Boolean)
		.map((absolutePath) => path.relative(task.cwd, absolutePath))
		.slice(0, maxWorkspaceFiles)

	// Filter paths through rooIgnoreController
	const allowedVisibleFiles = task.rooIgnoreController
		? task.rooIgnoreController.filterPaths(visibleFilePaths)
		: visibleFilePaths.map((p) => p.toPosix()).join("\n")

	return Array.isArray(allowedVisibleFiles) ? allowedVisibleFiles.join("\n") : allowedVisibleFiles || ""
}

/**
 * The open text tabs, relative to the task's working directory and filtered
 * through .rooignore, at most `maxTabs`, one path per line ("" when none).
 */
function getOpenTabsText(task: Task, maxTabs: number): string {
	const openTabPaths = vscode.window.tabGroups.all
		.flatMap((group) => group.tabs)
		.filter((tab) => tab.input instanceof vscode.TabInputText)
		.map((tab) => (tab.input as vscode.TabInputText).uri.fsPath)
		.filter(Boolean)
		.map((absolutePath) => path.relative(task.cwd, absolutePath).toPosix())
		.slice(0, maxTabs)

	// Filter paths through rooIgnoreController
	const allowedOpenTabs = task.rooIgnoreController
		? task.rooIgnoreController.filterPaths(openTabPaths)
		: openTabPaths.map((p) => p.toPosix()).join("\n")

	return Array.isArray(allowedOpenTabs) ? allowedOpenTabs.join("\n") : allowedOpenTabs || ""
}

/** New output of the terminals this task can see, already passed through `compressTerminalOutput`. */
interface TerminalOutputs {
	busy: Array<{ id: number; cwd: string; command: string; output?: string }>
	/**
	 * Inactive terminals that had completed processes. `outputs` is empty when none of
	 * them had unretrieved output, and `cwd` is then not read.
	 */
	inactive: Array<{ id: number; cwd: string; outputs: Array<{ command: string; output: string }> }>
}

/**
 * Waits for busy terminals to cool down, then takes their new output and the
 * output of completed processes (clearing those queues). Shared by the regular
 * and the compact block so both consume the terminals the same way.
 */
async function collectTerminalOutputs(task: Task): Promise<TerminalOutputs> {
	// Get task-specific and background terminals.
	const busyTerminals = [
		...TerminalRegistry.getTerminals(true, task.taskId),
		...TerminalRegistry.getBackgroundTerminals(true),
	]

	const inactiveTerminals = [
		...TerminalRegistry.getTerminals(false, task.taskId),
		...TerminalRegistry.getBackgroundTerminals(false),
	]

	if (busyTerminals.length > 0) {
		if (task.didEditFile) {
			await delay(300) // Delay after saving file to let terminals catch up.
		}

		// Wait for terminals to cool down.
		await pWaitFor(() => busyTerminals.every((t) => !TerminalRegistry.isProcessHot(t.id)), {
			interval: 100,
			timeout: 5_000,
		}).catch(() => {
			// A terminal that stays busy past the timeout is reported as it is.
		})
	}

	// Reset, this lets us know when to wait for saved files to update terminals.
	task.didEditFile = false

	// Terminals are cool, let's retrieve their output.
	const busy: TerminalOutputs["busy"] = busyTerminals.map((busyTerminal) => {
		const cwd = busyTerminal.getCurrentWorkingDirectory()
		const command = busyTerminal.getLastCommand()
		const newOutput = TerminalRegistry.getUnretrievedOutput(busyTerminal.id)
		return {
			id: busyTerminal.id,
			cwd,
			command,
			output: newOutput ? Terminal.compressTerminalOutput(newOutput) : undefined,
		}
	})

	// First check if any inactive terminals in this task have completed
	// processes with output.
	const terminalsWithOutput = inactiveTerminals.filter((terminal) => {
		const completedProcesses = terminal.getProcessesWithOutput()
		return completedProcesses.length > 0
	})

	const inactive: TerminalOutputs["inactive"] = terminalsWithOutput.map((inactiveTerminal) => {
		const outputs: Array<{ command: string; output: string }> = []

		// Get output from completed processes queue.
		for (const process of inactiveTerminal.getProcessesWithOutput()) {
			const output = process.getUnretrievedOutput()

			if (output) {
				outputs.push({ command: process.command, output: Terminal.compressTerminalOutput(output) })
			}
		}

		// Clean the queue after retrieving output.
		inactiveTerminal.cleanCompletedProcessQueue()

		return {
			id: inactiveTerminal.id,
			cwd: outputs.length > 0 ? inactiveTerminal.getCurrentWorkingDirectory() : "",
			outputs,
		}
	})

	return { busy, inactive }
}

export async function getEnvironmentDetails(
	task: Task,
	includeFileDetails: boolean = false,
	/**
	 * The caller's state snapshot (P5). Provided by the request cycle, which
	 * takes ONE snapshot per cycle; the condense/forced-truncation callers
	 * omit it and keep the live read, because they run after a failed request
	 * where settings may legitimately have changed since cycle start.
	 */
	cycleState?: ProviderState,
) {
	let details = ""

	const state = cycleState ?? (await task.providerRef.deref()?.getState())

	// The compact profile (small local models) gets its own short block; see
	// getCompactEnvironmentDetails. Read from the task's own profile.
	if (isCompactProfile(task.apiConfiguration)) {
		return getCompactEnvironmentDetails(task, includeFileDetails, state)
	}

	const { maxWorkspaceFiles = SETTINGS_DEFAULTS.maxWorkspaceFiles } = state ?? {}

	// includeFileDetails marks task/resume/subtask starts: always emit the full
	// block there so the model's baseline never depends on dedup state.
	const prevSnapshot = includeFileDetails ? undefined : lastEnvSnapshot.get(task)

	// It could be useful for the model to know if the user went from one or no
	// file to another between messages, so we include this context whenever
	// it changed since the previous turn.
	const visibleFilesText = getVisibleFilesText(task, maxWorkspaceFiles)

	if (prevSnapshot === undefined || prevSnapshot.visibleFiles !== visibleFilesText) {
		if (visibleFilesText) {
			details += "\n\n# VSCode Visible Files"
			details += `\n${visibleFilesText}`
		} else if (prevSnapshot?.visibleFiles) {
			details += "\n\n# VSCode Visible Files\n(No visible files)"
		}
	}

	const { maxOpenTabsContext } = state ?? {}
	const maxTabs = maxOpenTabsContext ?? SETTINGS_DEFAULTS.maxOpenTabsContext
	const openTabsText = getOpenTabsText(task, maxTabs)

	if (prevSnapshot === undefined || prevSnapshot.openTabs !== openTabsText) {
		if (openTabsText) {
			details += "\n\n# VSCode Open Tabs"
			details += `\n${openTabsText}`
		} else if (prevSnapshot?.openTabs) {
			details += "\n\n# VSCode Open Tabs\n(No open tabs)"
		}
	}

	const terminals = await collectTerminalOutputs(task)

	// Waiting for updated diagnostics lets terminal output be the most
	// up-to-date possible.
	let terminalDetails = ""

	if (terminals.busy.length > 0) {
		terminalDetails += "\n\n# Actively Running Terminals"

		for (const busyTerminal of terminals.busy) {
			terminalDetails += `\n## Terminal ${busyTerminal.id} (Active)`
			terminalDetails += `\n### Working Directory: \`${busyTerminal.cwd}\``
			terminalDetails += `\n### Original command: \`${busyTerminal.command}\``

			if (busyTerminal.output !== undefined) {
				terminalDetails += `\n### New Output\n${busyTerminal.output}`
			}
		}
	}

	// Only add the header if there are terminals with output.
	if (terminals.inactive.length > 0) {
		terminalDetails += "\n\n# Inactive Terminals with Completed Process Output"

		// Add each terminal's outputs to the details.
		for (const inactiveTerminal of terminals.inactive) {
			if (inactiveTerminal.outputs.length > 0) {
				terminalDetails += `\n## Terminal ${inactiveTerminal.id} (Inactive)`
				terminalDetails += `\n### Working Directory: \`${inactiveTerminal.cwd}\``
				for (const { command, output } of inactiveTerminal.outputs) {
					terminalDetails += `\n### New Output\nCommand: \`${command}\`\n${output}`
				}
			}
		}
	}

	// console.log(`[Task#getEnvironmentDetails] terminalDetails: ${terminalDetails}`)

	// Add recently modified files section.
	const recentlyModifiedFiles = task.fileContextTracker.getAndClearRecentlyModifiedFiles()

	if (recentlyModifiedFiles.length > 0) {
		details +=
			"\n\n# Recently Modified Files\nThese files have been modified since you last accessed them (file was just edited so you may need to re-read it before editing):"
		for (const filePath of recentlyModifiedFiles) {
			details += `\n${filePath}`
		}
	}

	if (terminalDetails) {
		details += terminalDetails
	}

	// Time and cost are churn: they differ every turn while adding nothing the
	// task needs, so by default both are on (SETTINGS_DEFAULTS) but the
	// per-turn emission below only fires when enabled. Time is still emitted on
	// the first turn (and on resume/subtask starts) so the model knows today's date.
	const {
		includeCurrentTime = SETTINGS_DEFAULTS.includeCurrentTime,
		includeCurrentCost = SETTINGS_DEFAULTS.includeCurrentCost,
		maxGitStatusFiles = SETTINGS_DEFAULTS.maxGitStatusFiles,
	} = state ?? {}

	// Add current time information with timezone (every turn if enabled,
	// otherwise only on full emissions).
	if (includeCurrentTime || prevSnapshot === undefined) {
		details += `\n\n${formatCurrentTime(new Date())}`
	}

	// Add git status information (if enabled with maxGitStatusFiles > 0).
	if (maxGitStatusFiles > 0) {
		const gitStatus = await getGitStatus(task.cwd, maxGitStatusFiles)
		if (gitStatus) {
			details += `\n\n# Git Status\n${gitStatus}`
		}
	}

	// Add context tokens information (if enabled).
	if (includeCurrentCost) {
		const { totalCost } = consolidateTokenUsage(task.clineMessages)
		details += `\n\n# Current Cost\n${totalCost !== null ? `$${totalCost.toFixed(2)}` : "(Not available)"}`
	}

	const { id: modelId } = task.api.getModel()

	// Add current mode and any mode-specific warnings.
	const {
		customModes,
		customModePrompts,
		experiments = {} as Record<ExperimentId, boolean>,
		customInstructions: globalCustomInstructions,
		language,
	} = state ?? {}

	// The task's own mode, not the one in provider state: that is the focused task's mode,
	// and a background subagent or a delegated child may run in another one.
	const currentMode = await task.getTaskMode()

	const modeDetails = await getFullModeDetails(currentMode, customModes, customModePrompts, {
		cwd: task.cwd,
		globalCustomInstructions,
		language: language ?? formatLanguage(vscode.env.language),
	})

	let modeSection = `\n\n# Current Mode\n`
	modeSection += `<slug>${currentMode}</slug>\n`
	modeSection += `<name>${modeDetails.name}</name>\n`
	modeSection += `<model>${modelId}</model>\n`

	// Re-emitted whenever mode or model changes (mode switches recompute
	// naturally since the comparison string embeds both).
	if (prevSnapshot === undefined || prevSnapshot.mode !== modeSection) {
		details += modeSection
	}

	lastEnvSnapshot.set(task, {
		visibleFiles: visibleFilesText,
		openTabs: openTabsText,
		mode: modeSection,
	})

	if (includeFileDetails) {
		details += `\n\n# Current Workspace Directory (${task.cwd.toPosix()}) Files\n`
		const isDesktop = arePathsEqual(task.cwd, path.join(os.homedir(), "Desktop"))

		if (isDesktop) {
			// Don't want to immediately access desktop since it would show
			// permission popup.
			details += "(Desktop files not shown automatically. Use list_files to explore if needed.)"
		} else {
			const maxFiles = maxWorkspaceFiles ?? SETTINGS_DEFAULTS.maxWorkspaceFiles

			// Early return for limit of 0
			if (maxFiles === 0) {
				details += "(Workspace files context disabled. Use list_files to explore if needed.)"
			} else {
				// listFiles throws when ripgrep cannot be found. The listing is optional
				// context, so report it as unavailable instead of failing the whole request.
				let listing: Awaited<ReturnType<typeof listFiles>> | undefined
				try {
					listing = await listFiles(task.cwd, true, maxFiles)
				} catch (error) {
					details += `(File listing unavailable: ${error instanceof Error ? error.message : String(error)})`
				}

				if (listing) {
					const [files, didHitLimit] = listing
					const { showRooIgnoredFiles = SETTINGS_DEFAULTS.showRooIgnoredFiles } = state ?? {}

					const result = formatResponse.formatFilesList(
						task.cwd,
						files,
						didHitLimit,
						task.rooIgnoreController,
						showRooIgnoredFiles,
					)

					// Byte-identical to what this task already sent: point at that copy
					// instead of repeating it. Comparing content rather than counting
					// emissions means a subtask that actually created files still gets a
					// fresh listing, which is the only reason to re-emit at all.
					if (lastFileDetails.get(task) === result) {
						details += FILE_DETAILS_UNCHANGED_NOTE
					} else {
						lastFileDetails.set(task, result)
						details += result
					}
				}
			}
		}
	}

	const todoListEnabled =
		state && typeof state.apiConfiguration?.todoListEnabled === "boolean"
			? state.apiConfiguration.todoListEnabled
			: true
	const reminderSection = todoListEnabled ? formatReminderSection(task.todoList) : ""
	return `<environment_details>\n${details.trim()}\n${reminderSection}\n</environment_details>`
}

// --- Compact profile -------------------------------------------------------
//
// A small local model (for example a 4B model in a 40,960-token window) pays for
// every character twice: in the window and in prompt processing time (about 130
// tokens per second on the target GPU). The compact block keeps what the model
// acts on and drops the rest. Budgets, measured on the returned string: at most
// 2,500 characters on a first turn, at most 200 on a later turn in a quiet
// workspace (ai_plans/2026-10-10_19-36_compact-small-model-profile.md).

/** Paths shown at most per one-line list (visible files, open tabs, recently modified files). */
export const COMPACT_MAX_LISTED_PATHS = 5
/** Characters at most per one-line path list, so a few very long paths cannot blow the budget. */
const COMPACT_PATH_LINE_MAX_CHARS = 300
/** Entries at most in the first-turn workspace listing. */
export const COMPACT_MAX_WORKSPACE_FILES = 50
/** Characters at most in the first-turn workspace listing (long paths reach the budget before 50 entries). */
export const COMPACT_FILE_LIST_MAX_CHARS = 1_500
/** Characters at most kept from the end of one terminal output. */
export const COMPACT_TERMINAL_OUTPUT_MAX_CHARS = 800
/** Files at most in the git status (when the user turned it on). */
const COMPACT_MAX_GIT_STATUS_FILES = 10

/**
 * `label: a, b, c (+N more)`, at most COMPACT_MAX_LISTED_PATHS paths and
 * COMPACT_PATH_LINE_MAX_CHARS characters. Returns "" for no paths.
 */
function formatCompactPathLine(label: string, paths: string[]): string {
	if (paths.length === 0) {
		return ""
	}

	let line = `${label}: `
	let shown = 0

	for (const p of paths.slice(0, COMPACT_MAX_LISTED_PATHS)) {
		const next = shown === 0 ? p : `, ${p}`
		if (shown > 0 && line.length + next.length > COMPACT_PATH_LINE_MAX_CHARS) {
			break
		}
		line += next
		shown++
	}

	return shown < paths.length ? `${line} (+${paths.length - shown} more)` : line
}

/** The last `maxChars` characters of a terminal output, starting at a line boundary when there is one. */
function keepTerminalTail(output: string, maxChars: number): string {
	if (output.length <= maxChars) {
		return output
	}

	let tail = output.slice(-maxChars)
	const firstBreak = tail.indexOf("\n")
	if (firstBreak !== -1 && firstBreak < tail.length - 1) {
		tail = tail.slice(firstBreak + 1)
	}

	return `(${output.length - tail.length} earlier characters cut)\n${tail}`
}

/**
 * The first-turn workspace listing, at most COMPACT_MAX_WORKSPACE_FILES entries
 * and COMPACT_FILE_LIST_MAX_CHARS characters, cut at a line boundary, with a note
 * when anything was left out.
 */
async function getCompactWorkspaceListing(task: Task, state: ProviderState | undefined): Promise<string> {
	const header = `Workspace files (${task.cwd.toPosix()}):`

	if (arePathsEqual(task.cwd, path.join(os.homedir(), "Desktop"))) {
		// Listing the Desktop would show a permission popup.
		return `${header} (Desktop files not shown automatically. Use list_files to explore if needed.)`
	}

	const { maxWorkspaceFiles = SETTINGS_DEFAULTS.maxWorkspaceFiles } = state ?? {}
	if (maxWorkspaceFiles === 0) {
		return `${header} (Workspace files context disabled. Use list_files to explore if needed.)`
	}

	let listing: Awaited<ReturnType<typeof listFiles>>
	try {
		listing = await listFiles(task.cwd, true, Math.min(maxWorkspaceFiles, COMPACT_MAX_WORKSPACE_FILES))
	} catch (error) {
		return `${header} (File listing unavailable: ${error instanceof Error ? error.message : String(error)})`
	}

	const [files, didHitLimit] = listing
	const { showRooIgnoredFiles = SETTINGS_DEFAULTS.showRooIgnoredFiles } = state ?? {}

	// didHitLimit is passed as false: the compact note below replaces the long one.
	const formatted = formatResponse.formatFilesList(
		task.cwd,
		files,
		false,
		task.rooIgnoreController,
		showRooIgnoredFiles,
	)

	const lines = formatted.split("\n").filter((line) => line !== "")
	const kept: string[] = []
	let chars = 0

	for (const line of lines.slice(0, COMPACT_MAX_WORKSPACE_FILES)) {
		if (kept.length > 0 && chars + line.length + 1 > COMPACT_FILE_LIST_MAX_CHARS) {
			break
		}
		kept.push(line)
		chars += line.length + 1
	}

	let result = kept.join("\n")
	if (didHitLimit || kept.length < lines.length) {
		result += `\n(First ${kept.length} entries shown. Use list_files on a subdirectory to see more.)`
	}

	// Byte-identical to what this task already sent: point at that copy (see lastFileDetails).
	if (lastFileDetails.get(task) === result) {
		return `${header} ${FILE_DETAILS_UNCHANGED_NOTE}`
	}
	lastFileDetails.set(task, result)
	return `${header}\n${result}`
}

/**
 * The compact profile's environment details: one line per fact, sections that
 * did not change since the previous turn left out (as in the regular block), no
 * cost and no todo reminder (the compact toolset has no update_todo_list).
 */
async function getCompactEnvironmentDetails(
	task: Task,
	includeFileDetails: boolean,
	state: ProviderState | undefined,
): Promise<string> {
	const lines: string[] = []
	const prevSnapshot = includeFileDetails ? undefined : lastEnvSnapshot.get(task)

	const {
		maxWorkspaceFiles = SETTINGS_DEFAULTS.maxWorkspaceFiles,
		maxOpenTabsContext = SETTINGS_DEFAULTS.maxOpenTabsContext,
		includeCurrentTime = SETTINGS_DEFAULTS.includeCurrentTime,
		maxGitStatusFiles = SETTINGS_DEFAULTS.maxGitStatusFiles,
	} = state ?? {}

	// The same rule as the regular block: every turn while enabled, always on a full emission.
	if (includeCurrentTime || prevSnapshot === undefined) {
		lines.push(formatCompactCurrentTime(new Date()))
	}

	// The task's own mode, emitted only when it changed.
	const modeLine = `Current mode: ${await task.getTaskMode()}`
	if (prevSnapshot === undefined || prevSnapshot.mode !== modeLine) {
		lines.push(modeLine)
	}

	const visibleFilesText = getVisibleFilesText(task, maxWorkspaceFiles)
	if (prevSnapshot === undefined || prevSnapshot.visibleFiles !== visibleFilesText) {
		if (visibleFilesText) {
			lines.push(formatCompactPathLine("Visible files", visibleFilesText.split("\n").filter(Boolean)))
		} else if (prevSnapshot?.visibleFiles) {
			lines.push("Visible files: none")
		}
	}

	const openTabsText = getOpenTabsText(task, maxOpenTabsContext)
	if (prevSnapshot === undefined || prevSnapshot.openTabs !== openTabsText) {
		if (openTabsText) {
			lines.push(formatCompactPathLine("Open tabs", openTabsText.split("\n").filter(Boolean)))
		} else if (prevSnapshot?.openTabs) {
			lines.push("Open tabs: none")
		}
	}

	lastEnvSnapshot.set(task, { visibleFiles: visibleFilesText, openTabs: openTabsText, mode: modeLine })

	const terminals = await collectTerminalOutputs(task)

	const recentlyModifiedFiles = task.fileContextTracker.getAndClearRecentlyModifiedFiles()
	if (recentlyModifiedFiles.length > 0) {
		lines.push(
			formatCompactPathLine("Changed since you last read them (re-read before editing)", recentlyModifiedFiles),
		)
	}

	const resolvedCwd = path.resolve(task.cwd)
	const where = (cwd: string) => (cwd && path.resolve(cwd) !== resolvedCwd ? ` in ${cwd}` : "")

	for (const busyTerminal of terminals.busy) {
		const heading = `Terminal ${busyTerminal.id} running \`${busyTerminal.command}\`${where(busyTerminal.cwd)}:`
		lines.push(
			busyTerminal.output
				? `${heading}\n${keepTerminalTail(busyTerminal.output, COMPACT_TERMINAL_OUTPUT_MAX_CHARS)}`
				: `${heading} (no new output)`,
		)
	}

	for (const inactiveTerminal of terminals.inactive) {
		for (const { command, output } of inactiveTerminal.outputs) {
			lines.push(
				`Terminal ${inactiveTerminal.id} finished \`${command}\`${where(inactiveTerminal.cwd)}:\n` +
					keepTerminalTail(output, COMPACT_TERMINAL_OUTPUT_MAX_CHARS),
			)
		}
	}

	if (maxGitStatusFiles > 0) {
		const gitStatus = await getGitStatus(task.cwd, Math.min(maxGitStatusFiles, COMPACT_MAX_GIT_STATUS_FILES))
		if (gitStatus) {
			lines.push(`Git status:\n${gitStatus}`)
		}
	}

	if (includeFileDetails) {
		lines.push(await getCompactWorkspaceListing(task, state))
	}

	return lines.length > 0
		? `<environment_details>\n${lines.join("\n")}\n</environment_details>`
		: "<environment_details>\n</environment_details>"
}
