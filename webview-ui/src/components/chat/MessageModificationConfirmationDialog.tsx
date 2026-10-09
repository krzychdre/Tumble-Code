import React from "react"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@src/components/ui"

interface MessageModificationConfirmationDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	onConfirm: () => void
	type: "edit" | "delete"
}

export const MessageModificationConfirmationDialog: React.FC<MessageModificationConfirmationDialogProps> = ({
	open,
	onOpenChange,
	onConfirm,
	type,
}) => {
	const { t } = useAppTranslation()

	const isEdit = type === "edit"
	const title = isEdit ? t("common:confirmation.editMessage") : t("common:confirmation.deleteMessage")
	const description = isEdit ? t("common:confirmation.editWarning") : t("common:confirmation.deleteWarning")

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle className="text-lg">{title}</AlertDialogTitle>
					<AlertDialogDescription className="text-base">{description}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter className="flex-col gap-2">
					<AlertDialogCancel>{t("common:answers.cancel")}</AlertDialogCancel>
					<AlertDialogAction onClick={onConfirm}>{t("common:confirmation.proceed")}</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}

// Export convenience components for backward compatibility
export const EditMessageDialog: React.FC<Omit<MessageModificationConfirmationDialogProps, "type">> = (props) => (
	<MessageModificationConfirmationDialog {...props} type="edit" />
)

export const DeleteMessageDialog: React.FC<Omit<MessageModificationConfirmationDialogProps, "type">> = (props) => (
	<MessageModificationConfirmationDialog {...props} type="delete" />
)
