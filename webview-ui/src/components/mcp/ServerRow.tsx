import React, { useState } from "react"

import type { McpServer } from "@roo-code/types"

import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { cn } from "@src/lib/utils"
import {
	Button,
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
	DialogFooter,
	ToggleSwitch,
	ThemedPanels,
	ThemedPanelTab,
	ThemedPanelView,
} from "@src/components/ui"

import McpToolRow from "./McpToolRow"
import McpResourceRow from "./McpResourceRow"
import { McpErrorRow } from "./McpErrorRow"

const TIMEOUT_SECONDS = [15, 30, 60, 300, 600, 900, 1800, 3600] as const

const TIMEOUT_LABEL_KEYS: Record<(typeof TIMEOUT_SECONDS)[number], string> = {
	15: "mcp:networkTimeout.options.15seconds",
	30: "mcp:networkTimeout.options.30seconds",
	60: "mcp:networkTimeout.options.1minute",
	300: "mcp:networkTimeout.options.5minutes",
	600: "mcp:networkTimeout.options.10minutes",
	900: "mcp:networkTimeout.options.15minutes",
	1800: "mcp:networkTimeout.options.30minutes",
	3600: "mcp:networkTimeout.options.60minutes",
}

/** The colour of the status dot; a disabled server is always grey. */
const statusDotClass = (server: McpServer) => {
	if (server.disabled) return "bg-vscode-descriptionForeground"
	switch (server.status) {
		case "connected":
			return "bg-[var(--status-done)]"
		case "connecting":
			return "bg-[var(--status-waiting)]"
		case "disconnected":
			return "bg-[var(--status-failed)]"
	}
}

/** The empty state of one tab of an expanded server. */
const EmptyTab = ({ children }: { children: React.ReactNode }) => (
	<div className="py-block text-vscode-descriptionForeground">{children}</div>
)

