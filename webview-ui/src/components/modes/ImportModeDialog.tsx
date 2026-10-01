import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@src/components/ui"

import type { ImportLevel } from "./useModeImportExport"

const LEVEL_TEXT = {
	project: { label: "prompts:importMode.project.label", description: "prompts:importMode.project.description" },
	global: { label: "prompts:importMode.global.label", description: "prompts:importMode.global.description" },
} as const

type ImportModeDialogProps = {
	importLevel: ImportLevel
	onImportLevelChange: (level: ImportLevel) => void
	isImporting: boolean
	onImport: () => void
	onCancel: () => void
}

/** Asks where an imported mode goes (project or global) before the host opens the file picker. */
export function ImportModeDialog({
	importLevel,
	onImportLevelChange,
	isImporting,
	onImport,
	onCancel,
}: ImportModeDialogProps) {
	const { t } = useAppTranslation()

	const levelOption = (level: ImportLevel) => (
		<label className="flex items-start gap-2 cursor-pointer">
			<input
				type="radio"
				name="importLevel"
				value={level}
				className="mt-1"
				checked={importLevel === level}
				onChange={() => onImportLevelChange(level)}
			/>
			<div>
				<div className="font-medium">{t(LEVEL_TEXT[level].label)}</div>
				<div className="text-xs text-vscode-descriptionForeground">{t(LEVEL_TEXT[level].description)}</div>
			</div>
		</label>
	)

	return (
		<Dialog open onOpenChange={(open) => !open && onCancel()}>
			<DialogContent
				className="max-w-md gap-0 p-6"
				showCloseButton={false}
				onInteractOutside={(e) => e.preventDefault()}>
				<DialogTitle className="mb-4">{t("prompts:modes.importMode")}</DialogTitle>
				<DialogDescription className="mb-4">{t("prompts:importMode.selectLevel")}</DialogDescription>
				<div className="space-y-3 mb-6">
					{levelOption("project")}
					{levelOption("global")}
				</div>
				<DialogFooter>
					<Button variant="secondary" onClick={onCancel}>
						{t("prompts:createModeDialog.buttons.cancel")}
					</Button>
					<Button variant="primary" onClick={onImport} disabled={isImporting}>
						{isImporting ? t("prompts:importMode.importing") : t("prompts:importMode.import")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
