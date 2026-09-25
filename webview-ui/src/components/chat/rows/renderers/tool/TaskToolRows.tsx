import { Trans, useTranslation } from "react-i18next"
import { ArrowRight, ClipboardCheck, PocketKnife, Split } from "lucide-react"

import type { TodoItem } from "@roo-code/types"

import { vscode } from "@src/utils/vscode"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import MarkdownBlock from "@src/components/common/MarkdownBlock"
import { TodoChangeDisplay } from "@src/components/chat/TodoChangeDisplay"

import { headerStyle, toolIcon } from "../shared"
import type { ToolRendererProps } from "../types"

/** A todo list update, shown as the change against the previous list. */
export const UpdateTodoListToolRow = ({ message, tool, meta }: ToolRendererProps) => {
	const todos: TodoItem[] = (tool as { todos?: TodoItem[] }).todos || []
	return (
		<TodoChangeDisplay
			previousTodos={meta.previousTodos}
			newTodos={todos}
			startTs={message.ts}
			endTs={meta.nextTs}
		/>
	)
}

/** A mode switch, with its reason when the model gave one. */
export const SwitchModeToolRow = ({ message, tool }: ToolRendererProps) => (
	<>
		<div style={headerStyle}>
			<PocketKnife className="w-4 shrink-0" aria-label="Switch mode icon" />
			<span style={{ fontWeight: "bold" }}>
				{message.type === "ask" ? (
					<>
						{tool.reason ? (
							<Trans
								i18nKey="chat:modes.wantsToSwitchWithReason"
								components={{ code: <code className="font-medium">{tool.mode}</code> }}
								values={{ mode: tool.mode, reason: tool.reason }}
							/>
						) : (
							<Trans
								i18nKey="chat:modes.wantsToSwitch"
								components={{ code: <code className="font-medium">{tool.mode}</code> }}
								values={{ mode: tool.mode }}
							/>
						)}
					</>
				) : (
					<>
						{tool.reason ? (
							<Trans
								i18nKey="chat:modes.didSwitchWithReason"
								components={{ code: <code className="font-medium">{tool.mode}</code> }}
								values={{ mode: tool.mode, reason: tool.reason }}
							/>
						) : (
							<Trans
								i18nKey="chat:modes.didSwitch"
								components={{ code: <code className="font-medium">{tool.mode}</code> }}
								values={{ mode: tool.mode }}
							/>
						)}
					</>
				)}
			</span>
		</div>
	</>
)

/** A subtask the model wants to create, with a link to it once it exists. */
export const NewTaskToolRow = ({ tool, meta }: ToolRendererProps) => {
	const { t } = useTranslation()
	const { currentTaskItem } = useExtensionState()

	// The row's position among the newTask asks picks its child task ID.
	const thisNewTaskIndex = meta.newTaskIndex ?? -1
	const childIds = currentTaskItem?.childIds || []

	// Only get the child task ID if this newTask has been approved (has a corresponding entry in childIds)
	// This prevents showing a link to a previous task when the current newTask is still awaiting approval
	// Note: We don't use delegatedToId here because it persists after child tasks complete and would
	// incorrectly point to the previous task when a new newTask is awaiting approval
	const childTaskId =
		thisNewTaskIndex >= 0 && thisNewTaskIndex < childIds.length ? childIds[thisNewTaskIndex] : undefined

	// If the next message is a subtask_result, don't show the button
	// since the result is displayed right after this message
	const isFollowedBySubtaskResult = meta.followedBySubtaskResult

	return (
		<>
			<div style={headerStyle}>
				<Split className="size-4" />
				<span style={{ fontWeight: "bold" }}>
					<Trans
						i18nKey="chat:subtasks.wantsToCreate"
						components={{ code: <code>{tool.mode}</code> }}
						values={{ mode: tool.mode }}
					/>
				</span>
			</div>
			<div className="border-l border-muted-foreground/80 ml-2 pl-4 pb-1">
				<MarkdownBlock markdown={tool.content} />
				<div>
					{childTaskId && !isFollowedBySubtaskResult && (
						<button
							className="cursor-pointer flex gap-1 items-center mt-2 text-vscode-descriptionForeground hover:text-vscode-descriptionForeground hover:underline font-normal"
							onClick={() => vscode.postMessage({ type: "showTaskWithId", text: childTaskId })}>
							{t("chat:subtasks.goToSubtask")}
							<ArrowRight className="size-3" />
						</button>
					)}
				</div>
			</div>
		</>
	)
}

/** The model wants to finish this subtask and hand the result back. */
export const FinishTaskToolRow = () => {
	const { t } = useTranslation()
	return (
		<>
			<div style={headerStyle}>
				{toolIcon("check-all")}
				<span style={{ fontWeight: "bold" }}>{t("chat:subtasks.wantsToFinish")}</span>
			</div>
			<div className="text-muted-foreground pl-6">
				<MarkdownBlock markdown={t("chat:subtasks.completionInstructions")} />
			</div>
		</>
	)
}

/** The task pauses so the user can review a plan file. */
export const ReviewPlanToolRow = ({ tool }: ToolRendererProps) => {
	const { t } = useTranslation()
	return (
		<>
			<div style={headerStyle}>
				<ClipboardCheck className="w-4 shrink-0" aria-label="Plan review icon" />
				<span style={{ fontWeight: "bold" }}>{t("chat:planReview.pauseTitle")}</span>
			</div>
			{tool.path && (
				<div className="text-muted-foreground pl-6">
					<code>{tool.path}</code>
				</div>
			)}
			{tool.path && (
				<div className="pl-6 mt-1">
					<button
						className="cursor-pointer text-vscode-descriptionForeground hover:underline font-normal"
						onClick={() => vscode.postMessage({ type: "openPlanReview", text: tool.path })}>
						{t("chat:planReview.reviewFile")}
					</button>
				</div>
			)}
		</>
	)
}
