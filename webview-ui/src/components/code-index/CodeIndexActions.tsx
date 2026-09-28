import type { IndexingStatus } from "@roo-code/types"

import { vscode } from "@src/utils/vscode"
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
	AlertDialogTrigger,
	Button,
} from "@src/components/ui"

import type { CodeIndexSaveStatus } from "./useCodeIndexSettings"
import { useIndexClearedError } from "./useIndexClearedError"

type CodeIndexActionsProps = {
	indexingStatus: IndexingStatus
	codebaseIndexEnabled: boolean
	saveStatus: CodeIndexSaveStatus
	saveError: string | null
	hasUnsavedChanges: boolean
	onSave: () => void
}

/**
 * The buttons at the bottom of the popover: start, stop or clear the index (depending on the
 * indexing state, only while indexing is enabled), and Save with its error line. A failed clear
 * shows its error line here too.
 */
export const CodeIndexActions = ({
	indexingStatus,
	codebaseIndexEnabled,
	saveStatus,
	saveError,
	hasUnsavedChanges,
	onSave,
}: CodeIndexActionsProps) => {
	const { t } = useAppTranslation()
	const { error: clearIndexError, dismiss: dismissClearIndexError } = useIndexClearedError()

	return (
		<>
			{/* Action Buttons */}
			<div className="flex items-center justify-between gap-2 pt-6">
				<div className="flex gap-2">
					{codebaseIndexEnabled &&
						(indexingStatus.systemStatus === "Error" || indexingStatus.systemStatus === "Standby") && (
							<Button
								onClick={() => vscode.postMessage({ type: "startIndexing" })}
								disabled={saveStatus === "saving" || hasUnsavedChanges}>
								{t("settings:codeIndex.startIndexingButton")}
							</Button>
						)}

					{codebaseIndexEnabled && indexingStatus.systemStatus === "Indexing" && (
						<Button variant="destructive" onClick={() => vscode.postMessage({ type: "stopIndexing" })}>
							{t("settings:codeIndex.stopIndexingButton")}
						</Button>
					)}

					{codebaseIndexEnabled && indexingStatus.systemStatus === "Stopping" && (
						<Button variant="destructive" disabled>
							{t("settings:codeIndex.stoppingButton")}
						</Button>
					)}

					{codebaseIndexEnabled &&
						(indexingStatus.systemStatus === "Indexed" || indexingStatus.systemStatus === "Error") && (
							<AlertDialog>
								<AlertDialogTrigger asChild>
									<Button variant="secondary">{t("settings:codeIndex.clearIndexDataButton")}</Button>
								</AlertDialogTrigger>
								<AlertDialogContent>
									<AlertDialogHeader>
										<AlertDialogTitle>
											{t("settings:codeIndex.clearDataDialog.title")}
										</AlertDialogTitle>
										<AlertDialogDescription>
											{t("settings:codeIndex.clearDataDialog.description")}
										</AlertDialogDescription>
									</AlertDialogHeader>
									<AlertDialogFooter>
										<AlertDialogCancel>
											{t("settings:codeIndex.clearDataDialog.cancelButton")}
										</AlertDialogCancel>
										<AlertDialogAction
											onClick={() => {
												dismissClearIndexError()
												vscode.postMessage({ type: "clearIndexData" })
											}}>
											{t("settings:codeIndex.clearDataDialog.confirmButton")}
										</AlertDialogAction>
									</AlertDialogFooter>
								</AlertDialogContent>
							</AlertDialog>
						)}
				</div>

				<Button onClick={onSave} disabled={!hasUnsavedChanges || saveStatus === "saving"}>
					{saveStatus === "saving" ? t("settings:codeIndex.saving") : t("settings:codeIndex.saveSettings")}
				</Button>
			</div>

			{clearIndexError && (
				<div className="mt-2">
					<span className="text-sm text-vscode-errorForeground block">{clearIndexError}</span>
				</div>
			)}

			{/* Save Status Messages */}
			{saveStatus === "error" && (
				<div className="mt-2">
					<span className="text-sm text-vscode-errorForeground block">
						{saveError || t("settings:codeIndex.saveError")}
					</span>
				</div>
			)}
		</>
	)
}
