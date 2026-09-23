import os from "os"
import path from "path"

import { memo, useRef, useState } from "react"
import { Box, Text, useInput } from "ink"

import type { McpServer } from "@roo-code/types"

import { isFailedMcpServer, lastMcpErrorLine } from "@/lib/utils/mcp-status.js"

import * as theme from "../theme.js"
import { figures } from "../figures.js"

/** Server rows shown at once; the panel lives in the height-clamped tail. */
const MAX_VISIBLE_SERVERS = 8
/** Longest name column before names are cut. */
const MAX_NAME_WIDTH = 24

export interface McpPanelProps {
	servers: McpServer[]
	/** The global config file (~/.roo/mcp.json unless mcpSettingsPath points elsewhere) */
	globalConfigPath: string
	/** The project config file (<workspace>/.roo/mcp.json) */
	projectConfigPath: string
	onRestart: (server: McpServer) => void
	onToggleDisabled: (server: McpServer) => void
	onReload: () => void
	/** When false, the panel ignores all input (default true) */
	isActive?: boolean
}

type ServerState = McpServer["status"] | "disabled" | "failed"

function getServerState(server: McpServer): ServerState {
	if (server.disabled) {
		return "disabled"
	}

	return isFailedMcpServer(server) ? "failed" : server.status
}

/**
 * Project servers first, as McpHub prefers them when a name exists in both
 * files; each group keeps the order it arrived in.
 */
function orderServers(servers: McpServer[]): McpServer[] {
	return [
		...servers.filter((server) => server.source === "project"),
		...servers.filter((server) => server.source !== "project"),
	]
}

function serverKey(server: McpServer): string {
	return `${server.source ?? "global"}:${server.name}`
}

/** Row of the selected server; the first row when it is gone or none was chosen. */
function indexOfKey(servers: McpServer[], key: string | null): number {
	return Math.max(
		0,
		servers.findIndex((server) => serverKey(server) === key),
	)
}

function tildify(filePath: string): string {
	const home = os.homedir()
	return filePath.startsWith(home + path.sep) ? `~${filePath.slice(home.length)}` : filePath
}

const STATE_COLORS: Record<ServerState, string> = {
	connected: theme.success,
	connecting: theme.warning,
	disconnected: theme.inactive,
	disabled: theme.inactive,
	failed: theme.error,
}

function stateSummary(server: McpServer, state: ServerState): string {
	switch (state) {
		case "connected": {
			const count = server.tools?.length ?? 0
			return `connected ${figures.dot} ${count} ${count === 1 ? "tool" : "tools"}`
		}
		case "connecting":
			return `connecting${figures.ellipsis}`
		default:
			return state
	}
}

/**
 * `/mcp`: the MCP servers of this session, from the global and the project
 * config, with their state, and the actions of the VS Code MCP view that
 * matter in a terminal: restart, enable/disable, reload the config files
 * (the CLI has no file watcher, so an edit shows up only after a reload).
 * Esc is handled by useGlobalInput, which also keeps it from cancelling a
 * running task.
 */
