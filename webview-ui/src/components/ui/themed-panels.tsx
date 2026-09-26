import * as React from "react"

import { cn } from "@/lib/utils"

export type ThemedPanelTabProps = React.HTMLAttributes<HTMLDivElement>

/** A tab of `ThemedPanels` (replaces the toolkit's `VSCodePanelTab`). */
const ThemedPanelTab = React.forwardRef<HTMLDivElement, ThemedPanelTabProps>(({ className, ...props }, ref) => (
	<div ref={ref} role="tab" className={cn("ui-panel-tab", className)} {...props} />
))
ThemedPanelTab.displayName = "ThemedPanelTab"

export type ThemedPanelViewProps = React.HTMLAttributes<HTMLDivElement>

/** The content of one tab of `ThemedPanels` (replaces the toolkit's `VSCodePanelView`). */
const ThemedPanelView = React.forwardRef<HTMLDivElement, ThemedPanelViewProps>(({ className, ...props }, ref) => (
	<div ref={ref} role="tabpanel" className={cn("ui-panel-view", className)} {...props} />
))
ThemedPanelView.displayName = "ThemedPanelView"

export type ThemedPanelsProps = React.HTMLAttributes<HTMLDivElement>

/**
 * Tabs in VS Code's panel style, the replacement for the deprecated toolkit's
 * `VSCodePanels`. Children are `ThemedPanelTab`s and `ThemedPanelView`s in any
 * order; like the toolkit, the n-th tab shows the n-th view, the first tab is
 * selected initially and the selection is kept inside the component.
 *
 * Keyboard (as in the toolkit): only the selected tab is in the tab order;
 * Left / Right (wrapping), Home and End select and focus another tab. Tabs
 * and views are linked with aria-controls / aria-labelledby, using the ids
 * the call site gave them or generated ones.
 *
 * The look comes from the `.ui-panels` rules in `index.css`.
 */
const ThemedPanels = React.forwardRef<HTMLDivElement, ThemedPanelsProps>(
	({ className, children, "aria-label": ariaLabel = "Panels", ...props }, ref) => {
		const baseId = React.useId()
		const [selectedIndex, setSelectedIndex] = React.useState(0)

		const elements = React.Children.toArray(children).filter(React.isValidElement)
		const tabs = elements.filter((el) => el.type === ThemedPanelTab) as React.ReactElement<ThemedPanelTabProps>[]
		const views = elements.filter((el) => el.type === ThemedPanelView) as React.ReactElement<ThemedPanelViewProps>[]
		const active = Math.min(selectedIndex, Math.max(tabs.length - 1, 0))

		const tabId = (index: number) => tabs[index]?.props.id ?? `${baseId}-tab-${index}`
		const viewId = (index: number) => views[index]?.props.id ?? `${baseId}-panel-${index}`

		const onTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
			const last = tabs.length - 1
			const next =
				event.key === "ArrowRight"
					? active === last
						? 0
						: active + 1
					: event.key === "ArrowLeft"
						? active === 0
							? last
							: active - 1
						: event.key === "Home"
							? 0
							: event.key === "End"
								? last
								: undefined
			if (next === undefined || tabs.length < 2) return
			event.preventDefault()
			setSelectedIndex(next)
			// Focus follows the selection, as in the toolkit.
			const tablist = event.currentTarget.parentElement
			tablist?.querySelectorAll<HTMLElement>(":scope > [role=tab]")[next]?.focus()
		}

		return (
			<div ref={ref} aria-label={ariaLabel} className={cn("ui-panels", className)} {...props}>
				<div role="tablist" className="ui-panels-tablist">
					{tabs.map((tab, index) =>
						React.cloneElement(tab, {
							key: tab.key ?? index,
							id: tabId(index),
							"aria-selected": index === active,
							"aria-controls": viewId(index),
							tabIndex: index === active ? 0 : -1,
							style: { ...tab.props.style, gridColumn: index + 1 },
							onClick: (event: React.MouseEvent<HTMLDivElement>) => {
								tab.props.onClick?.(event)
								setSelectedIndex(index)
							},
							onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
								tab.props.onKeyDown?.(event)
								onTabKeyDown(event)
							},
						} as Partial<ThemedPanelTabProps> & React.Attributes),
					)}
					{tabs.length > 0 && (
						<div className="ui-panels-indicator" style={{ gridColumn: active + 1 }} aria-hidden="true" />
					)}
				</div>
				<div className="ui-panels-tabpanel">
					{views.map((view, index) =>
						React.cloneElement(view, {
							key: view.key ?? index,
							id: viewId(index),
							"aria-labelledby": tabId(index),
							hidden: index !== active,
						} as Partial<ThemedPanelViewProps> & React.Attributes),
					)}
				</div>
			</div>
		)
	},
)
ThemedPanels.displayName = "ThemedPanels"

export { ThemedPanels, ThemedPanelTab, ThemedPanelView }
