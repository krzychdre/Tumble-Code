import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Button, Dialog, DialogContent, DialogTitle, StandardTooltip } from "@src/components/ui"

import { SIDE_PANEL_CLASS } from "./sidePanelDialog"

type SystemPromptActionsProps = {
	/** Slug of the selected mode; nothing is requested when the mode does not exist. */
	currentModeSlug: string | undefined
}

/** Buttons that ask the host to preview or copy the selected mode's system prompt. */
export const SystemPromptActions = ({ currentModeSlug }: SystemPromptActionsProps) => {
	const { t } = useAppTranslation()

	return (
		<div className="pb-section border-b border-frame">
			<div className="flex gap-2 mb-section">
				<Button
					variant="primary"
					onClick={() => {
						if (currentModeSlug) {
							vscode.postMessage({
								type: "getSystemPrompt",
								mode: currentModeSlug,
							})
						}
					}}
					data-testid="preview-prompt-button">
					{t("prompts:systemPrompt.preview")}
				</Button>
				<StandardTooltip content={t("prompts:systemPrompt.copy")}>
					<Button
						aria-label={t("prompts:systemPrompt.copy")}
						variant="ghost"
						size="icon"
						onClick={() => {
							if (currentModeSlug) {
								vscode.postMessage({
									type: "copySystemPrompt",
									mode: currentModeSlug,
								})
							}
						}}
						data-testid="copy-prompt-button">
						<span className="codicon codicon-copy"></span>
					</Button>
				</StandardTooltip>
			</div>
		</div>
	)
}

type SystemPromptDialogProps = {
	title: string
	/** Title fallback when the host sent none: the selected mode's name. */
	currentModeName: string | undefined
	content: string
	onClose: () => void
}

/** Full-height panel with the system prompt the host rendered for a preview. */
export const SystemPromptDialog = ({ title, currentModeName, content, onClose }: SystemPromptDialogProps) => {
	const { t } = useAppTranslation()

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent className={SIDE_PANEL_CLASS} aria-describedby={undefined}>
				<div className="flex-1 p-5 overflow-y-auto min-h-0">
					<DialogTitle className="mb-4">
						{title ||
							t("prompts:systemPrompt.title", {
								modeName: currentModeName || "Code",
							})}
					</DialogTitle>
					<pre className="p-2 whitespace-pre-wrap break-words font-mono text-vscode-editor-font-size text-vscode-editor-foreground bg-vscode-editor-background border border-frame rounded-control overflow-y-auto">
						{content}
					</pre>
				</div>
				<div className="flex justify-end p-3 px-5 border-t border-frame bg-vscode-editor-background">
					<Button variant="secondary" onClick={onClose}>
						{t("prompts:createModeDialog.close")}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	)
}
