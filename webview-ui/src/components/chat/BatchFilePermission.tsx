import { memo, type KeyboardEvent } from "react"

import { ToolUseBlock, ToolUseBlockHeader } from "../common/ToolUseBlock"
import { vscode } from "@src/utils/vscode"
import { formatPathTooltip } from "@src/utils/formatPathTooltip"
import { PathTooltip } from "../ui/PathTooltip"

interface FilePermissionItem {
	path: string
	lineSnippet?: string
	isOutsideWorkspace?: boolean
	key: string
	content?: string // full path
}

interface BatchFilePermissionProps {
	files: FilePermissionItem[]
	onPermissionResponse?: (response: { [key: string]: boolean }) => void
	ts: number
}

export const BatchFilePermission = memo(({ files = [], onPermissionResponse, ts }: BatchFilePermissionProps) => {
	// Don't render if there are no files or no response handler
	if (!files?.length || !onPermissionResponse) {
		return null
	}

	// The row is the shared ToolUseBlockHeader, which renders a div, so it becomes a role="button" with
	// tabIndex 0 and Enter or Space does what a click does (open the file).
	const openFile = (file: FilePermissionItem) => vscode.postMessage({ type: "openFile", text: file.content })
	const onRowKeyDown = (event: KeyboardEvent<HTMLDivElement>, file: FilePermissionItem) => {
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault()
			openFile(file)
		}
	}

	return (
		<div className="pt-[5px]">
			{/* Individual files */}
			<div className="flex flex-col gap-1">
				{files.map((file, index) => {
					return (
						<div key={`${file.path}-${index}-${ts}`} className="flex items-center gap-2">
							<ToolUseBlock className="flex-1">
								<ToolUseBlockHeader
									role="button"
									tabIndex={0}
									className="focus-visible:outline-solid focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-vscode-focusBorder"
									onClick={() => openFile(file)}
									onKeyDown={(event) => onRowKeyDown(event, file)}>
									{file.path?.startsWith(".") && <span>.</span>}
									<PathTooltip
										content={formatPathTooltip(
											file.path,
											file.lineSnippet ? ` ${file.lineSnippet}` : undefined,
										)}>
										<span className="whitespace-nowrap overflow-hidden text-ellipsis text-left mr-2 rtl">
											{formatPathTooltip(
												file.path,
												file.lineSnippet ? ` ${file.lineSnippet}` : undefined,
											)}
										</span>
									</PathTooltip>
									<div className="flex-grow"></div>
									<span
										className="codicon codicon-link-external text-[13.5px] my-[1px]"
										aria-hidden="true"
									/>
								</ToolUseBlockHeader>
							</ToolUseBlock>
						</div>
					)
				})}
			</div>
		</div>
	)
})

BatchFilePermission.displayName = "BatchFilePermission"
