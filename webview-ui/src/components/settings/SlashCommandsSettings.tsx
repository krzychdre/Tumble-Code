import React, { useState, useEffect, useMemo, useCallback } from "react"
import { Plus, Globe, Folder, Edit, Trash2 } from "lucide-react"

import type { Command } from "@tumble-code/types"

import { useAppTranslation } from "@/i18n/TranslationContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	Button,
	StandardTooltip,
} from "@/components/ui"
import { vscode } from "@/utils/vscode"
import { cn } from "@/lib/utils"

import { SectionHeader } from "./SectionHeader"
import { SettingsCard, settingDescription } from "./SettingsCard"
import { CreateSlashCommandDialog } from "./CreateSlashCommandDialog"

export const SlashCommandsSettings: React.FC = () => {
	const { t } = useAppTranslation()
	const { commands: rawCommands, cwd } = useExtensionState()
	const commands = useMemo(() => rawCommands ?? [], [rawCommands])

	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
	const [commandToDelete, setCommandToDelete] = useState<Command | null>(null)
	const [createDialogOpen, setCreateDialogOpen] = useState(false)

	// Check if we're in a workspace/project
	const hasWorkspace = Boolean(cwd)

	const handleRefresh = useCallback(() => {
		vscode.postMessage({ type: "requestCommands" })
	}, [])

	// Request commands when component mounts
	useEffect(() => {
		handleRefresh()
	}, [handleRefresh])

	const handleDeleteClick = useCallback((command: Command) => {
		setCommandToDelete(command)
		setDeleteDialogOpen(true)
	}, [])

	const handleDeleteConfirm = useCallback(() => {
		if (commandToDelete) {
			vscode.postMessage({
				type: "deleteCommand",
				text: commandToDelete.name,
				values: { source: commandToDelete.source },
			})
			setDeleteDialogOpen(false)
			setCommandToDelete(null)
			// Refresh the commands list after deletion
			setTimeout(handleRefresh, 100)
		}
	}, [commandToDelete, handleRefresh])

	const handleDeleteCancel = useCallback(() => {
		setDeleteDialogOpen(false)
		setCommandToDelete(null)
	}, [])

	const handleEditClick = useCallback((command: Command) => {
		if (command.filePath) {
			vscode.postMessage({
				type: "openFile",
				text: command.filePath,
			})
		} else {
			// Fallback: request to open command file by name and source
			vscode.postMessage({
				type: "openCommandFile",
				text: command.name,
				values: { source: command.source },
			})
		}
	}, [])

	// No-op callback - the backend sends updated commands list via ExtensionStateContext
	const handleCommandCreated = useCallback(() => {
		setTimeout(handleRefresh, 500)
	}, [handleRefresh])

	// Group commands by source
	const projectCommands = useMemo(() => commands.filter((cmd) => cmd.source === "project"), [commands])
	const globalCommands = useMemo(() => commands.filter((cmd) => cmd.source === "global"), [commands])

	// Render a single command item
	const renderCommandItem = useCallback(
		(command: Command) => {
			const isBuiltIn = command.source === "built-in"

			return (
				<div key={`${command.source}-${command.name}`} className="min-w-0">
					<div className="flex items-start justify-between gap-2 flex-col min-[400px]:flex-row overflow-hidden">
						<div className="flex-1 min-w-0">
							{/* Command name */}
							<div className="flex items-center gap-2 overflow-hidden">
								<span className="font-medium truncate">{command.name}</span>
							</div>
							{/* Command description */}
							{command.description && (
								<div className={cn(settingDescription, "line-clamp-3")}>
									{command.description}
								</div>
							)}
						</div>

						{/* Actions */}
						<div className="flex items-center gap-1 flex-shrink-0">
							<StandardTooltip content={t("settings:slashCommands.editCommand")}>
								<Button
									aria-label={t("settings:slashCommands.editCommand")}
									variant="ghost"
									size="icon"
									onClick={() => handleEditClick(command)}>
									<Edit />
								</Button>
							</StandardTooltip>

							{!isBuiltIn && (
								<StandardTooltip content={t("settings:slashCommands.deleteCommand")}>
									<Button
										aria-label={t("settings:slashCommands.deleteCommand")}
										variant="ghost"
										size="icon"
										onClick={() => handleDeleteClick(command)}>
										<Trash2 className="text-destructive" />
									</Button>
								</StandardTooltip>
							)}
						</div>
					</div>
				</div>
			)
		},
		[t, handleEditClick, handleDeleteClick],
	)

	return (
		<div className="flex flex-col h-full overflow-hidden">
			{/* Fixed Header */}
			<div className="flex-shrink-0">
				<SectionHeader>{t("settings:sections.slashCommands")}</SectionHeader>
				<div className="flex flex-col gap-row px-5 py-row">
					<p className="text-vscode-descriptionForeground text-sm m-0">
						{t("settings:slashCommands.description")}
					</p>

					{/* Add Command button */}
					<Button variant="secondary" onClick={() => setCreateDialogOpen(true)}>
						<Plus />
						{t("settings:slashCommands.addCommand")}
					</Button>
				</div>
			</div>

			{/* Scrollable List Area */}
			<div className="flex-1 overflow-y-auto px-5 pt-section pb-page min-h-0">
				<div className="flex flex-col gap-section">
					{/* Project Commands Section - Only show if in a workspace */}
					{hasWorkspace && (
						<SettingsCard
							title={
								<span className="flex items-center gap-1.5">
									<Folder className="size-3.5 shrink-0" aria-hidden="true" />
									{t("settings:slashCommands.workspaceCommands")}
								</span>
							}>
							{projectCommands.length > 0 ? (
								projectCommands.map(renderCommandItem)
							) : (
								<div className="text-sm text-vscode-descriptionForeground cursor-default">
									{t("settings:slashCommands.noWorkspaceCommands")}
								</div>
							)}
						</SettingsCard>
					)}

					{/* Global Commands Section */}
					<SettingsCard
						title={
							<span className="flex items-center gap-1.5">
								<Globe className="size-3.5 shrink-0" aria-hidden="true" />
								{t("settings:slashCommands.globalCommands")}
							</span>
						}>
						{globalCommands.length > 0 ? (
							globalCommands.map(renderCommandItem)
						) : (
							<div className="text-sm text-vscode-descriptionForeground cursor-default">
								{t("settings:slashCommands.noGlobalCommands")}
							</div>
						)}
					</SettingsCard>
				</div>
			</div>

			{/* Fixed Footer */}
			<div className="px-5 py-1.5 text-sm border-t border-frame text-vscode-descriptionForeground">
				{t("settings:slashCommands.footer")}
			</div>

			{/* Delete Confirmation Dialog */}
			<AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t("settings:slashCommands.deleteDialog.title")}</AlertDialogTitle>
						<AlertDialogDescription>
							{t("settings:slashCommands.deleteDialog.description", { name: commandToDelete?.name })}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel onClick={handleDeleteCancel}>
							{t("settings:slashCommands.deleteDialog.cancel")}
						</AlertDialogCancel>
						<AlertDialogAction onClick={handleDeleteConfirm}>
							{t("settings:slashCommands.deleteDialog.confirm")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{/* Create Command Dialog */}
			<CreateSlashCommandDialog
				open={createDialogOpen}
				onOpenChange={setCreateDialogOpen}
				onCommandCreated={handleCommandCreated}
				hasWorkspace={hasWorkspace}
			/>
		</div>
	)
}