/** One MCP server in the MCP settings: header row, tools/resources/logs when expanded, the error otherwise. */
export const ServerRow = ({ server, alwaysAllowMcp }: { server: McpServer; alwaysAllowMcp?: boolean }) => {
	const { t } = useAppTranslation()
	const [isExpanded, setIsExpanded] = useState(false)
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
	const [timeoutValue, setTimeoutValue] = useState(() => {
		const configTimeout = JSON.parse(server.config)?.timeout
		return configTimeout ?? 60 // Default 1 minute (60 seconds)
	})

	// Only connected, enabled servers have tools to show.
	const isExpandable = server.status === "connected" && !server.disabled
	const source = server.source || "global"
	const resources = [...(server.resourceTemplates || []), ...(server.resources || [])]

	const handleRowClick = () => {
		if (isExpandable) {
			setIsExpanded(!isExpanded)
		}
	}

	const handleRestart = () => {
		vscode.postMessage({ type: "restartMcpServer", text: server.name, source })
	}

	const handleTimeoutChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
		const seconds = parseInt(event.target.value)
		setTimeoutValue(seconds)
		vscode.postMessage({ type: "updateMcpTimeout", serverName: server.name, source, timeout: seconds })
	}

	const handleDelete = () => {
		vscode.postMessage({ type: "deleteMcpServer", serverName: server.name, source })
		setShowDeleteConfirm(false)
	}

	return (
		<div className="mb-row">
			<div
				className={cn(
					"flex items-center gap-2 p-row bg-vscode-textCodeBlock-background",
					isExpandable ? "cursor-pointer" : "cursor-default",
					server.disabled && "opacity-60",
				)}
				onClick={handleRowClick}>
				{isExpandable && (
					<span className={`codicon codicon-chevron-${isExpanded ? "down" : "right"}`} aria-hidden="true" />
				)}
				<span className="flex-1 min-w-0">
					{server.name}
					{server.source && (
						<span className="ml-2 px-1.5 py-px text-xs bg-vscode-badge-background text-vscode-badge-foreground">
							{server.source}
						</span>
					)}
				</span>
				<div className="flex items-center gap-2 mr-2" onClick={(e) => e.stopPropagation()}>
					<Button
						variant="ghost"
						size="icon"
						aria-label={t("mcp:deleteDialog.title")}
						onClick={() => setShowDeleteConfirm(true)}>
						<span className="codicon codicon-trash" aria-hidden="true" />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						aria-label={t("mcp:serverStatus.restart")}
						onClick={handleRestart}
						disabled={server.status === "connecting"}>
						<span className="codicon codicon-refresh" aria-hidden="true" />
					</Button>
				</div>
				<div className={cn("size-2 ml-2 shrink-0", statusDotClass(server))} data-testid="mcp-server-status" />
				<ToggleSwitch
					checked={!server.disabled}
					onChange={() => {
						vscode.postMessage({
							type: "toggleMcpServer",
							serverName: server.name,
							source,
							disabled: !server.disabled,
						})
					}}
					size="medium"
					aria-label={`Toggle ${server.name} server`}
				/>
			</div>

			{isExpandable
				? isExpanded && (
						<div className="px-2.5 pb-block text-base bg-vscode-textCodeBlock-background">
							<ThemedPanels className="mb-block">
								<ThemedPanelTab id="tools">
									{t("mcp:tabs.tools")} ({server.tools?.length || 0})
								</ThemedPanelTab>
								<ThemedPanelTab id="resources">
									{t("mcp:tabs.resources")} ({resources.length})
								</ThemedPanelTab>
								{server.instructions && (
									<ThemedPanelTab id="instructions">{t("mcp:instructions")}</ThemedPanelTab>
								)}
								<ThemedPanelTab id="logs">
									{t("mcp:tabs.logs")} ({server.errorHistory?.length || 0})
								</ThemedPanelTab>

								<ThemedPanelView id="tools-view">
									{server.tools && server.tools.length > 0 ? (
										<div className="flex flex-col gap-row w-full">
											{server.tools.map((tool) => (
												<McpToolRow
													key={`${tool.name}-${server.name}-${source}`}
													tool={tool}
													serverName={server.name}
													serverSource={source}
													alwaysAllowMcp={alwaysAllowMcp}
												/>
											))}
										</div>
									) : (
										<EmptyTab>{t("mcp:emptyState.noTools")}</EmptyTab>
									)}
								</ThemedPanelView>

								<ThemedPanelView id="resources-view">
									{resources.length > 0 ? (
										<div className="flex flex-col gap-row w-full">
											{resources.map((item) => (
												<McpResourceRow
													key={"uriTemplate" in item ? item.uriTemplate : item.uri}
													item={item}
												/>
											))}
										</div>
									) : (
										<EmptyTab>{t("mcp:emptyState.noResources")}</EmptyTab>
									)}
								</ThemedPanelView>

								{server.instructions && (
									<ThemedPanelView id="instructions-view">
										<div className="py-block text-sm opacity-80 whitespace-pre-wrap break-words">
											{server.instructions}
										</div>
									</ThemedPanelView>
								)}

								<ThemedPanelView id="logs-view">
									{server.errorHistory && server.errorHistory.length > 0 ? (
										<div className="flex flex-col gap-row w-full">
											{[...server.errorHistory]
												.sort((a, b) => b.timestamp - a.timestamp)
												.map((error, index) => (
													<McpErrorRow key={`${error.timestamp}-${index}`} error={error} />
												))}
										</div>
									) : (
										<EmptyTab>{t("mcp:emptyState.noLogs")}</EmptyTab>
									)}
								</ThemedPanelView>
							</ThemedPanels>

							{/* Network Timeout */}
							<div className="py-block px-2">
								<div className="flex items-center gap-2.5 mb-row">
									<span>{t("mcp:networkTimeout.label")}</span>
									<select
										value={timeoutValue}
										onChange={handleTimeoutChange}
										className="flex-1 p-1 cursor-pointer bg-vscode-dropdown-background text-vscode-dropdown-foreground border border-vscode-dropdown-border focus-ring">
										{TIMEOUT_SECONDS.map((seconds) => (
											<option key={seconds} value={seconds}>
												{t(TIMEOUT_LABEL_KEYS[seconds])}
											</option>
										))}
									</select>
								</div>
								<span className="block text-sm text-vscode-descriptionForeground">
									{t("mcp:networkTimeout.description")}
								</span>
							</div>
						</div>
					)
				: // Only show error UI for non-disabled servers
					!server.disabled && (
						<div className="w-full pb-block text-base bg-vscode-textCodeBlock-background">
							<div className="mb-row px-2.5 text-[var(--status-failed)] break-words">
								{server.error &&
									server.error.split("\n").map((item, index) => (
										<React.Fragment key={index}>
											{index > 0 && <br />}
											{item}
										</React.Fragment>
									))}
							</div>
							<div className="px-2.5">
								<Button
									variant="secondary"
									className="w-full"
									onClick={handleRestart}
									disabled={server.status === "connecting"}>
									{server.status === "connecting"
										? t("mcp:serverStatus.retrying")
										: t("mcp:serverStatus.retryConnection")}
								</Button>
							</div>
						</div>
					)}

			{/* Delete Confirmation Dialog */}
			<Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t("mcp:deleteDialog.title")}</DialogTitle>
						<DialogDescription>
							{t("mcp:deleteDialog.description", { serverName: server.name })}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="secondary" onClick={() => setShowDeleteConfirm(false)}>
							{t("mcp:deleteDialog.cancel")}
						</Button>
						<Button variant="primary" onClick={handleDelete}>
							{t("mcp:deleteDialog.delete")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}
