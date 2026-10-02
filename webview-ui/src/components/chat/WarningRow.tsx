import React from "react"
import { TriangleAlert, BookOpenText } from "lucide-react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { vscode } from "@src/utils/vscode"

/** The close glyph of the dismiss button. */
const DismissIcon = () => (
	<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
		<path
			fillRule="evenodd"
			clipRule="evenodd"
			d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.707.708L7.293 8l-3.647 3.646.708.707L8 8.707z"
			fill="currentColor"
		/>
	</svg>
)

export interface WarningRowProps {
	title: string
	message: string
	docsURL?: string
	actionText?: string
	onAction?: () => void
	/** When set, a close button ("dismiss and don't show again") is shown; the caller hides the row. */
	onDismiss?: () => void
}

/**
 * A generic warning row component that displays a warning icon, title, and message.
 * Optionally includes a documentation link and/or an action link.
 *
 * @param title - The warning title displayed in bold
 * @param message - The warning message displayed below the title
 * @param docsURL - Optional documentation link URL (shown as "Learn more" with book icon)
 * @param actionText - Optional text for an action link appended to the message
 * @param onAction - Optional callback when the action link is clicked
 * @param onDismiss - Optional callback for the "don't show again" button
 *
 * @example
 * <WarningRow
 *   title="Too many tools enabled"
 *   message="You have 50 tools enabled via 5 MCP servers."
 *   docsURL="https://docs.example.com/mcp-best-practices"
 *   actionText="Open MCP Settings"
 *   onAction={() => openSettings()}
 * />
 */
export const WarningRow: React.FC<WarningRowProps> = ({ title, message, docsURL, actionText, onAction, onDismiss }) => {
	const { t } = useAppTranslation()

	return (
		<div className="group pr-2 py-2">
			<div className="flex items-center justify-between gap-2 break-words">
				<TriangleAlert className="w-4 text-vscode-editorWarning-foreground shrink-0" />
				<span className="font-bold text-vscode-editorWarning-foreground grow cursor-default">{title}</span>
				{docsURL && (
					<a
						href={docsURL}
						className="text-sm flex items-center gap-1 transition-opacity opacity-0 group-hover:opacity-100 group-has-focus-visible:opacity-100"
						onClick={(e) => {
							e.preventDefault()
							vscode.postMessage({ type: "openExternal", url: docsURL })
						}}>
						<BookOpenText className="size-3 mt-[3px]" />
						{t("chat:apiRequest.errorMessage.docs")}
					</a>
				)}
				{onDismiss && (
					<button
						type="button"
						className="flex items-center justify-center shrink-0 bg-transparent border-none cursor-pointer hover:opacity-50 transition-opacity duration-200 text-vscode-foreground focus:outline focus:outline-1 focus:outline-vscode-focusBorder focus:outline-offset-1"
						onClick={onDismiss}
						aria-label={t("common:dismiss")}
						title={t("common:dismissAndDontShowAgain")}>
						<DismissIcon />
					</button>
				)}
			</div>
			<div className="cursor-default ml-2 pl-4 mt-1 pt-0.5 border-l border-vscode-editorWarning-foreground/50">
				<p className="my-0 font-light whitespace-pre-wrap break-words text-vscode-descriptionForeground">
					{message}
					{actionText && onAction && (
						<>
							{" "}
							<a
								href="#"
								className="text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground cursor-pointer"
								onClick={(e) => {
									e.preventDefault()
									onAction()
								}}>
								{actionText}
							</a>
						</>
					)}
				</p>
			</div>
		</div>
	)
}
