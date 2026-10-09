import { useMemo } from "react"
import { Image, WandSparkles, SendHorizontal, X, ListEnd, Square } from "lucide-react"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { cn } from "@src/lib/utils"
import { Spinner, StandardTooltip } from "@src/components/ui"

/** Shared look of the composer's icon buttons: 28px square, description colour, no frame of their own. */
const ACTION_BUTTON_BASE = cn(
	"relative inline-flex items-center justify-center",
	"min-w-[28px] min-h-[28px] p-1.5 bg-transparent border-none rounded-control",
	"text-vscode-descriptionForeground",
	"focus:outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-vscode-focusBorder",
)

/** Hover and press feedback, only on buttons the user can actually press right now. */
const ACTION_BUTTON_INTERACTIVE = "hover:text-vscode-foreground hover:bg-surface-hover active:bg-surface-hover"

interface ComposerActionButtonsProps {
	isEditMode: boolean
	/** The task is working (LLM request, command, MCP call, retry wait...), not waiting on the user. */
	isTaskBusy: boolean
	/** The input has text or images. */
	hasInputContent: boolean
	shouldDisableImages: boolean
	isEnhancingPrompt: boolean
	enterBehavior: "send" | "newline" | undefined
	onSelectImages: () => void
	onEnhancePrompt: () => void
	onCancel?: () => void
	onEnqueueMessage?: () => void
	onSend: () => void
	onStop?: () => void
}

/**
 * The button column in the composer's bottom-right corner: add images, enhance prompt (cancel while
 * editing a message), queue while the task is busy, and the send button that turns into stop while it is busy.
 */
export const ComposerActionButtons = ({
	isEditMode,
	isTaskBusy,
	hasInputContent,
	shouldDisableImages,
	isEnhancingPrompt,
	enterBehavior,
	onSelectImages,
	onEnhancePrompt,
	onCancel,
	onEnqueueMessage,
	onSend,
	onStop,
}: ComposerActionButtonsProps) => {
	const { t } = useAppTranslation()

	// Compute the key combination text for the send button tooltip based on enterBehavior
	const sendKeyCombination = useMemo(() => {
		if (enterBehavior === "newline") {
			// When Enter = newline, Ctrl/Cmd+Enter sends
			const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0
			return isMac ? "⌘+Enter" : "Ctrl+Enter"
		}
		// Default: Enter sends
		return "Enter"
	}, [enterBehavior])

	const sendLabel = isEditMode
		? t("chat:pressToSend", { keyCombination: sendKeyCombination })
		: isTaskBusy
			? t("chat:stop.title")
			: t("chat:pressToSend", { keyCombination: sendKeyCombination })

	return (
		<div className="absolute bottom-2 right-1 z-30 flex flex-col items-center gap-0">
			<StandardTooltip content={t("chat:addImages")}>
				<button
					aria-label={t("chat:addImages")}
					disabled={shouldDisableImages}
					onClick={!shouldDisableImages ? onSelectImages : undefined}
					className={cn(
						ACTION_BUTTON_BASE,
						"transition-all duration-1000",
						!shouldDisableImages
							? "opacity-100 delay-750 pointer-events-auto cursor-pointer"
							: "opacity-0 pointer-events-none duration-200 delay-0",
						!shouldDisableImages && ACTION_BUTTON_INTERACTIVE,
						shouldDisableImages && "opacity-40 cursor-not-allowed grayscale-[30%]",
					)}>
					<Image className="w-4 h-4" />
				</button>
			</StandardTooltip>
			{isEditMode ? (
				<StandardTooltip content={t("chat:cancel.title")}>
					<button
						aria-label={t("chat:cancel.title")}
						disabled={false}
						onClick={onCancel}
						className={cn(
							ACTION_BUTTON_BASE,
							ACTION_BUTTON_INTERACTIVE,
							"transition-all duration-150",
							"cursor-pointer",
						)}>
						<X className="w-4 h-4" />
					</button>
				</StandardTooltip>
			) : (
				<StandardTooltip content={t("chat:enhancePrompt")}>
					<button
						aria-label={t("chat:enhancePrompt")}
						disabled={false}
						onClick={onEnhancePrompt}
						className={cn(
							ACTION_BUTTON_BASE,
							"transition-all duration-1000",
							"cursor-pointer",
							hasInputContent
								? "opacity-100 delay-750 pointer-events-auto"
								: "opacity-0 pointer-events-none duration-200 delay-0",
							hasInputContent && ACTION_BUTTON_INTERACTIVE,
						)}>
						{isEnhancingPrompt ? <Spinner className="size-4" /> : <WandSparkles className="w-4 h-4" />}
					</button>
				</StandardTooltip>
			)}
			{/* Queue button - shown when the task is busy and user has typed content */}
			{!isEditMode && isTaskBusy && hasInputContent && onEnqueueMessage && (
				<StandardTooltip content={t("chat:enqueueMessage")}>
					<button
						aria-label={t("chat:enqueueMessage")}
						disabled={false}
						onClick={onEnqueueMessage}
						className={cn(
							ACTION_BUTTON_BASE,
							ACTION_BUTTON_INTERACTIVE,
							"transition-all duration-200",
							"opacity-100 pointer-events-auto",
							"cursor-pointer",
						)}>
						<ListEnd className="w-4 h-4" />
					</button>
				</StandardTooltip>
			)}
			{/* Send/Stop button - morphs based on the busy state, always visible in edit mode */}
			<StandardTooltip content={sendLabel}>
				<button
					aria-label={sendLabel}
					disabled={false}
					onClick={isTaskBusy ? onStop : onSend}
					className={cn(
						ACTION_BUTTON_BASE,
						"transition-all duration-200",
						isEditMode || isTaskBusy || hasInputContent
							? "opacity-100 pointer-events-auto cursor-pointer"
							: "opacity-0 pointer-events-none",
						(isEditMode || isTaskBusy || hasInputContent) && ACTION_BUTTON_INTERACTIVE,
						isTaskBusy &&
							"bg-vscode-button-background hover:bg-vscode-button-hoverBackground active:bg-vscode-button-hoverBackground",
					)}>
					{isTaskBusy ? (
						<Square className="size-4 stroke-none fill-vscode-button-foreground" />
					) : (
						<SendHorizontal className="size-4" />
					)}
				</button>
			</StandardTooltip>
		</div>
	)
}
