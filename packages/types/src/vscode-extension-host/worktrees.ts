/*
 * Extension host channel, worktrees domain: the webview requests handled by
 * src/core/webview/messageHandlers/worktrees.ts and the host to view
 * messages of the same domain.
 */

/** Git worktrees and branches. */
export type WorktreesWebviewMessageType =
	| "listWorktrees"
	| "createWorktree"
	| "deleteWorktree"
	| "switchWorktree"
	| "getAvailableBranches"
	| "getWorktreeDefaults"
	| "getWorktreeIncludeStatus"
	| "createWorktreeInclude"
	| "browseForWorktreePath"

/** Git worktree and branch replies. */
export type WorktreesExtensionMessageType =
	| "worktreeList"
	| "worktreeResult"
	| "worktreeCopyProgress"
	| "branchList"
	| "worktreeDefaults"
	| "worktreeIncludeStatus"
	| "folderSelected"
