import { useTranslation } from "react-i18next"
import { FileDiff, MessageSquarePlus } from "lucide-react"

import { toolPayloadDiffText } from "@roo-code/core/browser"

import { vscode } from "@src/utils/vscode"
import { toOpenFileLinkText } from "@src/utils/windows-file-links"
import CodeAccordion from "@src/components/common/CodeAccordion"
import { BatchDiffApproval } from "@src/components/chat/BatchDiffApproval"

import { headerStyle, protectedIcon, toolIcon } from "../shared"
import type { ToolRendererProps } from "../types"

/** A file edit (any of the edit tools), or a batch of them waiting for approval. */
export const EditFileToolRow = ({ message, tool, isExpanded, toggleExpand }: ToolRendererProps) => {
	const { t } = useTranslation()

	// Check if this is a batch diff request
	if (message.type === "ask" && tool.batchDiffs && Array.isArray(tool.batchDiffs)) {
		return (
			<>
				<div style={headerStyle}>
					<FileDiff className="w-4 shrink-0" aria-label="Batch diff icon" />
					<span style={{ fontWeight: "bold" }}>{t("chat:fileOperations.wantsToApplyBatchChanges")}</span>
				</div>
				<BatchDiffApproval files={tool.batchDiffs} ts={message.ts} />
			</>
		)
	}

	// Unified diff content (provided by backend when relevant)
	const unifiedDiff = toolPayloadDiffText(tool)
	const onJumpToCreatedFile =
		tool.tool === "newFileCreated" && tool.path
			? () => vscode.postMessage({ type: "openFile", text: toOpenFileLinkText(tool.path as string) })
			: undefined

	// Regular single file diff
	return (
		<>
			<div style={headerStyle}>
				{tool.isProtected ? protectedIcon() : toolIcon("diff")}
				<span style={{ fontWeight: "bold" }}>
					{tool.isProtected
						? t("chat:fileOperations.wantsToEditProtected")
						: tool.isOutsideWorkspace
							? t("chat:fileOperations.wantsToEditOutsideWorkspace")
							: t("chat:fileOperations.wantsToEdit")}
				</span>
			</div>
			<div className="pl-6">
				<CodeAccordion
					path={tool.path}
					code={unifiedDiff ?? tool.content ?? tool.diff ?? ""}
					language="diff"
					progressStatus={message.progressStatus}
					isLoading={message.partial}
					isExpanded={isExpanded}
					onToggleExpand={toggleExpand}
					onJumpToFile={onJumpToCreatedFile}
					diffStats={tool.diffStats}
				/>
				{tool.path?.toLowerCase().endsWith(".md") && (
					<button
						className="flex items-center gap-1 mt-1 text-xs cursor-pointer hover:opacity-80"
						onClick={(e) => {
							e.stopPropagation()
							vscode.postMessage({ type: "openPlanReview", text: tool.path })
						}}
						style={{
							color: "var(--vscode-button-foreground)",
							background: "var(--vscode-button-background)",
							padding: "2px 8px",
							borderRadius: "3px",
							border: "none",
						}}>
						<MessageSquarePlus className="w-3 h-3" />
						{t("chat:planReview.reviewFile")}
					</button>
				)}
			</div>
		</>
	)
}

/** Inserted content (the legacy insert_content tool). */
export const InsertContentToolRow = ({ message, tool, isExpanded, toggleExpand }: ToolRendererProps) => {
	const { t } = useTranslation()
	const unifiedDiff = toolPayloadDiffText(tool)

	return (
		<>
			<div style={headerStyle}>
				{tool.isProtected ? protectedIcon() : toolIcon("insert")}
				<span style={{ fontWeight: "bold" }}>
					{tool.isProtected
						? t("chat:fileOperations.wantsToEditProtected")
						: tool.isOutsideWorkspace
							? t("chat:fileOperations.wantsToEditOutsideWorkspace")
							: tool.lineNumber === 0
								? t("chat:fileOperations.wantsToInsertAtEnd")
								: t("chat:fileOperations.wantsToInsertWithLineNumber", {
										lineNumber: tool.lineNumber,
									})}
				</span>
			</div>
			<div className="pl-6">
				<CodeAccordion
					path={tool.path}
					code={unifiedDiff ?? tool.diff}
					language="diff"
					progressStatus={message.progressStatus}
					isLoading={message.partial}
					isExpanded={isExpanded}
					onToggleExpand={toggleExpand}
					diffStats={tool.diffStats}
				/>
			</div>
		</>
	)
}
