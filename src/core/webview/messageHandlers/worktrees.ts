// Git worktree management.

import * as vscode from "vscode"
import { t } from "../../../i18n"
import {
	handleListWorktrees,
	handleCreateWorktree,
	handleDeleteWorktree,
	handleSwitchWorktree,
	handleGetAvailableBranches,
	handleGetWorktreeDefaults,
	handleGetWorktreeIncludeStatus,
	handleCreateWorktreeInclude,
} from "../worktree"
import type { MessageHandlerMap } from "./types"

export const worktreesHandlers: MessageHandlerMap = {
	listWorktrees: async (ctx) => {
		const { provider } = ctx
		try {
			const { worktrees, isGitRepo, isMultiRoot, isSubfolder, gitRootPath, error } =
				await handleListWorktrees(provider)

			await provider.postMessageToWebview({
				type: "worktreeList",
				worktrees,
				isGitRepo,
				isMultiRoot,
				isSubfolder,
				gitRootPath,
				error,
			})
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)

			await provider.postMessageToWebview({
				type: "worktreeList",
				worktrees: [],
				isGitRepo: false,
				isMultiRoot: false,
				isSubfolder: false,
				gitRootPath: "",
				error: errorMessage,
			})
		}
	},

	createWorktree: async (ctx, message) => {
		const { provider } = ctx
		try {
			const { success, message: text } = await handleCreateWorktree(
				provider,
				{
					path: message.worktreePath!,
					branch: message.worktreeBranch,
					baseBranch: message.worktreeBaseBranch,
					createNewBranch: message.worktreeCreateNewBranch,
				},
				(progress) => {
					provider.postMessageToWebview({
						type: "worktreeCopyProgress",
						copyProgressBytesCopied: progress.bytesCopied,
						copyProgressItemName: progress.itemName,
					})
				},
			)

			await provider.postMessageToWebview({ type: "worktreeResult", success, text })
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			await provider.postMessageToWebview({ type: "worktreeResult", success: false, text: errorMessage })
		}
	},

	deleteWorktree: async (ctx, message) => {
		const { provider } = ctx
		try {
			const { success, message: text } = await handleDeleteWorktree(
				provider,
				message.worktreePath!,
				message.worktreeForce ?? false,
			)

			await provider.postMessageToWebview({ type: "worktreeResult", success, text })
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			await provider.postMessageToWebview({ type: "worktreeResult", success: false, text: errorMessage })
		}
	},

	switchWorktree: async (ctx, message) => {
		const { provider } = ctx
		try {
			const { success, message: text } = await handleSwitchWorktree(
				provider,
				message.worktreePath!,
				message.worktreeNewWindow ?? true,
			)

			await provider.postMessageToWebview({ type: "worktreeResult", success, text })
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			await provider.postMessageToWebview({ type: "worktreeResult", success: false, text: errorMessage })
		}
	},

	getAvailableBranches: async (ctx) => {
		const { provider } = ctx
		try {
			const { localBranches, remoteBranches, currentBranch } = await handleGetAvailableBranches(provider)

			await provider.postMessageToWebview({
				type: "branchList",
				localBranches,
				remoteBranches,
				currentBranch,
			})
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)

			await provider.postMessageToWebview({
				type: "branchList",
				localBranches: [],
				remoteBranches: [],
				currentBranch: "",
				error: errorMessage,
			})
		}
	},

	getWorktreeDefaults: async (ctx) => {
		const { provider } = ctx
		try {
			const { suggestedBranch, suggestedPath } = await handleGetWorktreeDefaults(provider)
			await provider.postMessageToWebview({ type: "worktreeDefaults", suggestedBranch, suggestedPath })
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)

			await provider.postMessageToWebview({
				type: "worktreeDefaults",
				suggestedBranch: "",
				suggestedPath: "",
				error: errorMessage,
			})
		}
	},

	getWorktreeIncludeStatus: async (ctx) => {
		const { provider } = ctx
		try {
			const worktreeIncludeStatus = await handleGetWorktreeIncludeStatus(provider)
			await provider.postMessageToWebview({ type: "worktreeIncludeStatus", worktreeIncludeStatus })
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)

			await provider.postMessageToWebview({
				type: "worktreeIncludeStatus",
				worktreeIncludeStatus: {
					exists: false,
					hasGitignore: false,
					gitignoreContent: undefined,
				},
				error: errorMessage,
			})
		}
	},

	createWorktreeInclude: async (ctx, message) => {
		const { provider } = ctx
		try {
			const { success, message: text } = await handleCreateWorktreeInclude(
				provider,
				message.worktreeIncludeContent ?? "",
			)

			await provider.postMessageToWebview({ type: "worktreeResult", success, text })
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			provider.log(`Error creating worktree include: ${errorMessage}`)
			await provider.postMessageToWebview({ type: "worktreeResult", success: false, text: errorMessage })
		}
	},

	browseForWorktreePath: async (ctx) => {
		const { provider } = ctx
		try {
			const options: vscode.OpenDialogOptions = {
				canSelectFiles: false,
				canSelectFolders: true,
				canSelectMany: false,
				openLabel: t("worktrees:selectWorktreeLocation"),
				title: t("worktrees:selectFolderForWorktree"),
				defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri
					? vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, "..")
					: undefined,
			}

			const result = await vscode.window.showOpenDialog(options)
			if (result && result[0]) {
				await provider.postMessageToWebview({
					type: "folderSelected",
					path: result[0].fsPath,
				})
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			provider.log(`Error opening folder picker: ${errorMessage}`)
		}
	},
}
