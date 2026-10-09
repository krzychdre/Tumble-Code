import React, { useState, useCallback, useEffect, useMemo } from "react"
import { GitBranch, Check, ChevronDown, Plus } from "lucide-react"

import type { Worktree, WorktreeListResponse, ExtensionMessage } from "@tumble-code/types"

import { cn } from "@/lib/utils"
import { useRooPortal } from "@/components/ui/hooks/useRooPortal"
import { IconButton, Popover, PopoverContent, PopoverTrigger, StandardTooltip, Button } from "@/components/ui"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { vscode } from "@/utils/vscode"

import { CreateWorktreeModal } from "../worktrees/CreateWorktreeModal"
import { onExtensionMessage } from "@src/utils/extensionBus"

interface WorktreeSelectorProps {
	disabled?: boolean
}

export const WorktreeSelector = ({ disabled = false }: WorktreeSelectorProps) => {
	const { t } = useAppTranslation()
	const [open, setOpen] = useState(false)
	const [worktrees, setWorktrees] = useState<Worktree[]>([])
	const [isGitRepo, setIsGitRepo] = useState(true)
	const [showCreateModal, setShowCreateModal] = useState(false)
	const portalContainer = useRooPortal("roo-portal")

	// Find current worktree
	const currentWorktree = useMemo(() => worktrees.find((w) => w.isCurrent), [worktrees])

	// Fetch worktrees when popover opens
	const fetchWorktrees = useCallback(() => {
		vscode.postMessage({ type: "listWorktrees" })
	}, [])

	// Handle messages from extension
	useEffect(() => {
		const handleMessage = (message: ExtensionMessage) => {
			if (message.type === "worktreeList") {
				const response = message as unknown as WorktreeListResponse
				setWorktrees(response.worktrees || [])
				setIsGitRepo(response.isGitRepo)
			}
		}

		return onExtensionMessage("worktreeList", handleMessage)
	}, [])

	// Initial fetch and refresh on open
	useEffect(() => {
		fetchWorktrees()
	}, [fetchWorktrees])

	useEffect(() => {
		if (open) {
			fetchWorktrees()
		}
	}, [open, fetchWorktrees])

	const handleSelect = useCallback((worktreePath: string) => {
		vscode.postMessage({
			type: "switchWorktree",
			worktreePath: worktreePath,
			worktreeNewWindow: false,
		})
		setOpen(false)
	}, [])

	const handleSettingsClick = useCallback(() => {
		vscode.postMessage({
			type: "switchTab",
			tab: "settings",
			values: { section: "worktrees" },
		})
		setOpen(false)
	}, [])

	// Don't render if not a git repo or only one worktree
	if (!isGitRepo || worktrees.length <= 1) {
		return null
	}

	const title = t("worktrees:selector.tooltip")

	return (
		<Popover open={open} onOpenChange={setOpen} data-testid="worktree-selector-root">
			<StandardTooltip content={title}>
				<PopoverTrigger
					disabled={disabled}
					data-testid="worktree-selector-trigger"
					className={cn(
						"inline-flex gap-1 mx-2 mb-1 items-center relative whitespace-nowrap h-[22px] px-[7px] rounded-control",
						"bg-transparent border border-frame text-vscode-foreground text-left text-xs",
						"transition-colors duration-150 focus:outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-vscode-focusBorder",
						disabled
							? "opacity-50 cursor-not-allowed"
							: "hover:bg-surface-hover hover:border-frame-hover cursor-pointer",
					)}>
					<span className="font-semibold mr-2">{t("worktrees:selector.worktree")}:</span>
					<GitBranch className="w-3 h-3" />
					<span className="truncate">{currentWorktree?.branch || t("worktrees:noBranch")}</span>
					<ChevronDown className="size-3 text-vscode-descriptionForeground" />
				</PopoverTrigger>
			</StandardTooltip>
			<PopoverContent
				align="start"
				sideOffset={4}
				container={portalContainer}
				className="p-0 overflow-hidden min-w-80 max-w-9/10">
				<div className="flex flex-col w-full">
					{/* Header with title, settings cog and description */}
					<div className="p-3 border-b border-frame">
						<div className="flex flex-row items-center justify-between pb-1">
							<h4 className="m-0 text-sm font-semibold">{t("worktrees:selector.title")}</h4>
							<IconButton
								icon="codicon-settings-gear"
								title={t("worktrees:selector.settings")}
								onClick={handleSettingsClick}
							/>
						</div>
						<p className="m-0 text-xs text-vscode-descriptionForeground">
							{t("worktrees:selector.description")}
						</p>
					</div>

					{/* Worktree list */}
					<div className="max-h-[300px] overflow-y-auto py-1">
						{worktrees.map((worktree) => {
							const isSelected = worktree.isCurrent
							return (
								<div
									key={worktree.path}
									onClick={() => !isSelected && handleSelect(worktree.path)}
									data-testid="worktree-selector-item"
									className={cn(
										"mx-1 px-2.5 py-1.5 text-sm cursor-pointer flex items-center rounded-control",
										isSelected ? "bg-selected" : "hover:bg-surface-hover",
									)}>
									<div className="flex-1 min-w-0">
										<div className="flex items-center gap-2">
											<GitBranch className="w-3 h-3 shrink-0" />
											<span className="font-semibold truncate">
												{worktree.branch || t("worktrees:noBranch")}
											</span>
											{worktree.isBare && (
												<span className="text-xs text-vscode-descriptionForeground">
													{t("worktrees:primary")}
												</span>
											)}
										</div>
										<div className="text-xs text-vscode-descriptionForeground ml-5 truncate">
											{worktree.path}
										</div>
									</div>
									{isSelected && <Check className="ml-auto size-4 p-0.5 text-vscode-focusBorder" />}
								</div>
							)
						})}
					</div>

					{/* New worktree button */}
					<div className="px-2 py-2 border-t border-frame">
						<Button
							variant="ghost"
							size="sm"
							className="w-full justify-start"
							onClick={() => {
								setShowCreateModal(true)
								setOpen(false)
							}}>
							<Plus className="w-3 h-3 mr-2" />
							{t("worktrees:newWorktree")}
						</Button>
					</div>
				</div>
			</PopoverContent>

			{/* Create Worktree Modal */}
			{showCreateModal && (
				<CreateWorktreeModal
					open={showCreateModal}
					onClose={() => setShowCreateModal(false)}
					openAfterCreate={true}
					onSuccess={() => {
						setShowCreateModal(false)
						fetchWorktrees()
					}}
				/>
			)}
		</Popover>
	)
}
