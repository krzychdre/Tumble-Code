import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
	"inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-base font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 cursor-pointer active:opacity-80",
	{
		variants: {
			variant: {
				primary: "bg-primary text-primary-foreground hover:bg-primary/70",
				secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/70",
				ghost: "hover:bg-accent hover:text-accent-foreground",
				destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
				outline:
					"border border-vscode-foreground/30 text-vscode-foreground bg-transparent hover:bg-secondary hover:text-accent-foreground",
				link: "text-primary underline-offset-4 hover:underline",
				combobox:
					"border border-vscode-dropdown-border focus-visible:border-vscode-focusBorder bg-vscode-dropdown-background hover:bg-transparent text-vscode-dropdown-foreground font-normal",
			},
			size: {
				default: "h-7 px-3",
				sm: "h-6 px-2 text-sm",
				lg: "h-8 px-4 text-lg",
				icon: "h-7 w-7",
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
