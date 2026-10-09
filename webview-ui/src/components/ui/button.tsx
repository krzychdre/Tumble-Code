import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * The frame language (ai_plans/2026-10-09_ui-frame-language.md): 26px high (22px for `sm`), 2px corners,
 * one focus ring. Primary is VS Code's filled button with its own hover colour; secondary (and the
 * `outline` / `combobox` looks that converged on it) is an outlined control on the shared surface;
 * destructive is an outlined red button that fills faintly on hover.
 */
const buttonVariants = cva(
	"inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control text-base font-medium transition-colors focus-visible:outline-solid focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-vscode-focusBorder disabled:pointer-events-none disabled:opacity-30 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 cursor-pointer active:opacity-80",
	{
		variants: {
			variant: {
				primary:
					"border border-[var(--vscode-button-border,transparent)] bg-vscode-button-background text-vscode-button-foreground hover:bg-vscode-button-hoverBackground",
				secondary:
					"border border-input-frame bg-surface text-vscode-foreground hover:border-input-frame-hover hover:bg-surface-hover",
				ghost: "hover:bg-surface-hover",
				destructive:
					"border border-[color-mix(in_srgb,var(--vscode-errorForeground)_55%,transparent)] bg-transparent text-vscode-errorForeground hover:bg-[color-mix(in_srgb,var(--vscode-errorForeground)_10%,transparent)]",
				outline:
					"border border-input-frame bg-surface text-vscode-foreground hover:border-input-frame-hover hover:bg-surface-hover",
				link: "text-primary underline-offset-4 hover:underline",
				combobox:
					"border border-input-frame bg-vscode-dropdown-background text-vscode-dropdown-foreground font-normal hover:border-input-frame-hover focus-visible:border-vscode-focusBorder aria-expanded:border-vscode-focusBorder",
			},
			size: {
				default: "h-[26px] px-3",
				sm: "h-[22px] px-2 text-sm",
				lg: "h-[26px] px-4",
				icon: "h-[26px] w-[26px]",
			},
		},
		defaultVariants: {
			variant: "secondary",
			size: "default",
		},
	},
)

export interface ButtonProps
	extends React.ButtonHTMLAttributes<HTMLButtonElement>,
		Omit<VariantProps<typeof buttonVariants>, "variant"> {
	/**
	 * The filled and outline looks come from `buttonVariants`. `icon` is the
	 * bare VS Code icon button (transparent, toolbar hover fill, 3px padding,
	 * a codicon or svg child sized 16x16), styled by the `.ui-button-icon`
	 * rules in index.css; `size` does not apply to it.
	 */
	variant?: VariantProps<typeof buttonVariants>["variant"] | "icon"
	asChild?: boolean
}

/**
 * The webview's one button (UI plan §2.12). `variant="icon"` replaced the
 * former ThemedButton's icon appearance: a native `<button type="button">`
 * (type overridable) whose children get one flex wrapper.
 */
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
	({ className, variant, size, asChild = false, ...props }, ref) => {
		const Comp = asChild ? Slot : "button"
		if (variant === "icon") {
			const { type, children, ...rest } = props
			return (
				<Comp
					className={cn("ui-button-icon", className)}
					ref={ref}
					type={asChild ? type : (type ?? "button")}
					{...rest}>
					{asChild ? children : <span className="ui-button-icon-content">{children}</span>}
				</Comp>
			)
		}
		return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
	},
)
Button.displayName = "Button"

export { Button, buttonVariants }
