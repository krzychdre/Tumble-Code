import { useCallback, useEffect, useMemo, useRef } from "react"
import { randomUUID } from "crypto"
import fs from "fs/promises"
import path from "path"
import { useStdout } from "ink"
import { suggestionModeToSwitch, type UsableSuggestion, type WebviewMessage } from "@tumble-code/types"

import { getGlobalCommand, type GlobalCommandAction } from "../../lib/utils/commands.js"
import { getPermissionSettings, resolvePermissionArgument, type PermissionMode } from "../../lib/utils/permissions.js"
import { TuiCloudAuth, type CloudAuthChannel } from "../../lib/auth/tui-cloud-auth.js"
import { buildModelRows, formatModelList, formatModelSwitched, hasOtherModel } from "../../lib/utils/model-command.js"
import { getSettingsPath } from "../../lib/storage/index.js"
import type { CliModelSettings } from "../../types/types.js"
import type { ModelSwitch } from "../../agent/extension-host.js"

import { useCLIStore } from "../store.js"
import { useUIStateStore } from "../stores/uiStateStore.js"
import { CLEAR_TERMINAL } from "../utils/clearTerminal.js"
import {
	defaultExportPath,
	lastAnswer,
	lastCodeBlock,
	osc52Copy,
	transcriptToMarkdown,
} from "../utils/transcriptExport.js"

export interface UseTaskSubmitOptions {
	sendToExtension: (msg: WebviewMessage) => void
	runTask: (prompt: string) => Promise<void>
	/** Forget the transcript bookkeeping of the current task (the client's transcript reader). */
	resetTranscript: () => void
	permissionMode: PermissionMode
	onPermissionModeChange: (mode: PermissionMode) => void
	/** Where /export writes (a relative /export path is taken from here). Default: the process cwd. */
	workspacePath?: string
	/** The model now running: named in the /export heading and by /model. */
	model?: string
	/** The mode now active, whose model /model changes. */
	mode?: string
	/** `models` of cli-settings.json, listed by /model. */
	configuredModels?: Record<string, CliModelSettings>
	/** Runs another model in a mode and saves the choice (ExtensionHost.switchModel). */
	switchModel: (mode: string, model: string) => ModelSwitch
	/** The running extension for /login and /logout. */
	cloudAuth: CloudAuthChannel
}

export interface UseTaskSubmitReturn {
	handleSubmit: (text: string) => Promise<void>
	/**
	 * Answer a follow-up with one of its suggestions, switching to the
	 * suggestion's mode first. `manual` is false for the countdown's pick.
	 */
	handleSuggestion: (suggestion: UsableSuggestion, manual: boolean) => void
	handleApprove: () => void
	handleReject: () => void
	/** Enter in the /model list: switches like /model <id>, or just closes on the current model. */
	pickModel: (model: string) => void
}

/**
 * Hook to handle task submission, user responses, and approvals.
 *
 * Responsibilities:
 * - Process user message submissions
 * - Detect and handle global commands (like /new)
 * - Handle pending ask responses
 * - Start new tasks or continue existing ones
 * - Handle Y/N approval responses
 */
