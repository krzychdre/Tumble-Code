import { HTMLAttributes } from "react"

import { cn } from "@/lib/utils"

type SectionHeaderProps = HTMLAttributes<HTMLDivElement> & {
	children: React.ReactNode
	description?: React.ReactNode
	/** Buttons on the right of the title (the Modes page puts its file menu, marketplace and import there). */
	actions?: React.ReactNode
}

/** The sticky title of a settings section (every settings tab and the Modes page). */
export const SectionHeader = ({ description, actions, children, className, ...props }: SectionHeaderProps) => {
	return (
		<div
			className={cn(
				"sticky top-0 z-10 text-vscode-sideBar-foreground bg-vscode-sideBar-background px-5 pt-6 pb-4",
				className,
			)}
			{...props}>
			<div className="flex items-center justify-between gap-2">
				<h3 className="text-title font-semibold text-vscode-foreground m-0">{children}</h3>
				{actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
			</div>
			{description && <p className="text-vscode-descriptionForeground text-sm mt-2 mb-0">{description}</p>}
		</div>
	)
}
