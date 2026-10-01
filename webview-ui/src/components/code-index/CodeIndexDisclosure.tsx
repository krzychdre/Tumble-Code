import type { ReactNode } from "react"

type CodeIndexDisclosureProps = {
	label: string
	isOpen: boolean
	onToggle: () => void
	children: ReactNode
}

/**
 * A collapsible group of the code index form. The open flag is owned by the popover, not by this
 * component, so a group stays open when the popover content unmounts on close and mounts on reopen.
 */
export const CodeIndexDisclosure = ({ label, isOpen, onToggle, children }: CodeIndexDisclosureProps) => (
	<div className="mt-4">
		<button
			onClick={onToggle}
			className="flex items-center text-xs text-vscode-foreground hover:text-vscode-textLink-foreground focus-ring"
			aria-expanded={isOpen}>
			<span
				className={`codicon codicon-${isOpen ? "chevron-down" : "chevron-right"} mr-1`}
				aria-hidden="true"></span>
			<span className="text-base font-semibold">{label}</span>
		</button>

		{isOpen && <div className="mt-4 space-y-4">{children}</div>}
	</div>
)
