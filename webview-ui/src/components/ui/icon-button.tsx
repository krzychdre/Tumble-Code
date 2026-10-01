import * as React from "react"
import { type LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

import { Button } from "./button"
import { Spinner } from "./spinner"
import { StandardTooltip } from "./standard-tooltip"

export interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "title"> {
	/** A codicon name (`"copy"` or `"codicon-copy"`) or a lucide icon component. */
	icon: string | LucideIcon
	/** Accessible name of the button; also its tooltip unless `tooltip` is false. */
	title?: string
	/** Show `title` as a tooltip (default true). */
	tooltip?: boolean
	/** Spins the glyph (codicon) or swaps it for a spinner (lucide). */
	isLoading?: boolean
	/**
	 * `chrome` (default): the quiet 85% opacity buttons of the task header,
	 * task actions and the composer's selectors.
	 * `toolbar`: the square overlay toolbar of images, diagrams and zoom
	 * controls, built on `Button variant="icon"`.
	 */
	variant?: "chrome" | "toolbar"
	/** Toolbar only: 24px (`sm`) or 28px (`md`, default) square. */
	size?: "sm" | "md"
}

const codiconClass = (name: string) => (name.startsWith("codicon-") ? name : `codicon-${name}`)

/**
 * The webview's one icon button (UI plan §2.12), replacing chat/IconButton
 * (codicons), chat/LucideIconButton (lucide) and common/IconButton (toolbar).
 * The click handler is not called while disabled.
 */
const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
	(
		{
			icon,
			title,
			tooltip = true,
			isLoading,
			variant = "chrome",
			size = "md",
			className,
			disabled,
			onClick,
			style,
			...props
		},
		ref,
	) => {
		const isCodicon = typeof icon === "string"
		const Icon = isCodicon ? undefined : icon

		const glyph = isCodicon ? (
			<span className={cn("codicon", codiconClass(icon), isLoading && "codicon-modifier-spin")} />
		) : isLoading ? (
			<Spinner className="size-2.5" />
		) : (
			Icon && <Icon className="size-2.5" />
		)

		const button =
			variant === "toolbar" ? (
				<Button
					ref={ref}
					variant="icon"
					aria-label={title}
					className={cn(
						size === "sm" ? "w-6 h-6" : "w-7 h-7",
						"flex items-center justify-center border-none text-vscode-editor-foreground cursor-pointer",
						"bg-transparent hover:bg-vscode-toolbar-hoverBackground",
						className,
					)}
					disabled={disabled}
					onClick={!disabled ? onClick : undefined}
					style={style}
					{...props}>
					{glyph}
				</Button>
			) : (
				<Button
					ref={ref}
					aria-label={title}
					className={cn(
						"relative inline-flex items-center justify-center",
						"bg-transparent border-none p-1.5",
						// Codicons are 16.5px font glyphs and need the 28px box to centre.
						isCodicon && "min-w-7 min-h-7",
						"text-vscode-foreground opacity-85",
						"transition-all duration-150",
						"focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder",
						"active:bg-[rgba(255,255,255,0.1)]",
						!disabled && "cursor-pointer hover:opacity-100 hover:bg-[rgba(255,255,255,0.03)]",
						disabled && "cursor-not-allowed opacity-40 hover:bg-transparent active:bg-transparent",
						className,
					)}
					disabled={disabled}
					onClick={!disabled ? onClick : undefined}
					style={{ fontSize: 16.5, ...style }}
					{...props}>
					{glyph}
				</Button>
			)

		if (!title || !tooltip) {
			return button
		}

		return <StandardTooltip content={title}>{button}</StandardTooltip>
	},
)
IconButton.displayName = "IconButton"

export { IconButton }
