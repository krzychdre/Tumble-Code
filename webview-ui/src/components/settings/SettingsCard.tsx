import { HTMLAttributes, ReactNode } from "react"

import { cn } from "@/lib/utils"

/**
 * The frame language of the settings pages (ai_plans/2026-10-09_ui-frame-settings.md).
 *
 * One description style for every setting: a line of secondary text right under the label.
 */
export const settingDescription = "text-sm text-vscode-descriptionForeground mt-0.5"

/** The description of a checkbox row, indented to the label text (16px box + 8px gap). */
export const checkboxDescription = "text-sm text-vscode-descriptionForeground mt-0.5 ml-6"

type SettingsCardProps = Omit<HTMLAttributes<HTMLDivElement>, "title"> & {
	/** Small uppercase group label above the card (reuse the section's existing subheading). */
	title?: ReactNode
	/** Secondary text between the group label and the card. */
	description?: ReactNode
}

/**
 * A framed card that groups related settings. Every direct child is one row: padded 10px 12px and
 * separated from the previous row by a frame hairline, so call sites only list their settings.
 */
export const SettingsCard = ({ title, description, className, children, ...props }: SettingsCardProps) => (
	<div className={cn("flex flex-col", className)} {...props}>
		{title && (
			<div className="mb-1.5 ml-0.5 text-xs font-medium uppercase tracking-wide text-vscode-descriptionForeground">
				{title}
			</div>
		)}
		{description && <div className={cn(settingDescription, "mt-0 mb-1.5 ml-0.5")}>{description}</div>}
		<div className="flex flex-col min-w-0 bg-surface border border-frame rounded-control [&>*]:px-3 [&>*]:py-2.5 [&>*+*]:border-t [&>*+*]:border-frame">
			{children}
		</div>
	</div>
)

/**
 * Sub-options that only apply while their parent setting is on: a thin frame rule on the left and
 * an indent, instead of the former bright button-coloured bar.
 */
export const SettingsNested = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
	<div className={cn("flex flex-col gap-block ml-2 pl-4 border-l border-frame-hover", className)} {...props} />
)
