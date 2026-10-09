import React from "react"

import { cn } from "@/lib/utils"

export interface ToggleSwitchProps {
	checked: boolean
	onChange: () => void
	disabled?: boolean
	/**
	 * Kept for the call sites; both sizes now draw the same 28x16 switch of the frame
	 * language (ai_plans/2026-10-09_ui-frame-language.md).
	 */
	size?: "small" | "medium"
	"aria-label"?: string
	"data-testid"?: string
}

const WIDTH = 28
const HEIGHT = 16
const DOT = 8
/** Gap between the 1px border and the dot, on the top and on the side the dot rests on. */
const INSET = (HEIGHT - 2 - DOT) / 2

/**
 * An outlined switch: off is a transparent track with the toggle outline and a description-coloured
 * dot, on is filled with the button colour and a button-foreground dot. The outline turns to the
 * foreground colour on hover and keyboard focus shows the shared focus ring.
 */
export const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
	checked,
	onChange,
	disabled = false,
	"aria-label": ariaLabel,
	"data-testid": dataTestId,
}) => {
	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault()
			if (!disabled) {
				onChange()
			}
		}
	}

	return (
		<div
			role="switch"
			aria-checked={checked}
			aria-label={ariaLabel}
			tabIndex={disabled ? -1 : 0}
			data-testid={dataTestId}
			className={cn(
				"relative shrink-0 rounded-control border transition-colors",
				"focus-visible:outline-solid focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-vscode-focusBorder",
				checked
					? "border-vscode-button-background bg-vscode-button-background"
					: "border-toggle-border bg-transparent",
				disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:border-vscode-foreground",
			)}
			style={{ width: `${WIDTH}px`, height: `${HEIGHT}px` }}
			onClick={disabled ? undefined : onChange}
			onKeyDown={handleKeyDown}>
			<div
				className={cn(
					"absolute rounded-control transition-[left] duration-200",
					checked ? "bg-vscode-button-foreground" : "bg-vscode-descriptionForeground",
				)}
				style={{
					width: `${DOT}px`,
					height: `${DOT}px`,
					top: `${INSET}px`,
					left: checked ? `${WIDTH - 2 - DOT - INSET}px` : `${INSET}px`,
				}}
			/>
		</div>
	)
}
