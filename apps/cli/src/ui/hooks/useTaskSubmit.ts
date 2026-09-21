import { useCallback } from "react"
import { randomUUID } from "crypto"
import type { WebviewMessage } from "@roo-code/types"

import { getGlobalCommand } from "../../lib/utils/commands.js"
import { getPermissionSettings, resolvePermissionArgument, type PermissionMode } from "../../lib/utils/permissions.js"

import { useCLIStore } from "../store.js"
import { useUIStateStore } from "../stores/uiStateStore.js"

export interface UseTaskSubmitOptions {
	sendToExtension: ((msg: WebviewMessage) => void) | null
	runTask: ((prompt: string) => Promise<void>) | null
	seenMessageIds: React.MutableRefObject<Set<string>>
	firstTextMessageSkipped: React.MutableRefObject<boolean>
	permissionMode: PermissionMode
	onPermissionModeChange: (mode: PermissionMode) => void
}

export interface UseTaskSubmitReturn {
	handleSubmit: (text: string) => Promise<void>
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
	seenMessageIds,
	firstTextMessageSkipped,
	permissionMode,
	onPermissionModeChange,
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
						// Reset CLI state and send clearTask to extension.
						useCLIStore.getState().reset()

						// Reset component-level refs to avoid stale message tracking.
						seenMessageIds.current.clear()
						firstTextMessageSkipped.current = false
						sendToExtension({ type: "clearTask" })

						// Re-request state, commands and modes since reset() cleared them.
						sendToExtension({ type: "requestCommands" })
						sendToExtension({ type: "requestModes" })
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
			seenMessageIds,
			firstTextMessageSkipped,
			permissionMode,
			onPermissionModeChange,
		],
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
		handleApprove,
		handleReject,
	}
}
