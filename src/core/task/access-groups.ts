/**
 * Shared member groups for the task-side `*Access` seams (R3-8).
 *
 * Task passes `this` to each helper module through a narrow "declare what I
 * touch" interface (TaskApiLoopAccess, TaskMessageLogAccess, ...). The members
 * below recur across many of those interfaces; each is now declared exactly
 * ONCE, here, and the per-module interfaces extend the groups they need - the
 * composition precedent set by TaskStreamProcessorAccess.
 *
 * A group may only be extended by interfaces that touch EVERY member of it:
 * extending must never pull in a member the module does not use, or the seam
 * stops declaring what the module actually touches. Because the sets of
 * interfaces touching each member differ (TaskContextManager touches `api` but
 * not `abort`; TaskTokenTracking touches only `taskId` and `clineMessages`;
 * TaskLifecycle deliberately narrows `api` to the two methods it calls), the
 * recurring members cannot be bundled into one "core" interface - each forms
 * its own small group.
 */

import { type ApiHandler } from "../../api"
import { type ClineMessage, type ProviderSettings } from "@tumble-code/types"
import { type ApiMessage } from "../task-persistence"
import { type ClineProvider } from "../webview/ClineProvider"

/** Stable task id (survives resume); every helper module reads it. */
export interface TaskIdAccess {
	taskId: string
}

/** Weak link back to the owning provider (see Task#providerRef). */
export interface TaskProviderRefAccess {
	providerRef: WeakRef<ClineProvider>
}

/** Set by the Stop button / abort paths; long-running helpers poll it. */
export interface TaskAbortFlagAccess {
	abort: boolean
}

/** The task's API handler. */
export interface TaskApiHandlerAccess {
	api: ApiHandler
}

/**
 * The provider settings the task was created with: the profile its API handler
 * (`api`) was built from. `Task.updateApiConfiguration` replaces both together
 * when a profile is activated for the focused task (a mode switch to a mode with
 * a bound profile, a profile switch, a saved profile edit), so this always names
 * the profile that serves the task's next request. A background task or a
 * detached parent keeps its own profile here while the panel's active profile
 * (`getState().apiConfiguration`) belongs to the focused task.
 *
 * Per-profile behaviour of the task reads this, never the active profile. The
 * compact profile flag in particular is read with exactly
 * `isCompactProfile(this.access.apiConfiguration)` in a helper module, or
 * `isCompactProfile(task.apiConfiguration)` where a `Task` is at hand (tools,
 * getEnvironmentDetails), with `isCompactProfile` from `@tumble-code/types`.
 */
export interface TaskApiConfigurationAccess {
	apiConfiguration: ProviderSettings
}

/** The stored LLM conversation (persisted user/assistant turns). */
export interface TaskApiConversationHistoryAccess {
	apiConversationHistory: ApiMessage[]
}

/** The UI-facing message log (say/ask/tool messages). */
export interface TaskClineMessagesAccess {
	clineMessages: ClineMessage[]
}

/**
 * Timestamps of cline messages already captured for the cloud; see
 * Task#cloudSyncedMessageTimestamps. Forgetting one lets a revised message
 * (same ts) be captured again.
 */
export interface TaskCloudSyncTimestampsAccess {
	cloudSyncedMessageTimestamps: Set<number>
}

/**
 * Headless background task (parallel subagent / memory writer). The extending
 * interfaces keep comments describing their specific consequences of it.
 */
export interface TaskBackgroundFlagAccess {
	isBackground: boolean
}

/** Task working directory — may differ from the provider's (worktrees). */
export interface TaskWorkingDirectoryAccess {
	cwd: string
}
