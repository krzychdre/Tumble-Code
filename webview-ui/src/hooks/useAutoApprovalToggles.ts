import { useMemo } from "react"
import { useExtensionSelector } from "@src/context/ExtensionStateContext"

/**
 * Custom hook that creates and returns the auto-approval toggles object
 * This encapsulates the logic for creating the toggles object from extension state
 */
export function useAutoApprovalToggles() {
	// P1: narrow slices.
	const alwaysAllowReadOnly = useExtensionSelector((s) => s.alwaysAllowReadOnly)
	const alwaysAllowWrite = useExtensionSelector((s) => s.alwaysAllowWrite)
	const alwaysAllowExecute = useExtensionSelector((s) => s.alwaysAllowExecute)
	const alwaysAllowMcp = useExtensionSelector((s) => s.alwaysAllowMcp)
	const alwaysAllowModeSwitch = useExtensionSelector((s) => s.alwaysAllowModeSwitch)
	const alwaysAllowSubtasks = useExtensionSelector((s) => s.alwaysAllowSubtasks)
	const alwaysApprovePlan = useExtensionSelector((s) => s.alwaysApprovePlan)
	const alwaysAllowFollowupQuestions = useExtensionSelector((s) => s.alwaysAllowFollowupQuestions)

	const toggles = useMemo(
		() => ({
			alwaysAllowReadOnly,
			alwaysAllowWrite,
			alwaysAllowExecute,
			alwaysAllowMcp,
			alwaysAllowModeSwitch,
			alwaysAllowSubtasks,
			alwaysApprovePlan,
			alwaysAllowFollowupQuestions,
		}),
		[
			alwaysAllowReadOnly,
			alwaysAllowWrite,
			alwaysAllowExecute,
			alwaysAllowMcp,
			alwaysAllowModeSwitch,
			alwaysAllowSubtasks,
			alwaysApprovePlan,
			alwaysAllowFollowupQuestions,
		],
	)

	return toggles
}
