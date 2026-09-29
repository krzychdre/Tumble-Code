import { memo, useRef, useState, useMemo } from "react"
import { useTranslation } from "react-i18next"
import {
	ChevronUp,
	ChevronDown,
	HardDriveDownload,
	HardDriveUpload,
	FoldVertical,
	ArrowLeft,
	ArrowUp,
	ArrowDown,
} from "lucide-react"
import prettyBytes from "pretty-bytes"

import type { ClineMessage } from "@roo-code/types"

import { getModelMaxOutputTokens } from "@roo-code/core/browser"

import { formatLargeNumber } from "@src/utils/format"
import { cn } from "@src/lib/utils"
import { IconButton, StandardTooltip, Button } from "@src/components/ui"
import { useExtensionSelector } from "@src/context/ExtensionStateContext"
import { useSelectedModel } from "@/components/ui/hooks/useSelectedModel"
import { vscode } from "@src/utils/vscode"

import Thumbnails from "../common/Thumbnails"

import { TaskActions } from "./TaskActions"
import { ContextWindowProgress } from "./ContextWindowProgress"
import { Mention } from "./Mention"
import { TodoListDisplay } from "./TodoListDisplay"

/**
 * CostWithTooltip (§2.3, ai_plans/2026-09-27_ui-modernization.md): the cost
 * chip shown both collapsed (inline meta row) and expanded (details table).
 * One component instead of two diverging copies.
 */
const CostWithTooltip = ({
	totalCost,
	aggregatedCost,
	hasSubtasks,
	costBreakdown,
	t,
}: {
	totalCost: number
	aggregatedCost?: number
	hasSubtasks?: boolean
	costBreakdown?: string
	t: (key: string, opts?: Record<string, unknown>) => string
}) => (
	<StandardTooltip
		content={
			hasSubtasks ? (
				<div>
					<div>
						{t("chat:costs.totalWithSubtasks", {
							cost: (aggregatedCost ?? totalCost).toFixed(2),
						})}
					</div>
					{costBreakdown && <div className="text-xs mt-1">{costBreakdown}</div>}
				</div>
			) : (
				<div>{t("chat:costs.total", { cost: totalCost.toFixed(2) })}</div>
			)
		}
		side="top"
		sideOffset={8}>
		<span>
			${(aggregatedCost ?? totalCost).toFixed(2)}
			{hasSubtasks && (
				<span className="text-xs ml-1" title={t("chat:costs.includesSubtasks")}>
					*
				</span>
			)}
		</span>
	</StandardTooltip>
)

export interface TaskHeaderProps {
	task: ClineMessage
	tokensIn: number
	tokensOut: number
	cacheWrites?: number
	cacheReads?: number
	totalCost: number
	aggregatedCost?: number
	hasSubtasks?: boolean
	parentTaskId?: string
	costBreakdown?: string
	contextTokens: number
	buttonsDisabled: boolean
	handleCondenseContext: (taskId: string) => void
	todos?: any[]
}