function McpPanel({
	servers,
	globalConfigPath,
	projectConfigPath,
	onRestart,
	onToggleDisabled,
	onReload,
	isActive = true,
}: McpPanelProps) {
	const ordered = orderServers(servers)
	// Selection follows the server, not the row: the list is re-sent on every
	// connection change and a server can move.
	const [selectedKey, setSelectedKey] = useState<string | null>(null)
	const selectedIndex = indexOfKey(ordered, selectedKey)
	const selected = ordered[selectedIndex]

	// The key handler reads the selection through refs: two keys can arrive
	// before React re-renders (a held arrow), and a handler closing over the
	// rendered values would move from a stale row.
	const orderedRef = useRef(ordered)
	orderedRef.current = ordered
	const selectedKeyRef = useRef(selectedKey)
	selectedKeyRef.current = selectedKey

	useInput(
		(input, key) => {
			const list = orderedRef.current
			const index = indexOfKey(list, selectedKeyRef.current)

			if (key.upArrow || key.downArrow) {
				const next = list[index + (key.upArrow ? -1 : 1)]
				if (next) {
					selectedKeyRef.current = serverKey(next)
					setSelectedKey(selectedKeyRef.current)
				}
				return
			}

			if (input === "R") {
				onReload()
				return
			}

			const current = list[index]

			if (!current) {
				return
			}

			if (input === "r" && !current.disabled) {
				onRestart(current)
			} else if (input === " ") {
				onToggleDisabled(current)
			}
		},
		{ isActive },
	)

	const firstVisible = Math.max(
		0,
		Math.min(selectedIndex - Math.floor(MAX_VISIBLE_SERVERS / 2), ordered.length - MAX_VISIBLE_SERVERS),
	)
	const visible = ordered.slice(firstVisible, firstVisible + MAX_VISIBLE_SERVERS)
	const hiddenBelow = ordered.length - firstVisible - visible.length
	const nameWidth = Math.min(MAX_NAME_WIDTH, Math.max(0, ...ordered.map((server) => server.name.length)))

	const selectedState = selected ? getServerState(selected) : undefined
	const selectedConfigPath = selected?.source === "project" ? projectConfigPath : globalConfigPath
	const toolNames = selected?.tools?.map((tool) => tool.name).join(", ")

	return (
		<Box borderStyle="round" borderColor={theme.permission} paddingX={1} flexDirection="column">
			<Text bold color={theme.permission}>
				MCP servers
			</Text>

			{ordered.length === 0 ? (
				<>
					<Text color={theme.secondaryText}>No MCP servers configured. Add them to</Text>
					<Text color={theme.secondaryText} wrap="truncate-end">
						{"  "}
						{tildify(globalConfigPath)} (every project) or
					</Text>
					<Text color={theme.secondaryText} wrap="truncate-end">
						{"  "}
						{tildify(projectConfigPath)} (this project), then press R.
					</Text>
				</>
			) : (
				<>
					{firstVisible > 0 && (
						<Text color={theme.secondaryText}>
							{"  "}
							{figures.arrowUp} {firstVisible} more
						</Text>
					)}
					{visible.map((server) => {
						const isSelected = server === selected
						const state = getServerState(server)
						const name =
							server.name.length > nameWidth
								? `${server.name.slice(0, nameWidth - 1)}${figures.ellipsis}`
								: server.name.padEnd(nameWidth)

						return (
							<Text key={serverKey(server)} wrap="truncate-end">
								<Text color={theme.permission}>{isSelected ? figures.pointer : " "} </Text>
								<Text color={STATE_COLORS[state]}>{figures.bullet} </Text>
								<Text bold={isSelected}>{name} </Text>
								<Text color={theme.secondaryText}>{(server.source ?? "global").padEnd(8)}</Text>
								<Text color={state === "failed" ? theme.error : theme.secondaryText}>
									{stateSummary(server, state)}
								</Text>
							</Text>
						)
					})}
					{hiddenBelow > 0 && (
						<Text color={theme.secondaryText}>
							{"  "}
							{figures.arrowDown} {hiddenBelow} more
						</Text>
					)}

					{selected && (
						<Box flexDirection="column" marginTop={1}>
							<Text wrap="truncate-end">
								<Text bold>{selected.name}</Text>
								<Text color={theme.secondaryText}>
									{" "}
									{figures.dot} {selected.source ?? "global"} {figures.dot}{" "}
									{tildify(selectedConfigPath)}
								</Text>
							</Text>
							{selectedState === "failed" && (
								<Text color={theme.error} wrap="truncate-end">
									Error: {lastMcpErrorLine(selected)}
								</Text>
							)}
							{selectedState === "connected" && toolNames && (
								<Text color={theme.secondaryText} wrap="truncate-end">
									Tools: {toolNames}
								</Text>
							)}
						</Box>
					)}
				</>
			)}

			<Box marginTop={1}>
				<Text color={theme.secondaryText} wrap="truncate-end">
					{ordered.length > 0
						? `${figures.arrowUp}${figures.arrowDown} select ${figures.dot} r restart ${figures.dot} space enable/disable ${figures.dot} R reload config files ${figures.dot} esc close`
						: `R reload config files ${figures.dot} esc close`}
				</Text>
			</Box>
		</Box>
	)
}

export default memo(McpPanel)