export function useTaskSubmit({
	sendToExtension,
	runTask,
	resetTranscript,
	permissionMode,
	onPermissionModeChange,
	workspacePath,
	model,
	mode,
	configuredModels,
	switchModel,
	cloudAuth,
}: UseTaskSubmitOptions): UseTaskSubmitReturn {
	const {
		pendingAsk,
		hasStartedTask,
		isComplete,
		addMessage,
		setPendingAsk,
		setHasStartedTask,
		setLoading,
		setComplete,
		setError,
	} = useCLIStore()

	const { setShowCustomInput, setIsTransitioningToCustomInput } = useUIStateStore()
	const { write } = useStdout()

	/**
	 * Drop the current task: reset the CLI state, forget the message ids we
	 * have already seen, tell the extension host to clear the task, and
	 * re-request the commands and modes that reset() just wiped.
	 *
	 * Shared by /new and /clear; the only thing /clear adds is the screen wipe.
	 */
	const resetConversation = useCallback(() => {
		useCLIStore.getState().reset()

		resetTranscript()

		sendToExtension({ type: "clearTask" })
		sendToExtension({ type: "requestCommands" })
		sendToExtension({ type: "requestModes" })
	}, [resetTranscript, sendToExtension])

	const note = useCallback(
		(content: string) => addMessage({ id: randomUUID(), role: "system", content }),
		[addMessage],
	)

	// One sign-in at a time per session; a waiting one ends with the session.
	const cloudSignInRef = useRef<{ channel: CloudAuthChannel; auth: TuiCloudAuth } | null>(null)

	useEffect(() => () => cloudSignInRef.current?.auth.cancel(), [])

	/** /login [callback-url] and /logout, run in the background so the prompt stays usable. */
	const runCloudAuth = useCallback(
		(action: "cloudLogin" | "cloudLogout", argument: string) => {
			if (cloudSignInRef.current?.channel !== cloudAuth) {
				cloudSignInRef.current?.auth.cancel()
				cloudSignInRef.current = { channel: cloudAuth, auth: new TuiCloudAuth({ channel: cloudAuth, note }) }
			}

			const { auth } = cloudSignInRef.current
			void (action === "cloudLogin" ? auth.login(argument) : auth.logout()).catch((error: unknown) =>
				note(`Tumble Code Cloud: ${error instanceof Error ? error.message : String(error)}`),
			)
		},
		[cloudAuth, note],
	)

	/**
	 * /copy [code]: the last answer, or its last fenced code block, to the
	 * clipboard through OSC 52. Whether the terminal honours OSC 52 cannot be
	 * read back, so the note says what to do when nothing arrived.
	 */
	const copyToClipboard = useCallback(
		(argument: string) => {
			const messages = useCLIStore.getState().messages
			const wantsCode = argument === "code"
			const text = wantsCode ? lastCodeBlock(messages) : lastAnswer(messages)

			if (argument && !wantsCode) {
				note("Usage: /copy (the last answer) or /copy code (its last code block).")
				return
			}

			if (text === null) {
				note(wantsCode ? "There is no code block to copy yet." : "There is nothing to copy yet.")
				return
			}

			write(osc52Copy(text))
			note(
				`Copied the last ${wantsCode ? "code block" : "answer"} (${text.length} characters) with OSC 52. ` +
					"If the clipboard stays empty, your terminal does not accept OSC 52 " +
					"(under tmux: set -g set-clipboard on); /export saves the conversation to a file instead.",
			)
		},
		[note, write],
	)

	/** /export [file]: the transcript as Markdown; never overwrites a file. */
	const exportTranscript = useCallback(
		async (argument: string) => {
			const base = workspacePath ?? process.cwd()
			const target = argument ? path.resolve(base, argument) : defaultExportPath(base, new Date())
			const { messages, currentMode } = useCLIStore.getState()
			const markdown = transcriptToMarkdown(messages, {
				exportedAt: new Date(),
				mode: currentMode ?? undefined,
				model,
			})

			try {
				await fs.mkdir(path.dirname(target), { recursive: true })
				await fs.writeFile(target, markdown, { encoding: "utf8", flag: "wx" })
				note(`Exported the conversation to ${target}`)
			} catch (error) {
				const code = (error as NodeJS.ErrnoException).code
				note(
					code === "EEXIST"
						? `${target} already exists; give /export another file name.`
						: `Could not export to ${target}: ${error instanceof Error ? error.message : String(error)}`,
				)
			}
		},
		[workspacePath, model, note],
	)

	/**
	 * /model <id> and Enter in the /model list both switch through here, so
	 * whatever a switch does, and the line that confirms it, is the same for
	 * the typed command and the list.
	 */
	const switchToModel = useCallback(
		async (requested: string) => {
			const activeMode = mode ?? "code"
			let content: string

			if (requested === model) {
				content = `${activeMode} mode already runs ${requested}.`
			} else {
				try {
					// In effect from here on; the line waits for the save only.
					const { settings, saved } = switchModel(activeMode, requested)
					content = formatModelSwitched({
						mode: activeMode,
						model: requested,
						settings,
						hasEntry: configuredModels?.[requested] !== undefined,
						saved: await saved,
					})
				} catch (error) {
					content = `Could not switch the model: ${error instanceof Error ? error.message : String(error)}`
				}
			}

			note(content)
		},
		[mode, model, switchModel, configuredModels, note],
	)

	/** Enter in the /model list; on the model already running it only closes the list. */
	const pickModel = useCallback(
		(requested: string) => {
			useUIStateStore.getState().setShowModelPicker(false)

			if (requested !== model) {
				void switchToModel(requested)
			}
		},
		[model, switchToModel],
	)

	/** /model: switch to the named model, or open the list, or print it when there is nothing to pick. */
	const runModelCommand = useCallback(
		async (requested: string) => {
			if (requested) {
				await switchToModel(requested)
			} else if (hasOtherModel(buildModelRows(model, configuredModels))) {
				useUIStateStore.getState().setShowModelPicker(true)
			} else {
				// Nothing to pick besides the model already running: the
				// printed list says how to add entries.
				note(
					formatModelList({
						mode: mode ?? "code",
						currentModel: model,
						models: configuredModels,
						settingsPath: getSettingsPath(),
					}),
				)
			}
		},
		[switchToModel, model, configuredModels, mode, note],
	)

	/** /permissions [mode]: show the options, or switch the approval mode for this session. */
	const setPermissions = useCallback(
		(argument: string) => {
			const result = resolvePermissionArgument(argument, permissionMode)

			if (!result.success) {
				note(result.error)
				return
			}

			if ("mode" in result) {
				sendToExtension({ type: "updateSettings", updatedSettings: getPermissionSettings(result.mode) })
				onPermissionModeChange(result.mode)
				note(
					result.mode === "allow"
						? "Permissions: allowing actions without approval for this session."
						: "Permissions: asking before actions for this session.",
				)
				return
			}

			note(result.help)
		},
		[permissionMode, sendToExtension, onPermissionModeChange, note],
	)

	/** What each CLI global command (/new, /model, ...) does with the text after its name. */
	const commandHandlers = useMemo<Record<GlobalCommandAction, (argument: string) => void | Promise<void>>>(
		() => ({
			clearTask: () => resetConversation(),
			clearConversation: () => {
				// Wipe first, reset second: the reset re-renders, the
				// `<Static>` region remounts on the new clear epoch and
				// prints the welcome banner, and that banner has to land
				// on the cleared screen rather than be cleared by it.
				write(CLEAR_TERMINAL)
				useUIStateStore.getState().clearTranscript()
				resetConversation()
			},
			copyLastAnswer: copyToClipboard,
			exportTranscript,
			cloudLogin: (argument) => runCloudAuth("cloudLogin", argument),
			cloudLogout: (argument) => runCloudAuth("cloudLogout", argument),
			// The # trigger is the resume picker; App types it into the prompt.
			openResumePicker: () => useUIStateStore.getState().requestInput("#"),
			switchModel: runModelCommand,
			openMcpPanel: () => useUIStateStore.getState().setShowMcpPanel(true),
			setPermissions,
		}),
		[resetConversation, write, copyToClipboard, exportTranscript, runCloudAuth, runModelCommand, setPermissions],
	)

	/** A message for the task: an answer to its ask, the first prompt, a reply to its completion, or queued. */
	const sendUserMessage = useCallback(
		async (text: string) => {
			addMessage({ id: randomUUID(), role: "user", content: text })

			if (pendingAsk) {
				sendToExtension({ type: "askResponse", askResponse: "messageResponse", text })

				setPendingAsk(null)
				setShowCustomInput(false)
				setIsTransitioningToCustomInput(false)
				setLoading(true)
			} else if (!hasStartedTask) {
				setHasStartedTask(true)
				setLoading(true)

				try {
					await runTask(text)
				} catch (err) {
					setError(err instanceof Error ? err.message : String(err))
					setLoading(false)
				}
			} else if (isComplete) {
				setComplete(false)
				setLoading(true)

				sendToExtension({ type: "askResponse", askResponse: "messageResponse", text })
			} else {
				// The task is working and asks nothing: queue the message, as
				// the VS Code chat does. The task takes it at its next ask, and
				// a task waiting for its subagents (wait_for_subagents) takes
				// it at once and answers. An askResponse here would only be
				// read by whatever the task asks next.
				setLoading(true)

				sendToExtension({ type: "queueMessage", text })
			}
		},
		[
			addMessage,
			pendingAsk,
			sendToExtension,
			setPendingAsk,
			setShowCustomInput,
			setIsTransitioningToCustomInput,
			setLoading,
			hasStartedTask,
			setHasStartedTask,
			runTask,
			setError,
			isComplete,
			setComplete,
		],
	)

	/**
	 * Handle user text submission (from input or followup question)
	 */
	const handleSubmit = useCallback(
		async (text: string) => {
			const trimmedText = text.trim()

			if (!trimmedText || trimmedText === "__CUSTOM__") {
				return
			}

			// CLI global action commands (e.g., /new); any other text goes to the task.
			const commandMatch = trimmedText.match(/^\/(\w+)(?:\s|$)/)
			const command = commandMatch ? getGlobalCommand(commandMatch[1]!) : undefined

			if (commandMatch && command) {
				await commandHandlers[command.action](trimmedText.slice(commandMatch[0].length).trim())
				return
			}

			await sendUserMessage(trimmedText)
		},
		[commandHandlers, sendUserMessage],
	)

	const handleSuggestion = useCallback(
		(suggestion: UsableSuggestion, manual: boolean) => {
			// "allow" turns on alwaysAllowModeSwitch (getPermissionSettings).
			const mode = suggestionModeToSwitch(suggestion, {
				manual,
				alwaysAllowModeSwitch: permissionMode === "allow",
			})

			if (mode) {
				sendToExtension({ type: "mode", text: mode })
			}

			void handleSubmit(suggestion.answer)
		},
		[sendToExtension, permissionMode, handleSubmit],
	)

	/** Y and N on an approval. */
	const answerApproval = useCallback(
		(askResponse: "yesButtonClicked" | "noButtonClicked") => {
			sendToExtension({ type: "askResponse", askResponse })
			setPendingAsk(null)
			setLoading(true)
		},
		[sendToExtension, setPendingAsk, setLoading],
	)

	const handleApprove = useCallback(() => answerApproval("yesButtonClicked"), [answerApproval])
	const handleReject = useCallback(() => answerApproval("noButtonClicked"), [answerApproval])

	return {
		handleSubmit,
		handleSuggestion,
		handleApprove,
		handleReject,
		pickModel,
	}
}
