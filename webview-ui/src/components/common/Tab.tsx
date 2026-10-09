import React, { HTMLAttributes, useCallback, forwardRef } from "react"
import { ArrowLeft } from "lucide-react"

import { useExtensionSelector } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import { Button, StandardTooltip } from "@/components/ui"

type TabProps = HTMLAttributes<HTMLDivElement>

export const Tab = ({ className, children, ...props }: TabProps) => (
	<div className={cn("fixed inset-0 flex flex-col", className)} {...props}>
		{children}
	</div>
)

export const TabHeader = ({ className, children, ...props }: TabProps) => (
	<div className={cn("px-5 py-2.5 border-b border-frame", className)} {...props}>
		{children}
	</div>
)

type TabTitleProps = {
	title: React.ReactNode
	/** Accessible name of the back button (it shows only an arrow). */
	backLabel: string
	onBack: () => void
	/** Optional tooltip of the back button. */
	backTooltip?: string
	backTestId?: string
}

/** The back arrow and the title of a full-page view, the left side of its `TabHeader`. */
export const TabTitle = ({ title, backLabel, onBack, backTooltip, backTestId }: TabTitleProps) => {
	const back = (
		<Button variant="ghost" className="px-1.5 -ml-2" onClick={onBack} data-testid={backTestId}>
			<ArrowLeft aria-hidden="true" />
			<span className="sr-only">{backLabel}</span>
		</Button>
	)
	return (
		<div className="flex items-center gap-2 min-w-0">
			{backTooltip ? <StandardTooltip content={backTooltip}>{back}</StandardTooltip> : back}
			<h3 className="m-0 text-lg font-bold text-vscode-foreground truncate">{title}</h3>
		</div>
	)
}

export const TabContent = forwardRef<HTMLDivElement, TabProps>(({ className, children, ...props }, ref) => {
	// P1: narrow slice.
	const renderContext = useExtensionSelector((s) => s.renderContext)

	const onWheel = useCallback(
		(e: React.WheelEvent<HTMLDivElement>) => {
			if (renderContext !== "editor") {
				return
			}

			const target = e.target as HTMLElement

			// Prevent scrolling if the target is a listbox or option
			// (e.g. selects, dropdowns, etc).
			if (target.role === "listbox" || target.role === "option") {
				return
			}

			e.currentTarget.scrollTop += e.deltaY
		},
		[renderContext],
	)

	return (
		<div ref={ref} className={cn("flex-1 overflow-auto p-5", className)} onWheel={onWheel} {...props}>
			{children}
		</div>
	)
})
TabContent.displayName = "TabContent"

export const TabList = forwardRef<
	HTMLDivElement,
	HTMLAttributes<HTMLDivElement> & {
		value: string
		onValueChange: (value: string) => void
	}
>(({ children, className, value, onValueChange, ...props }, ref) => {
	return (
		<div ref={ref} role="tablist" className={cn("flex", className)} {...props}>
			{React.Children.map(children, (child) => {
				if (React.isValidElement<{ value: string }>(child)) {
					return React.cloneElement(child as React.ReactElement<any>, {
						isSelected: child.props.value === value,
						onSelect: () => onValueChange(child.props.value),
					})
				}
				return child
			})}
		</div>
	)
})

export const TabTrigger = forwardRef<
	HTMLButtonElement,
	React.ButtonHTMLAttributes<HTMLButtonElement> & {
		value: string
		isSelected?: boolean
		onSelect?: () => void
	}
>(({ children, className, value: _value, isSelected, onSelect, ...props }, ref) => {
	return (
		<button
			ref={ref}
			role="tab"
			aria-selected={isSelected}
			tabIndex={isSelected ? 0 : -1}
			className={cn("focus:outline-none focus-visible:outline-solid focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-vscode-focusBorder", className)}
			onClick={onSelect}
			{...props}>
			{children}
		</button>
	)
})
