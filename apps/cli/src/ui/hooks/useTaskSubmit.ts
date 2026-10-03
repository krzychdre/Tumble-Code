import { useCallback, useEffect, useRef } from "react"
import { randomUUID } from "crypto"
import fs from "fs/promises"
import path from "path"
import { useStdout } from "ink"
import { suggestionModeToSwitch, type UsableSuggestion, type WebviewMessage } from "@tumble-code/types"

import { getGlobalCommand } from "../../lib/utils/commands.js"
import { getPermissionSettings, resolvePermissionArgument, type PermissionMode } from "../../lib/utils/permissions.js"
import { TuiCloudAuth, type CloudAuthChannel } from "../../lib/auth/tui-cloud-auth.js"

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
	sendToExtension: ((msg: WebviewMessage) => void) | null
	runTask: ((prompt: string) => Promise<void>) | null
	/** Forget the transcript bookkeeping of the current task (the client's transcript reader). */
	resetTranscript: () => void
	permissionMode: PermissionMode
	onPermissionModeChange: (mode: PermissionMode) => void
	/** Where /export writes (a relative /export path is taken from here). Default: the process cwd. */
	workspacePath?: string
	/** The model named in the /export heading. */
	model?: string
	/** The running extension for /login and /logout (absent: they say so). */
	cloudAuth?: CloudAuthChannel | null
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
	const resetConversation = useCallback(
		(send: (msg: WebviewMessage) => void) => {
			useCLIStore.getState().reset()

			resetTranscript()

			send({ type: "clearTask" })
			send({ type: "requestCommands" })
			send({ type: "requestModes" })
		},
		[resetTranscript],
	)

	const note = useCallback(
		(content: string) => addMessage({ id: randomUUID(), role: "system", content }),
		[addMessage],
	)

	// One sign-in at a time per session; a waiting one ends with the session.
	const cloudSignInRef = useRef<{ channel: CloudAuthChannel; auth: TuiCloudAuth } | null>(null)

	useEffect(() => () => cloudSignInRef.current?.auth.cancel(), [])

	/** /login [address] and /logout, run in the background so the prompt stays usable. */
	const runCloudAuth = useCallback(
		(action: "cloudLogin" | "cloudLogout", argument: string) => {
			if (!cloudAuth) {
				note("Cloud sign-in is not available until the extension has started.")
				return
			}

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
	 * Handle user text submission (from input or followup question)
	 */
	const handleSubmit = useCallback(
		async (text: string) => {
			if (!sendToExtension || !text.trim()) {
				return
			}

			const trimmedText = text.trim()

			if (trimmedText === "__CUSTOM__") {
				return
			}

			// Check for CLI global action commands (e.g., /new)
			if (trimmedText.startsWith("/")) {
				const commandMatch = trimmedText.match(/^\/(\w+)(?:\s|$)/)

				if (commandMatch && commandMatch[1]) {
					const globalCommand = getGlobalCommand(commandMatch[1])

					if (globalCommand?.action === "clearTask") {
						resetConversation(sendToExtension)
						return
					}

					if (globalCommand?.action === "clearConversation") {
						// Wipe first, reset second: the reset re-renders, the
						// `<Static>` region remounts on the new clear epoch and
						// prints the welcome banner, and that banner has to land
						// on the cleared screen rather than be cleared by it.
						write(CLEAR_TERMINAL)
						useUIStateStore.getState().clearTranscript()
						resetConversation(sendToExtension)
						return
					}

					if (globalCommand?.action === "copyLastAnswer") {
						copyToClipboard(trimmedText.slice(commandMatch[0].length).trim())
						return
					}

					if (globalCommand?.action === "exportTranscript") {
						await exportTranscript(trimmedText.slice(commandMatch[0].length).trim())
						return
					}

					if (globalCommand?.action === "cloudLogin" || globalCommand?.action === "cloudLogout") {
						runCloudAuth(globalCommand.action, trimmedText.slice(commandMatch[0].length).trim())
						return
					}

					if (globalCommand?.action === "openResumePicker") {
						// The # trigger is the resume picker; App types it into the prompt.
						useUIStateStore.getState().requestInput("#")
						return
					}

					if (globalCommand?.action === "openMcpPanel") {
						useUIStateStore.getState().setShowMcpPanel(true)
						return
					}

					if (globalCommand?.action === "setPermissions") {
						const argument = trimmedText.slice(commandMatch[0].length).trim()
						const result = resolvePermissionArgument(argument, permissionMode)

						if (!result.success) {
							addMessage({ id: randomUUID(), role: "system", content: result.error })
							return
						}

						if ("mode" in result) {
							sendToExtension({
								type: "updateSettings",
								updatedSettings: getPermissionSettings(result.mode),
							})
							onPermissionModeChange(result.mode)
							addMessage({
								id: randomUUID(),
								role: "system",
								content:
									result.mode === "allow"
										? "Permissions: allowing actions without approval for this session."
										: "Permissions: asking before actions for this session.",
							})
							return
						}

						addMessage({ id: randomUUID(), role: "system", content: result.help })
						return
					}
				}
			}

			if (pendingAsk) {
				addMessage({ id: randomUUID(), role: "user", content: trimmedText })

				sendToExtension({
					type: "askResponse",
					askResponse: "messageResponse",
					text: trimmedText,
				})

				setPendingAsk(null)
				setShowCustomInput(false)
				setIsTransitioningToCustomInput(false)
				setLoading(true)
			} else if (!hasStartedTask) {
				setHasStartedTask(true)
				setLoading(true)
				addMessage({ id: randomUUID(), role: "user", content: trimmedText })

				try {
					if (runTask) {
						await runTask(trimmedText)
					}
				} catch (err) {
					setError(err instanceof Error ? err.message : String(err))
					setLoading(false)
				}
			} else {
				if (isComplete) {
					setComplete(false)
				}

				setLoading(true)
				addMessage({ id: randomUUID(), role: "user", content: trimmedText })

				sendToExtension({
					type: "askResponse",
					askResponse: "messageResponse",
					text: trimmedText,
				})
			}
		},
		[
			sendToExtension,
			runTask,
			pendingAsk,
			hasStartedTask,
			isComplete,
			addMessage,
			setPendingAsk,
			setHasStartedTask,
			setLoading,
			setComplete,
			setError,
			setShowCustomInput,
			setIsTransitioningToCustomInput,
			resetConversation,
			write,
			permissionMode,
			onPermissionModeChange,
			copyToClipboard,
			exportTranscript,
			runCloudAuth,
		],
	)

	const handleSuggestion = useCallback(
		(suggestion: UsableSuggestion, manual: boolean) => {
			// "allow" turns on alwaysAllowModeSwitch (getPermissionSettings).
			const mode = suggestionModeToSwitch(suggestion, {
				manual,
				alwaysAllowModeSwitch: permissionMode === "allow",
			})

			if (mode) {
				sendToExtension?.({ type: "mode", text: mode })
			}

			void handleSubmit(suggestion.answer)
		},
		[sendToExtension, permissionMode, handleSubmit],
	)

	/**
	 * Handle approval (Y key)
	 */
	const handleApprove = useCallback(() => {
		if (!sendToExtension) {
			return
		}

		sendToExtension({ type: "askResponse", askResponse: "yesButtonClicked" })
		setPendingAsk(null)
		setLoading(true)
	}, [sendToExtension, setPendingAsk, setLoading])

	/**
	 * Handle rejection (N key)
	 */
	const handleReject = useCallback(() => {
		if (!sendToExtension) {
			return
		}

		sendToExtension({ type: "askResponse", askResponse: "noButtonClicked" })
		setPendingAsk(null)
		setLoading(true)
	}, [sendToExtension, setPendingAsk, setLoading])

	return {
		handleSubmit,
		handleSuggestion,
		handleApprove,
		handleReject,
	}
}
