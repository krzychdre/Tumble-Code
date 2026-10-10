import { useTranslation } from "react-i18next"
import { Eye, FileCode2, FolderTree, ListTree, SquareArrowOutUpRight } from "lucide-react"

import { vscode } from "@src/utils/vscode"
import { formatPathTooltip } from "@src/utils/formatPathTooltip"
import { ToolUseBlock } from "@src/components/common/ToolUseBlock"
import CodeAccordion from "@src/components/common/CodeAccordion"
import { PathTooltip } from "@src/components/ui/PathTooltip"
import { BatchFilePermission } from "@src/components/chat/BatchFilePermission"

import { headerStyle } from "../shared"
import type { ToolRendererProps } from "../types"

/** A file read, or a batch of reads waiting for approval. */
export const ReadFileToolRow = ({ message, tool, onBatchFileResponse }: ToolRendererProps) => {
	const { t } = useTranslation()

	// Check if this is a batch file permission request
	const isBatchRequest = message.type === "ask" && tool.batchFiles && Array.isArray(tool.batchFiles)

	if (isBatchRequest) {
		return (
			<>
				<div style={headerStyle}>
					<Eye className="w-4 shrink-0" aria-hidden="true" />
					<span style={{ fontWeight: "bold" }}>{t("chat:fileOperations.wantsToReadMultiple")}</span>
				</div>
				<BatchFilePermission
					files={tool.batchFiles || []}
					onPermissionResponse={(response) => {
						onBatchFileResponse?.(response)
					}}
					ts={message?.ts}
				/>
			</>
		)
	}

	// Regular single file read request
	return (
		<>
			<div style={headerStyle}>
				<FileCode2 className="w-4 shrink-0" aria-hidden="true" />
				<span style={{ fontWeight: "bold" }}>
					{message.type === "ask"
						? tool.isOutsideWorkspace
							? t("chat:fileOperations.wantsToReadOutsideWorkspace")
							: tool.additionalFileCount && tool.additionalFileCount > 0
								? t("chat:fileOperations.wantsToReadAndXMore", {
										count: tool.additionalFileCount,
									})
								: t("chat:fileOperations.wantsToRead")
						: t("chat:fileOperations.didRead")}
				</span>
			</div>
			<div className="pl-6">
				<ToolUseBlock>
					{/* Opens the file: a real button so Tab reaches it. */}
					<button
						type="button"
						className="group flex w-full min-h-[28px] items-center px-2 py-0 text-left font-mono text-sm text-vscode-descriptionForeground select-none bg-transparent border-none cursor-pointer hover:bg-surface-hover hover:text-vscode-foreground transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-vscode-focusBorder"
						onClick={() =>
							vscode.postMessage({
								type: "openFile",
								text: tool.content,
								values: tool.startLine ? { line: tool.startLine } : undefined,
							})
						}>
						{tool.path?.startsWith(".") && <span>.</span>}
						<PathTooltip content={formatPathTooltip(tool.path, tool.reason)}>
							<span className="whitespace-nowrap overflow-hidden text-ellipsis text-left mr-2 rtl">
								{formatPathTooltip(tool.path, tool.reason)}
							</span>
						</PathTooltip>
						<span className="flex-grow" />
						<SquareArrowOutUpRight
							className="w-4 shrink-0 codicon codicon-link-external"
							style={{ fontSize: 13.5, margin: "1px 0" }}
						/>
					</button>
				</ToolUseBlock>
			</div>
		</>
	)
}

/** A listing of a directory's top level. */
export const ListFilesTopLevelToolRow = ({ message, tool, isExpanded, toggleExpand }: ToolRendererProps) => {
	const { t } = useTranslation()
	return (
		<>
			<div style={headerStyle}>
				<ListTree className="w-4 shrink-0" aria-hidden="true" />
				<span style={{ fontWeight: "bold" }}>
					{message.type === "ask"
						? tool.isOutsideWorkspace
							? t("chat:directoryOperations.wantsToViewTopLevelOutsideWorkspace")
							: t("chat:directoryOperations.wantsToViewTopLevel")
						: tool.isOutsideWorkspace
							? t("chat:directoryOperations.didViewTopLevelOutsideWorkspace")
							: t("chat:directoryOperations.didViewTopLevel")}
				</span>
			</div>
			<div className="pl-6">
				<CodeAccordion
					path={tool.path}
					code={tool.content}
					language="shell-session"
					isExpanded={isExpanded}
					onToggleExpand={toggleExpand}
				/>
			</div>
		</>
	)
}

/** A recursive listing of a directory. */
export const ListFilesRecursiveToolRow = ({ message, tool, isExpanded, toggleExpand }: ToolRendererProps) => {
	const { t } = useTranslation()
	return (
		<>
			<div style={headerStyle}>
				<FolderTree className="w-4 shrink-0" aria-hidden="true" />
				<span style={{ fontWeight: "bold" }}>
					{message.type === "ask"
						? tool.isOutsideWorkspace
							? t("chat:directoryOperations.wantsToViewRecursiveOutsideWorkspace")
							: t("chat:directoryOperations.wantsToViewRecursive")
						: tool.isOutsideWorkspace
							? t("chat:directoryOperations.didViewRecursiveOutsideWorkspace")
							: t("chat:directoryOperations.didViewRecursive")}
				</span>
			</div>
			<div className="pl-6">
				<CodeAccordion
					path={tool.path}
					code={tool.content}
					language="shellsession"
					isExpanded={isExpanded}
					onToggleExpand={toggleExpand}
				/>
			</div>
		</>
	)
}
