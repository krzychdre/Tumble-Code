import { cn } from "@/lib/utils"

// The legacy block used by the file-read rows and the batch permission list. It draws the same
// frame as ToolBlock (ai_plans/2026-10-09_ui-frame-language.md): border-frame, bg-surface,
// rounded-control, a 28px header row with a surface hover.

export const ToolUseBlock = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
	<div
		className={cn(
			"overflow-hidden cursor-pointer border border-frame bg-surface rounded-control font-mono",
			className,
		)}
		{...props}
	/>
)

export const ToolUseBlockHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
	<div
		className={cn(
			"flex min-h-[28px] px-2 font-mono items-center select-none text-sm text-vscode-descriptionForeground",
			"hover:bg-surface-hover hover:text-vscode-foreground transition-colors",
			className,
		)}
		{...props}
	/>
)
