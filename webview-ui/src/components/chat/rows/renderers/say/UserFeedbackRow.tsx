import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Edit, Trash2, User } from "lucide-react"

import { Mode } from "@roo/modes"

import { cn } from "@/lib/utils"
import { vscode } from "@src/utils/vscode"
import { appendImages } from "@src/utils/imageUtils"
import { onExtensionMessage } from "@src/utils/extensionBus"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import Thumbnails from "@src/components/common/Thumbnails"
import { Mention } from "@src/components/chat/Mention"
import { ChatTextArea } from "@src/components/chat/ChatTextArea"
import { MAX_IMAGES_PER_MESSAGE } from "@src/components/chat/ChatView"

import { headerStyle } from "../shared"
import type { RowRendererProps } from "../types"

/** A message the user sent, editable in place (text, images and mode) until the model streams. */
export const UserFeedbackRow = ({ message, isStreaming, supportsImages }: RowRendererProps) => {
	const { t } = useTranslation()
	const { mode } = useExtensionState()
	const [isEditing, setIsEditing] = useState(false)
	const [editedContent, setEditedContent] = useState("")
	const [editMode, setEditMode] = useState<Mode>(mode || "code")
	const [editImages, setEditImages] = useState<string[]>([])

	// Handle message events for image selection during edit mode
	useEffect(
		() =>
			onExtensionMessage("selectedImages", (msg) => {
				if (msg.context === "edit" && msg.messageTs === message.ts && isEditing) {
					setEditImages((prevImages) => appendImages(prevImages, msg.images, MAX_IMAGES_PER_MESSAGE))
				}
			}),
		[isEditing, message.ts],
	)

	// Handle edit button click
	const handleEditClick = useCallback(() => {
		setIsEditing(true)
		setEditedContent(message.text || "")
		setEditImages(message.images || [])
		setEditMode(mode || "code")
		// Edit mode is now handled entirely in the frontend
		// No need to notify the backend
	}, [message.text, message.images, mode])

	// Handle cancel edit
	const handleCancelEdit = useCallback(() => {
		setIsEditing(false)
		setEditedContent(message.text || "")
		setEditImages(message.images || [])
		setEditMode(mode || "code")
	}, [message.text, message.images, mode])

	// Handle save edit
	const handleSaveEdit = useCallback(() => {
		setIsEditing(false)
		// Send edited message to backend
		vscode.postMessage({
			type: "submitEditedMessage",
			value: message.ts,
			editedMessageContent: editedContent,
			images: editImages,
		})
	}, [message.ts, editedContent, editImages])

	// Handle image selection for editing
	const handleSelectImages = useCallback(() => {
		vscode.postMessage({ type: "selectImages", context: "edit", messageTs: message.ts })
	}, [message.ts])

	return (
		<div className="group">
			<div style={headerStyle}>
				<User className="w-4 shrink-0" aria-label="User icon" />
				<span style={{ fontWeight: "bold" }}>{t("chat:feedback.youSaid")}</span>
			</div>
			<div
				className={cn(
					"ml-6 border rounded-sm overflow-hidden whitespace-pre-wrap",
					isEditing
						? "bg-vscode-editor-background text-vscode-editor-foreground"
						: "cursor-text p-1 bg-vscode-editor-foreground/70 text-vscode-editor-background",
				)}>
				{isEditing ? (
					<div className="flex flex-col gap-2">
						<ChatTextArea
							inputValue={editedContent}
							setInputValue={setEditedContent}
							sendingDisabled={false}
							selectApiConfigDisabled={true}
							placeholderText={t("chat:editMessage.placeholder")}
							selectedImages={editImages}
							setSelectedImages={setEditImages}
							onSend={handleSaveEdit}
							onSelectImages={handleSelectImages}
							shouldDisableImages={!supportsImages}
							mode={editMode}
							setMode={setEditMode}
							modeShortcutText=""
							isEditMode={true}
							onCancel={handleCancelEdit}
						/>
					</div>
				) : (
					<div className="flex justify-between">
						<div
							className="flex-grow px-2 py-1 wrap-anywhere rounded-lg transition-colors"
							onClick={(e) => {
								e.stopPropagation()
								if (!isStreaming) {
									handleEditClick()
								}
							}}
							title={t("chat:queuedMessages.clickToEdit")}>
							<Mention text={message.text} withShadow />
						</div>
						<div className="flex gap-2 pr-1">
							<div
								className="cursor-pointer shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
								style={{ visibility: isStreaming ? "hidden" : "visible" }}
								onClick={(e) => {
									e.stopPropagation()
									handleEditClick()
								}}>
								<Edit className="w-4 shrink-0" aria-label="Edit message icon" />
							</div>
							<div
								className="cursor-pointer shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
								style={{ visibility: isStreaming ? "hidden" : "visible" }}
								onClick={(e) => {
									e.stopPropagation()
									vscode.postMessage({ type: "deleteMessage", value: message.ts })
								}}>
								<Trash2 className="w-4 shrink-0" aria-label="Delete message icon" />
							</div>
						</div>
					</div>
				)}
				{!isEditing && message.images && message.images.length > 0 && (
					<Thumbnails images={message.images} style={{ marginTop: "8px" }} />
				)}
			</div>
		</div>
	)
}
