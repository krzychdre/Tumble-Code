import type React from "react"

// Style and icon helpers shared by the chat row renderers.

export const normalColor = "var(--vscode-foreground)"
export const errorColor = "var(--vscode-errorForeground)"
export const successColor = "var(--vscode-charts-green)"
export const cancelledColor = "var(--vscode-descriptionForeground)"

/** The icon + title line at the top of most rows. */
export const headerStyle: React.CSSProperties = {
	display: "flex",
	alignItems: "center",
	gap: "10px",
	cursor: "default",
	marginBottom: "10px",
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
