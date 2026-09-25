import { useTranslation } from "react-i18next"
import { ArrowRight, Check, MessageCircle } from "lucide-react"

import type { ClineSayTool } from "@roo-code/types"

import { safeJsonParse } from "@roo/core"

import { vscode } from "@src/utils/vscode"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import CodeAccordion from "@src/components/common/CodeAccordion"
import MarkdownBlock from "@src/components/common/MarkdownBlock"
import ImageBlock from "@src/components/common/ImageBlock"
import { Markdown } from "@src/components/chat/Markdown"
import { OpenMarkdownPreviewButton } from "@src/components/chat/OpenMarkdownPreviewButton"
import { AnnotateButton } from "@src/components/chat/AnnotateButton"

import { headerStyle, successColor } from "../shared"
import type { RowRendererProps } from "../types"

/** A text answer from the model. */
export const TextRow = ({ message }: RowRendererProps) => {
	const { t } = useTranslation()
	return (
		<div className="group">
			<div style={headerStyle}>
				<MessageCircle className="w-4 shrink-0" aria-label="Speech bubble icon" />
				<span style={{ fontWeight: "bold" }}>{t("chat:text.rooSaid")}</span>
				<div style={{ flexGrow: 1 }} />
				<OpenMarkdownPreviewButton markdown={message.text} />
				{!message.partial && <AnnotateButton markdown={message.text} />}
			</div>
			<div className="pl-6">
				<Markdown markdown={message.text} partial={message.partial} />
				{message.images && message.images.length > 0 && (
					<div style={{ marginTop: "10px" }}>
						{message.images.map((image, index) => (
							<ImageBlock key={index} imageData={image} />
						))}
					</div>
				)}
			</div>
		</div>
	)
}

/** The diff of the user's own edits to a proposed change. */
export const UserFeedbackDiffRow = ({ message, isExpanded, toggleExpand }: RowRendererProps) => {
	const tool = safeJsonParse<ClineSayTool>(message.text)
	return (
		<div style={{ marginTop: -10, width: "100%" }}>
			<CodeAccordion
				code={tool?.diff}
				language="diff"
				isFeedback={true}
				isExpanded={isExpanded}
				onToggleExpand={toggleExpand}
			/>
		</div>
	)
}

/** The task's final result, as the model said it. */
export const CompletionResultSayRow = ({ message }: RowRendererProps) => {
	const { t } = useTranslation()
	return (
		<div className="group">
			<div style={headerStyle}>
				<span className="codicon codicon-check" style={{ color: successColor, marginBottom: "-1.5px" }}></span>
				<span style={{ color: successColor, fontWeight: "bold" }}>{t("chat:taskCompleted")}</span>
				<div style={{ flexGrow: 1 }} />
				<OpenMarkdownPreviewButton markdown={message.text} />
				{!message.partial && <AnnotateButton markdown={message.text} />}
			</div>
			<div className="border-l border-green-600/30 ml-2 pl-4 pb-1">
				<Markdown markdown={message.text} />
			</div>
		</div>
	)
}

/** A subtask's result, back in the parent task, with a link to the subtask. */
export const SubtaskResultRow = ({ message }: RowRendererProps) => {
	const { t } = useTranslation()
	const { currentTaskItem } = useExtensionState()
	// Get the child task ID that produced this result
	const completedChildTaskId = currentTaskItem?.completedByChildId
	return (
		<div className="border-l border-muted-foreground/80 ml-2 pl-4 pt-2 pb-1 -mt-5">
			<div style={headerStyle}>
				<span style={{ fontWeight: "bold" }}>{t("chat:subtasks.resultContent")}</span>
				<Check className="size-3" />
			</div>
			<MarkdownBlock markdown={message.text} />
			{completedChildTaskId && (
				<button
					className="cursor-pointer flex gap-1 items-center mt-2 text-vscode-descriptionForeground hover:text-vscode-descriptionForeground hover:underline font-normal"
					onClick={() => vscode.postMessage({ type: "showTaskWithId", text: completedChildTaskId })}>
					{t("chat:subtasks.goToSubtask")}
					<ArrowRight className="size-3" />
				</button>
			)}
		</div>
	)
}

/** An image the model produced or read, by its webview URI. */
export const ImageRow = ({ message }: RowRendererProps) => {
	// Parse the JSON to get imageUri and imagePath
	const imageInfo = safeJsonParse<{ imageUri: string; imagePath: string }>(message.text || "{}")
	if (!imageInfo) {
		return null
	}
	return (
		<div style={{ marginTop: "10px" }}>
			<ImageBlock imageUri={imageInfo.imageUri} imagePath={imageInfo.imagePath} />
		</div>
	)
}

/**
 * Any say kind without its own renderer: the text as markdown. None of these
 * kinds has a header title, so there is no header line.
 */
export const DefaultSayRow = ({ message }: RowRendererProps) => (
	<>
		<div style={{ paddingTop: 10 }}>
			<Markdown markdown={message.text} partial={message.partial} />
		</div>
	</>
)
