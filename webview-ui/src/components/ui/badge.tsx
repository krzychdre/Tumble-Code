import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
	"inline-flex items-center rounded-control border border-transparent px-2 py-0.5 text-xs font-semibold transition-colors focus-visible:outline-solid focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-vscode-focusBorder",
	{
		variants: {
			variant: {
				default: "border-input-frame bg-surface text-vscode-foreground",
				secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
				destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/80",
				outline: "border-input-frame bg-surface text-vscode-descriptionForeground",
				// VS Code's own badge: a compact 18px pill for a count, a cost or a short source label.
				count: "h-[18px] min-w-[18px] justify-center px-1.5 py-0 text-[11px] leading-4 font-normal border-[var(--vscode-button-border,transparent)] bg-vscode-badge-background text-vscode-badge-foreground",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
)

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
	return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
