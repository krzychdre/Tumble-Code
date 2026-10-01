import React, { memo, useState, useMemo } from "react"
import { DeleteTaskDialog } from "./DeleteTaskDialog"
import { BatchDeleteTaskDialog } from "./BatchDeleteTaskDialog"
import { Virtuoso } from "react-virtuoso"

import {
	Button,
	LabeledCheckbox,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	StandardTooltip,
	ThemedTextField,
} from "@/components/ui"
import { useAppTranslation } from "@/i18n/TranslationContext"

import { Tab, TabContent, TabHeader, TabTitle } from "../common/Tab"
import { useTaskSearch } from "./useTaskSearch"
import { useGroupedTasks, toDayRows } from "./useGroupedTasks"
import { countAllSubtasks } from "./types"
import TaskItem from "./TaskItem"
import TaskGroupItem from "./TaskGroupItem"

type HistoryViewProps = {
	onDone: () => void
}

type SortOption = "newest" | "oldest" | "mostExpensive" | "mostTokens" | "mostRelevant"

const HistoryView = ({ onDone }: HistoryViewProps) => {
	const {
		tasks,
		searchQuery,
		setSearchQuery,
		sortOption,
		setSortOption,
		setLastNonRelevantSort,
		showAllWorkspaces,
		setShowAllWorkspaces,
	} = useTaskSearch()
	const { t } = useAppTranslation()

	// Use grouped tasks hook
	const { groups, flatTasks, toggleExpand, isSearchMode } = useGroupedTasks(tasks, searchQuery)
	// §2.9: day headers interleaved with the (unchanged) parent-child groups.
	const dayRows = useMemo(() => toDayRows(groups, t), [groups, t])
	// §2.9: `tasks` is already search-filtered, so an empty search result set
	// also reads as tasks.length === 0 — check the search-empty state first.
	const hasNoSearchResults = isSearchMode && tasks.length === 0
	const hasNoTasks = tasks.length === 0

	const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null)
	const [deleteSubtaskCount, setDeleteSubtaskCount] = useState<number>(0)
	const [isSelectionMode, setIsSelectionMode] = useState(false)
	const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([])
	const [showBatchDeleteDialog, setShowBatchDeleteDialog] = useState<boolean>(false)

	// Get subtask count for a task (recursive total)
	const getSubtaskCount = useMemo(() => {
		const countMap = new Map<string, number>()
		for (const group of groups) {
			countMap.set(group.parent.id, countAllSubtasks(group.subtasks))
		}
		return (taskId: string) => countMap.get(taskId) || 0
	}, [groups])

	// Handle delete with subtask count
	const handleDelete = (taskId: string) => {
		setDeleteTaskId(taskId)
		setDeleteSubtaskCount(getSubtaskCount(taskId))
	}

	// Toggle selection mode
	const toggleSelectionMode = () => {
		setIsSelectionMode(!isSelectionMode)
		if (isSelectionMode) {
			setSelectedTaskIds([])
		}
	}

	// Toggle selection for a single task
	const toggleTaskSelection = (taskId: string, isSelected: boolean) => {
		if (isSelected) {
			setSelectedTaskIds((prev) => [...prev, taskId])
		} else {
			setSelectedTaskIds((prev) => prev.filter((id) => id !== taskId))
		}
	}

	// Toggle select all tasks
	const toggleSelectAll = (selectAll: boolean) => {
		if (selectAll) {
			setSelectedTaskIds(tasks.map((task) => task.id))
		} else {
			setSelectedTaskIds([])
		}
	}

	// Handle batch delete button click
	const handleBatchDelete = () => {
		if (selectedTaskIds.length > 0) {
			setShowBatchDeleteDialog(true)
		}
	}

	return (
		<Tab>
			<TabHeader className="flex flex-col gap-2">
				<div className="flex items-center justify-between gap-2">
					<TabTitle
						title={t("history:history")}
						backLabel={t("history:done")}
						onBack={onDone}
						backTestId="history-done-button"
					/>
					<StandardTooltip
						content={
							isSelectionMode ? `${t("history:exitSelectionMode")}` : `${t("history:enterSelectionMode")}`
						}>
						<Button
							variant={isSelectionMode ? "primary" : "secondary"}
							onClick={toggleSelectionMode}
							data-testid="toggle-selection-mode-button">
							<span
								className={`codicon ${isSelectionMode ? "codicon-check-all" : "codicon-checklist"} mr-1`}
								aria-hidden="true"
							/>
							{isSelectionMode ? t("history:exitSelection") : t("history:selectionMode")}
						</Button>
					</StandardTooltip>
				</div>
				<div className="flex flex-col gap-2">
					<ThemedTextField
						className="w-full"
						placeholder={t("history:searchPlaceholder")}
						value={searchQuery}
						data-testid="history-search-input"
						onInput={(e) => {
							const newValue = (e.target as HTMLInputElement)?.value
							setSearchQuery(newValue)
							if (newValue && !searchQuery && sortOption !== "mostRelevant") {
								setLastNonRelevantSort(sortOption)
								setSortOption("mostRelevant")
							}
						}}>
						<div slot="start" className="codicon codicon-search mt-0.5 opacity-80 text-sm!" />
						{searchQuery && (
							<div
								className="input-icon-button codicon codicon-close flex justify-center items-center h-full"
								aria-label={t("history:clearSearch")}
								onClick={() => setSearchQuery("")}
								slot="end"
							/>
						)}
					</ThemedTextField>
					<div className="flex gap-2">
						<Select
							value={showAllWorkspaces ? "all" : "current"}
							onValueChange={(value) => setShowAllWorkspaces(value === "all")}>
							<SelectTrigger className="flex-1">
								<SelectValue>
									{t("history:workspace.prefix")}{" "}
									{t(`history:workspace.${showAllWorkspaces ? "all" : "current"}`)}
								</SelectValue>
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="current">
									<div className="flex items-center gap-2">
										<span className="codicon codicon-folder" aria-hidden="true" />
										{t("history:workspace.current")}
									</div>
								</SelectItem>
								<SelectItem value="all">
									<div className="flex items-center gap-2">
										<span className="codicon codicon-folder-opened" aria-hidden="true" />
										{t("history:workspace.all")}
									</div>
								</SelectItem>
							</SelectContent>
						</Select>
						<Select value={sortOption} onValueChange={(value) => setSortOption(value as SortOption)}>
							<SelectTrigger className="flex-1">
								<SelectValue>
									{t("history:sort.prefix")} {t(`history:sort.${sortOption}`)}
								</SelectValue>
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="newest" data-testid="select-newest">
									<div className="flex items-center gap-2">
										<span className="codicon codicon-arrow-down" aria-hidden="true" />
										{t("history:newest")}
									</div>
								</SelectItem>
								<SelectItem value="oldest" data-testid="select-oldest">
									<div className="flex items-center gap-2">
										<span className="codicon codicon-arrow-up" aria-hidden="true" />
										{t("history:oldest")}
									</div>
								</SelectItem>
								<SelectItem value="mostExpensive" data-testid="select-most-expensive">
									<div className="flex items-center gap-2">
										<span className="codicon codicon-credit-card" aria-hidden="true" />
										{t("history:mostExpensive")}
									</div>
								</SelectItem>
								<SelectItem value="mostTokens" data-testid="select-most-tokens">
									<div className="flex items-center gap-2">
										<span className="codicon codicon-symbol-numeric" aria-hidden="true" />
										{t("history:mostTokens")}
									</div>
								</SelectItem>
								<SelectItem
									value="mostRelevant"
									disabled={!searchQuery}
									data-testid="select-most-relevant">
									<div className="flex items-center gap-2">
										<span className="codicon codicon-search" aria-hidden="true" />
										{t("history:mostRelevant")}
									</div>
								</SelectItem>
							</SelectContent>
						</Select>
					</div>

					{/* Select all control in selection mode */}
					{isSelectionMode && tasks.length > 0 && (
						<div className="flex items-center py-1">
							<div className="flex items-center gap-2">
								<LabeledCheckbox
									checked={tasks.length > 0 && selectedTaskIds.length === tasks.length}
									onCheckedChange={(checked) => toggleSelectAll(checked === true)}
								/>
								<span className="text-vscode-foreground">
									{selectedTaskIds.length === tasks.length
										? t("history:deselectAll")
										: t("history:selectAll")}
								</span>
								<span className="ml-auto text-vscode-descriptionForeground text-xs">
									{t("history:selectedItems", {
										selected: selectedTaskIds.length,
										total: tasks.length,
									})}
								</span>
							</div>
						</div>
					)}
				</div>
			</TabHeader>

			<TabContent className="px-2 py-0">
				{hasNoSearchResults ? (
					// §2.9: empty states — no search hits must be checked before the
					// plain "no history" one, because `tasks` is already filtered.
					<div
						data-testid="history-empty-search"
						className="flex flex-col items-center justify-center gap-2 py-16 text-vscode-descriptionForeground">
						<span className="codicon codicon-search size-6 text-base" aria-hidden="true" />
						<p>{t("history:noSearchResults")}</p>
					</div>
				) : hasNoTasks ? (
					<div
						data-testid="history-empty-state"
						className="flex flex-col items-center justify-center gap-2 py-16 text-vscode-descriptionForeground">
						<span className="codicon codicon-history size-6 text-base" aria-hidden="true" />
						<p>{t("history:noHistory")}</p>
					</div>
				) : isSearchMode && flatTasks ? (
					// Search mode: flat list with subtask prefix
					<Virtuoso
						className="flex-1 overflow-y-scroll"
						data={flatTasks}
						data-testid="virtuoso-container"
						initialTopMostItemIndex={0}
						components={{
							List: React.forwardRef((props, ref) => (
								<div {...props} ref={ref} data-testid="virtuoso-item-list" />
							)),
						}}
						itemContent={(_index, item) => (
							<TaskItem
								key={item.id}
								item={item}
								variant="full"
								showWorkspace={showAllWorkspaces}
								isSelectionMode={isSelectionMode}
								isSelected={selectedTaskIds.includes(item.id)}
								onToggleSelection={toggleTaskSelection}
								onDelete={handleDelete}
								className="m-2"
							/>
						)}
					/>
				) : (
					// Grouped mode (§2.9): day headers interleaved with the
					// parent-child groups; subtask trees unchanged.
					<Virtuoso
						className="flex-1 overflow-y-scroll"
						data={dayRows}
						data-testid="virtuoso-container"
						initialTopMostItemIndex={0}
						components={{
							List: React.forwardRef((props, ref) => (
								<div {...props} ref={ref} data-testid="virtuoso-item-list" />
							)),
						}}
						itemContent={(_index, row) =>
							row.type === "day-header" ? (
								<div
									key={row.key}
									data-testid={`history-day-${row.day}`}
									className="px-4 pt-4 pb-1 text-[length:var(--text-meta)] uppercase tracking-wide text-vscode-descriptionForeground select-none">
									{row.label}
								</div>
							) : (
								<TaskGroupItem
									key={row.key}
									group={row.group}
									variant="full"
									showWorkspace={showAllWorkspaces}
									isSelectionMode={isSelectionMode}
									isSelected={selectedTaskIds.includes(row.group.parent.id)}
									onToggleSelection={toggleTaskSelection}
									onDelete={handleDelete}
									onToggleExpand={() => toggleExpand(row.group.parent.id)}
									onToggleSubtaskExpand={toggleExpand}
									className="m-2"
								/>
							)
						}
					/>
				)}
			</TabContent>

			{/* Fixed action bar at bottom - only shown in selection mode with selected items */}
			{isSelectionMode && selectedTaskIds.length > 0 && (
				<div className="fixed bottom-0 left-0 right-2 bg-vscode-editor-background border-t border-vscode-panel-border p-2 flex justify-between items-center">
					<div className="text-vscode-foreground">
						{t("history:selectedItems", { selected: selectedTaskIds.length, total: tasks.length })}
					</div>
					<div className="flex gap-2">
						<Button variant="secondary" onClick={() => setSelectedTaskIds([])}>
							{t("history:clearSelection")}
						</Button>
						<Button variant="primary" onClick={handleBatchDelete}>
							{t("history:deleteSelected")}
						</Button>
					</div>
				</div>
			)}

			{/* Delete dialog */}
			{deleteTaskId && (
				<DeleteTaskDialog
					taskId={deleteTaskId}
					subtaskCount={deleteSubtaskCount}
					onOpenChange={(open) => {
						if (!open) {
							setDeleteTaskId(null)
							setDeleteSubtaskCount(0)
						}
					}}
					open
				/>
			)}

			{/* Batch delete dialog */}
			{showBatchDeleteDialog && (
				<BatchDeleteTaskDialog
					taskIds={selectedTaskIds}
					open={showBatchDeleteDialog}
					onOpenChange={(open) => {
						if (!open) {
							setShowBatchDeleteDialog(false)
							setSelectedTaskIds([])
							setIsSelectionMode(false)
						}
					}}
				/>
			)}
		</Tab>
	)
}

export default memo(HistoryView)
