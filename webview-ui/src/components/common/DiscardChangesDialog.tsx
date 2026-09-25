import { AlertTriangle } from "lucide-react"

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

interface DiscardChangesDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	/** Called with `true` when the user discards the changes, `false` when they cancel. */
	onResult: (discard: boolean) => void
}

/** The "you have unsaved changes" confirmation shared by the settings view and the code index popover. */
export const DiscardChangesDialog = ({ open, onOpenChange, onResult }: DiscardChangesDialogProps) => {
	const { t } = useAppTranslation()

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						<AlertTriangle className="w-5 h-5 text-yellow-500" />
						{t("settings:unsavedChangesDialog.title")}
					</AlertDialogTitle>
					<AlertDialogDescription>{t("settings:unsavedChangesDialog.description")}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel onClick={() => onResult(false)}>
						{t("settings:unsavedChangesDialog.cancelButton")}
					</AlertDialogCancel>
					<AlertDialogAction onClick={() => onResult(true)}>
						{t("settings:unsavedChangesDialog.discardButton")}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
