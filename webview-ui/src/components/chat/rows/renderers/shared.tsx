import type React from "react"

// Style and icon helpers shared by the chat row renderers.

export const normalColor = "var(--vscode-foreground)"
export const errorColor = "var(--vscode-errorForeground)"
export const successColor = "var(--vscode-charts-green)"
export const cancelledColor = "var(--vscode-descriptionForeground)"

/** The icon + title line at the top of most rows. Spacing comes from the
    §2.1 tokens (ai_plans/2026-09-27_ui-modernization.md). */
export const headerStyle: React.CSSProperties = {
	display: "flex",
	alignItems: "center",
	gap: "var(--spacing-row)",
	cursor: "default",
	marginBottom: "var(--spacing-row)",
	wordBreak: "break-word",
}

/** A codicon in the foreground colour, as tool rows show it before their title. */
export const toolIcon = (name: string) => (
	<span
		className={`codicon codicon-${name}`}
		style={{ color: "var(--vscode-foreground)", marginBottom: "-1.5px" }}></span>
)

/** The lock icon a row shows instead of its tool icon when the target file is protected. */
export const protectedIcon = () => (
	<span
		className="codicon codicon-lock"
		style={{ color: "var(--vscode-editorWarning-foreground)", marginBottom: "-1.5px" }}
	/>
)
