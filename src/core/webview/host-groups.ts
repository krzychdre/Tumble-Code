/**
 * Shared member groups for the webview-side `*Host` seams (R3-8).
 *
 * ClineProvider passes `this` to its collaborators (WebviewStatePusher,
 * TaskHistoryGateway, DelegationService, CloudProfileSync, ...) through narrow
 * "declare what I touch" interfaces. The members below recur across several of
 * those interfaces; each is now declared exactly ONCE, here, and the per-module
 * interfaces extend the groups they need - the same composition pattern the
 * task-side Access interfaces follow (src/core/task/access-groups.ts).
 *
 * A group may only be extended by interfaces that touch EVERY member of it:
 * extending must never pull in a member the module does not use, or the seam
 * stops declaring what the module actually touches. Because the sets of
 * interfaces touching each member differ (TaskHistoryGateway needs
 * `clearCurrentTask` but not `getCurrentTask`'s full Task type; WebviewStatePusher
 * needs `getCurrentTask` but never `clearCurrentTask`), the recurring members
 * each form their own small group instead of one "core" interface.
 */

import type { ContextProxy } from "../config/ContextProxy"
import type { ProviderSettingsManager } from "../config/ProviderSettingsManager"
import type { Task } from "../task/Task"
import type { TaskHistoryStore } from "../task-persistence"
import type { ExtensionMessage, HistoryItem } from "@tumble-code/types"

/** The provider's ContextProxy handle, narrowed to the methods the module calls. */
export interface ContextProxyHostMember {
	readonly contextProxy: Pick<ContextProxy, "getValue" | "setValue">
}

/** The provider's profile manager, narrowed to the methods the module calls. */
export interface ProviderSettingsManagerHostMember {
	readonly providerSettingsManager: Pick<ProviderSettingsManager, "listConfig" | "getProfile">
}

/**
 * The current foreground task (the slot's occupant), if any. The extending
 * interfaces keep comments describing their specific uses of it.
 */
export interface CurrentTaskHostMember {
	getCurrentTask(): Task | undefined
}

/** Persists the item and broadcasts it to the webview. */
export interface UpdateTaskHistoryHostMember {
	updateTaskHistory(item: HistoryItem): Promise<void>
}

/** Reads the provider's task-history store (lookup by id). */
export interface TaskHistoryStoreHostMember {
	getTaskHistoryStore(): Promise<Pick<TaskHistoryStore, "get">>
}

/** Posts one message to the webview; drops it silently when disposed. */
export interface PostMessageHostMember {
	postMessageToWebview(message: ExtensionMessage): Promise<void>
}

/**
 * Reactivates a provider profile by name. CloudProfileSync returns `unknown`
 * (it ignores the result); ModeProfileBinding's wider signature accepts the
 * same `{ name: string }` calls, so both can share this group.
 */
export interface ActivateProfileHostMember {
	activateProviderProfile(args: { name: string }): Promise<unknown>
}
