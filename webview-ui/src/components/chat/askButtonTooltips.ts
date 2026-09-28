import type { AskButtonKind } from "./hooks/useAskButtons"

/**
 * §2.6: the tooltip for each approval button is looked up by the button's
 * `kind` (set alongside its label by useAskButtons), never by comparing the
 * translated label. The primary action answers with Ctrl/Cmd+Enter and the
 * secondary with Esc (handled in ChatView), so both shortcuts are named in
 * the tooltip.
 */

const isMac = typeof navigator !== "undefined" && navigator.platform.toUpperCase().indexOf("MAC") >= 0

export const PRIMARY_ACTION_SHORTCUT = isMac ? "⌘+Enter" : "Ctrl+Enter"
export const SECONDARY_ACTION_SHORTCUT = "Esc"

/** kind -> tooltip translation key. Kinds without a tooltip key (the
 *  "complete subtask" label is its own explanation) get the shortcut hint
 *  alone. */
const TOOLTIP_KEYS: Partial<Record<AskButtonKind, string>> = {
	retry: "chat:retry.tooltip",
	startNewTask: "chat:startNewTask.tooltip",
	proceedAnyways: "chat:proceedAnyways.tooltip",
	save: "chat:save.tooltip",
	reject: "chat:reject.tooltip",
	approve: "chat:approve.tooltip",
	"read-batch.approve": "chat:approve.tooltip",
	"read-batch.deny": "chat:reject.tooltip",
	"list-batch.approve": "chat:approve.tooltip",
	"list-batch.deny": "chat:reject.tooltip",
	"edit-batch.approve": "chat:save.tooltip",
	"edit-batch.deny": "chat:reject.tooltip",
	runCommand: "chat:runCommand.tooltip",
	proceedWhileRunning: "chat:proceedWhileRunning.tooltip",
	killCommand: "chat:killCommand.tooltip",
	resumeTask: "chat:resumeTask.tooltip",
	terminate: "chat:terminate.tooltip",
	completeSubtaskAndReturn: undefined,
}

/** The tooltip translation key for a button kind, or undefined when unknown. */
export const askButtonTooltipKey = (kind: AskButtonKind | undefined): string | undefined =>
	kind === undefined ? undefined : TOOLTIP_KEYS[kind]

/** The shortcut that answers with this button, by slot. */
export const askButtonShortcut = (role: "primary" | "secondary"): string =>
	role === "primary" ? PRIMARY_ACTION_SHORTCUT : SECONDARY_ACTION_SHORTCUT
