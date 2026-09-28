import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Button, StandardTooltip } from "@src/components/ui"

type SystemPromptActionsProps = {
	/** Slug of the selected mode; nothing is requested when the mode does not exist. */
	currentModeSlug: string | undefined
}

/** Buttons that ask the host to preview or copy the selected mode's system prompt. */
export const SystemPromptActions = ({ currentModeSlug }: SystemPromptActionsProps) => {
	const { t } = useAppTranslation()

	return (
		<div className="pb-4 border-b border-vscode-input-border">
			<div className="flex gap-2 mb-4">
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
		<div className="fixed inset-0 flex justify-end bg-black/50 z-[1000]">
			<div className="w-[calc(100vw-100px)] h-full bg-vscode-editor-background shadow-md flex flex-col relative">
				<div className="flex-1 p-5 overflow-y-auto min-h-0">
					<Button variant="ghost" size="icon" onClick={onClose} className="absolute top-5 right-5">
						<span className="codicon codicon-close"></span>
					</Button>
					<h2 className="mb-4">
						{title ||
							t("prompts:systemPrompt.title", {
								modeName: currentModeName || "Code",
							})}
					</h2>
					<pre className="p-2 whitespace-pre-wrap break-words font-mono text-vscode-editor-font-size text-vscode-editor-foreground bg-vscode-editor-background border border-vscode-editor-lineHighlightBorder rounded overflow-y-auto">
						{content}
					</pre>
				</div>
				<div className="flex justify-end p-3 px-5 border-t border-vscode-editor-lineHighlightBorder bg-vscode-editor-background">
					<Button variant="secondary" onClick={onClose}>
						{t("prompts:createModeDialog.close")}
					</Button>
				</div>
			</div>
		</div>
	)
}
