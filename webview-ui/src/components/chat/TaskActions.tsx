import { useState } from "react"
import { useTranslation } from "react-i18next"

import type { HistoryItem } from "@roo-code/types"

import { vscode } from "@/utils/vscode"
import { useCopyToClipboard } from "@/utils/clipboard"
import { useExtensionSelector } from "@/context/ExtensionStateContext"
import { IconButton } from "@/components/ui"

import { DeleteTaskDialog } from "../history/DeleteTaskDialog"
import { ShareButton } from "./ShareButton"
import { CopyIcon, CheckIcon, DownloadIcon, Trash2Icon, FileJsonIcon, MessageSquareCodeIcon } from "lucide-react"

interface TaskActionsProps {
	item?: HistoryItem
	buttonsDisabled: boolean
}

export const TaskActions = ({ item, buttonsDisabled }: TaskActionsProps) => {
	const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null)
	const { t } = useTranslation()
	const { copyWithFeedback, showCopyFeedback } = useCopyToClipboard()
	// P1: narrow slice.
	const debug = useExtensionSelector((s) => s.debug)

	return (
		<div className="flex flex-row items-center -ml-0.5 mt-1 gap-1">
			<IconButton
				icon={DownloadIcon}
				title={t("chat:task.export")}
				onClick={() => vscode.postMessage({ type: "exportCurrentTask" })}
			/>

			{item?.task && (
				<IconButton
					icon={showCopyFeedback ? CheckIcon : CopyIcon}
					title={t("history:copyPrompt")}
					onClick={(e) => copyWithFeedback(item.task, e)}
				/>
			)}
			{!!item?.size && item.size > 0 && (
				<>
					<IconButton
						icon={Trash2Icon}
						title={t("chat:task.delete")}
						disabled={buttonsDisabled}
						onClick={(e) => {
							e.stopPropagation()
							if (e.shiftKey) {
								vscode.postMessage({ type: "deleteTaskWithId", text: item.id })
							} else {
								setDeleteTaskId(item.id)
							}
						}}
					/>
					{deleteTaskId && (
						<DeleteTaskDialog
							taskId={deleteTaskId}
							onOpenChange={(open) => !open && setDeleteTaskId(null)}
							open
						/>
					)}
				</>
			)}
			<ShareButton item={item} disabled={false} />
			{debug && item?.id && (
				<>
					<IconButton
						icon={FileJsonIcon}
						title={t("chat:task.openApiHistory")}
						onClick={() => vscode.postMessage({ type: "openDebugApiHistory" })}
					/>
					<IconButton
						icon={MessageSquareCodeIcon}
						title={t("chat:task.openUiHistory")}
						onClick={() => vscode.postMessage({ type: "openDebugUiHistory" })}
					/>
				</>
			)}
		</div>
	)
}