const TaskHeader = ({
	task,
	tokensIn,
	tokensOut,
	cacheWrites,
	cacheReads,
	totalCost,
	aggregatedCost,
	hasSubtasks,
	parentTaskId,
	costBreakdown,
	contextTokens,
	buttonsDisabled,
	handleCondenseContext,
	todos,
}: TaskHeaderProps) => {
	const { t } = useTranslation()
	// P1: narrow slices. TaskHeader used to consume the whole extension state.
	const apiConfiguration = useExtensionSelector((s) => s.apiConfiguration)
	const currentTaskItem = useExtensionSelector((s) => s.currentTaskItem)
	const { id: modelId, info: model } = useSelectedModel(apiConfiguration)
	const [isTaskExpanded, setIsTaskExpanded] = useState(false)
	const textContainerRef = useRef<HTMLDivElement>(null)
	const textRef = useRef<HTMLDivElement>(null)
	const contextWindow = model?.contextWindow || 1

	// Calculate maxTokens (reserved for output) once for reuse in percentage and tooltip
	const maxTokens = useMemo(
		() =>
			model
				? getModelMaxOutputTokens({
						modelId,
						model,
						settings: apiConfiguration,
					})
				: 0,
		[model, modelId, apiConfiguration],
	)

	const condenseButton = (
		<IconButton
			title={t("chat:task.condenseContext")}
			icon={FoldVertical}
			disabled={buttonsDisabled}
			onClick={() => currentTaskItem && handleCondenseContext(currentTaskItem.id)}
		/>
	)

	const hasTodos = todos && Array.isArray(todos) && todos.length > 0

	// Determine if this is a subtask (has a parent)
	const isSubtask = !!parentTaskId

	const handleBackToParent = () => {
		if (parentTaskId) {
			vscode.postMessage({ type: "showTaskWithId", text: parentTaskId })
		}
	}

	// §2.3: the clickable header area is a real <button> with aria-expanded so
	// it is reachable with Tab and announced by screen readers (§1.4). The old
	// click-handler-on-a-div excluded interactive children; the same exclusions
	// are kept in a plain onClick.
	const detailsId = "task-header-details"

	const isInteractiveTarget = (target: EventTarget | null) => {
		if (!(target instanceof Element)) {
			return false
		}

		// Nested interactive elements keep their own clicks — except the
		// header toggle button itself, which IS the expand control.
		const button = target.closest("button")
		if (button && !button.hasAttribute("data-task-header-toggle")) {
			return true
		}

		return Boolean(
			target.closest('[role="button"]') ||
				target.closest(".share-button") ||
				target.closest("[data-radix-popper-content-wrapper]") ||
				target.closest("img") ||
				target.closest("[data-todo-list]") ||
				target.tagName === "IMG",
		)
	}

	const toggleExpanded = () => setIsTaskExpanded((prev) => !prev)

	const handleHeaderClick = (e: React.MouseEvent) => {
		if (isInteractiveTarget(e.target)) {
			return
		}

		// Don't expand/collapse if user is selecting text
		const selection = window.getSelection()
		if (selection && selection.toString().length > 0) {
			return
		}

		toggleExpanded()
	}

	return (
		<div className="group pt-2 pb-0 px-3">
			{isSubtask && (
				<div className="mb-2" onClick={(e) => e.stopPropagation()}>
					<Button
						variant="ghost"
						size="sm"
						onClick={handleBackToParent}
						className="flex items-center gap-1.5 text-xs text-vscode-descriptionForeground hover:text-vscode-foreground">
						<ArrowLeft className="size-3" />
						{t("chat:task.backToParentTask")}
					</Button>
				</div>
			)}
			<div
				className={cn(
					"px-3 pt-2.5 pb-2 flex flex-col gap-1.5 relative z-1",
					"bg-vscode-input-background hover:bg-vscode-input-background/90",
					"text-vscode-foreground/80 hover:text-vscode-foreground",
					// §2.3: flat like the editor tabs — a 1px panel-border bottom
					// border instead of shadow + rounded-xl.
					"border-b border-vscode-panel-border",
				)}
				onClick={handleHeaderClick}>
				<button
					type="button"
					data-task-header-toggle
					aria-expanded={isTaskExpanded}
					aria-controls={detailsId}
					// No onClick here on purpose: the click bubbles to the card's
					// single handler; handling it here too would toggle twice.
					className="flex justify-between items-center gap-0 w-full text-left bg-transparent border-none p-0 cursor-pointer">
					<div className="flex items-center select-none grow min-w-0">
						<div className="grow min-w-0">
							{isTaskExpanded && <span className="font-bold">{t("chat:task.title")}</span>}
							{!isTaskExpanded && (
								<div className="flex items-center gap-2 whitespace-nowrap overflow-hidden text-ellipsis">
									<Mention text={task.text} />
								</div>
							)}
						</div>
						<div className="flex items-center shrink-0 ml-2">
							<StandardTooltip content={isTaskExpanded ? t("chat:task.collapse") : t("chat:task.expand")}>
								<span
									role="button"
									tabIndex={-1}
									aria-hidden="true"
									onClick={(e) => e.stopPropagation()}
									className="shrink-0 min-h-[20px] min-w-[20px] p-[2px] cursor-pointer opacity-60 hover:opacity-100 bg-transparent">
									{isTaskExpanded ? (
										<ChevronUp size={16} />
									) : (
										// §2.2 chevron rule: 60% by default, never hidden —
										// the old opacity-0-until-hover was invisible to keyboard users.
										<ChevronDown size={16} />
									)}
								</span>
							</StandardTooltip>
						</div>
					</div>
				</button>
				{!isTaskExpanded && contextWindow > 0 && (
					<div
						className="flex items-center gap-2 text-sm text-muted-foreground/70"
						onClick={(e) => e.stopPropagation()}>
						{/* Kilo Code–style horizontal context bar: tokens-used —bar— context-window */}
						<ContextWindowProgress
							contextWindow={contextWindow}
							contextTokens={contextTokens || 0}
							maxTokens={maxTokens || undefined}
						/>
						{!!totalCost && (
							<>
								<span className="shrink-0">·</span>
								<CostWithTooltip
									totalCost={totalCost}
									aggregatedCost={aggregatedCost}
									hasSubtasks={hasSubtasks}
									costBreakdown={costBreakdown}
									t={t}
								/>
							</>
						)}
					</div>
				)}
				{/* Expanded state: Show task text and images. Capped at 40vh with its
				    own scroll so it never pushes the chat off screen (§2.3). */}
				{isTaskExpanded && (
					<div id={detailsId} className="flex flex-col gap-1.5 max-h-[40vh] overflow-y-auto">
						<div
							ref={textContainerRef}
							className="text-vscode-font-size overflow-y-auto break-words break-anywhere relative">
							<div
								ref={textRef}
								className="overflow-auto max-h-80 whitespace-pre-wrap break-words break-anywhere cursor-text py-0.5"
								style={{
									display: "-webkit-box",
									WebkitLineClamp: "unset",
									WebkitBoxOrient: "vertical",
								}}>
								<Mention text={task.text} />
							</div>
						</div>
						{task.images && task.images.length > 0 && <Thumbnails images={task.images} />}

						<div onClick={(e) => e.stopPropagation()}>
							<TaskActions item={currentTaskItem} buttonsDisabled={buttonsDisabled} />
						</div>

						<div className="pt-3 mt-2 -mx-2.5 px-2.5 border-t border-vscode-sideBar-background">
							<table className="w-full text-sm">
								<tbody>
									{contextWindow > 0 && (
										<tr>
											<th
												className="font-medium text-left align-top w-1 whitespace-nowrap pr-3 h-[24px]"
												data-testid="context-window-label">
												{t("chat:task.contextWindow")}
											</th>
											<td className="font-light align-top">
												<div className={`max-w-md -mt-1.5 flex flex-nowrap gap-1`}>
													<ContextWindowProgress
														contextWindow={contextWindow}
														contextTokens={contextTokens || 0}
														maxTokens={maxTokens || undefined}
													/>
													{condenseButton}
												</div>
											</td>
										</tr>
									)}

									<tr>
										<th className="font-medium text-left align-top w-1 whitespace-nowrap pr-3 h-[24px]">
											{t("chat:task.tokens")}
										</th>
										<td className="font-light align-top">
											<div className="flex items-center gap-1 flex-wrap">
												{typeof tokensIn === "number" && tokensIn > 0 && (
													<span className="flex items-center gap-0.5">
														<ArrowUp
															className="size-3"
															aria-label={t("chat:task.tokensIn")}
														/>
														{formatLargeNumber(tokensIn)}
													</span>
												)}
												{typeof tokensOut === "number" && tokensOut > 0 && (
													<span className="flex items-center gap-0.5">
														<ArrowDown
															className="size-3"
															aria-label={t("chat:task.tokensOut")}
														/>
														{formatLargeNumber(tokensOut)}
													</span>
												)}
											</div>
										</td>
									</tr>

									{((typeof cacheReads === "number" && cacheReads > 0) ||
										(typeof cacheWrites === "number" && cacheWrites > 0)) && (
										<tr>
											<th className="font-medium text-left align-top w-1 whitespace-nowrap pr-3 h-[24px]">
												{t("chat:task.cache")}
											</th>
											<td className="font-light align-top">
												<div className="flex items-center gap-1 flex-wrap">
													{typeof cacheWrites === "number" && cacheWrites > 0 && (
														<>
															<HardDriveDownload className="size-2.5" />
															<span>{formatLargeNumber(cacheWrites)}</span>
														</>
													)}
													{typeof cacheReads === "number" && cacheReads > 0 && (
														<>
															<HardDriveUpload className="size-2.5" />
															<span>{formatLargeNumber(cacheReads)}</span>
														</>
													)}
												</div>
											</td>
										</tr>
									)}

									{!!totalCost && (
										<tr>
											<th className="font-medium text-left align-top w-1 whitespace-nowrap pr-3 h-[24px]">
												{t("chat:task.apiCost")}
											</th>
											<td className="font-light align-top">
												<CostWithTooltip
													totalCost={totalCost}
													aggregatedCost={aggregatedCost}
													hasSubtasks={hasSubtasks}
													costBreakdown={costBreakdown}
													t={t}
												/>
											</td>
										</tr>
									)}

									{/* Size display */}
									{!!currentTaskItem?.size && currentTaskItem.size > 0 && (
										<tr>
											<th className="font-medium text-left align-top w-1 whitespace-nowrap pr-2 h-[20px]">
												{t("chat:task.size")}
											</th>
											<td className="font-light align-top">
												{prettyBytes(currentTaskItem.size)}
											</td>
										</tr>
									)}
								</tbody>
							</table>
						</div>
					</div>
				)}
				{/* Todo list - always shown at bottom when todos exist */}
				{hasTodos && <TodoListDisplay todos={todos ?? (task as any)?.tool?.todos ?? []} />}
			</div>
		</div>
	)
}

export default memo(TaskHeader)
