import React, { useState, useEffect, useRef, useCallback } from "react"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import type { ModeConfig, McpServer } from "@roo-code/types"
import McpServerChecklist from "./McpServerChecklist"

export interface McpServerRestrictionProps {
	customMode: ModeConfig
	mcpServers: McpServer[]
	onCommit: (slug: string, updates: ModeConfig) => void
}

/**
 * Returns true when both inputs are undefined OR both are arrays containing
 * the same set of strings (order-insensitive). Used to decide whether the local
 * cached state and the host-side `customMode.allowedMcpServers` are already in
 * sync, so we can skip redundant `updateCustomMode` postMessages and
 * external-edit overwrites.
 */
function arraysEqualOrBothUndefined(a: string[] | undefined, b: string[] | undefined): boolean {
	if (a === b) return true
	if (a === undefined || b === undefined) return false
	if (a.length !== b.length) return false
	const aSorted = [...a].sort()
	const bSorted = [...b].sort()
	for (let i = 0; i < aSorted.length; i++) {
		if (aSorted[i] !== bSorted[i]) return false
	}
	return true
}

/**
 * Edit-panel UI for the per-mode MCP server restriction list.
 *
 * Implements the cached-state pattern (see AGENTS.md): inputs bind to a local
 * `cachedAllowedMcpServers` buffer rather than the live prop, flushed to the host
 * via `onCommit` after a 150 ms debounce. This isolates user edits from the host
 * round-trip so the toggle and per-server checkboxes don't snap back / flicker.
 *
 * Reconciliation rules:
 *  - When `customMode.slug` changes (mode switch), reseed from props.
 *  - When `customMode.allowedMcpServers` changes externally (not our own most
 *    recent flush — tracked via `lastFlushedRef`), overwrite the cache.
 */
const McpServerRestriction: React.FC<McpServerRestrictionProps> = ({ customMode, mcpServers, onCommit }) => {
	const [cachedAllowedMcpServers, setCachedAllowedMcpServers] = useState<string[] | undefined>(
		customMode.allowedMcpServers,
	)

	const lastFlushedRef = useRef<string[] | undefined>(customMode.allowedMcpServers)
	const isInitialMountRef = useRef(true)
	const lastSlugRef = useRef(customMode.slug)

	// Always hold the latest `customMode` and `onCommit` so the debounced flush
	// merges `allowedMcpServers` into the freshest mode snapshot instead of a
	// stale one captured when the timeout was scheduled.
	const latestCustomModeRef = useRef(customMode)
	const latestOnCommitRef = useRef(onCommit)
	useEffect(() => {
		latestCustomModeRef.current = customMode
		latestOnCommitRef.current = onCommit
	})

	// Reseed when the user switches to a different mode.
	useEffect(() => {
		if (lastSlugRef.current !== customMode.slug) {
			lastSlugRef.current = customMode.slug
			setCachedAllowedMcpServers(customMode.allowedMcpServers)
			lastFlushedRef.current = customMode.allowedMcpServers
			isInitialMountRef.current = true
		}
	}, [customMode.slug, customMode.allowedMcpServers])

	// External-edit reconciliation.
	useEffect(() => {
		if (lastSlugRef.current !== customMode.slug) return
		if (arraysEqualOrBothUndefined(customMode.allowedMcpServers, cachedAllowedMcpServers)) return
		if (arraysEqualOrBothUndefined(customMode.allowedMcpServers, lastFlushedRef.current)) return
		setCachedAllowedMcpServers(customMode.allowedMcpServers)
		lastFlushedRef.current = customMode.allowedMcpServers
		isInitialMountRef.current = true
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [customMode.allowedMcpServers, customMode.slug])

	// Debounced flush: 150 ms after the last local edit, postMessage to host.
	useEffect(() => {
		if (isInitialMountRef.current) {
			isInitialMountRef.current = false
			return
		}
		if (arraysEqualOrBothUndefined(cachedAllowedMcpServers, customMode.allowedMcpServers)) {
			return
		}
		const handle = setTimeout(() => {
			lastFlushedRef.current = cachedAllowedMcpServers
			const latestCustomMode = latestCustomModeRef.current
			latestOnCommitRef.current(latestCustomMode.slug, {
				...latestCustomMode,
				allowedMcpServers: cachedAllowedMcpServers,
				source: latestCustomMode.source || "global",
			})
		}, 150)
		return () => clearTimeout(handle)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [cachedAllowedMcpServers])

	const isRestricted = cachedAllowedMcpServers !== undefined

	const handleToggle = useCallback((e: Event | React.FormEvent<HTMLElement>) => {
		const target = (e as CustomEvent)?.detail?.target || (e.target as HTMLInputElement)
		const checked = target.checked
		setCachedAllowedMcpServers(checked ? [] : undefined)
	}, [])

	const handleServerToggle = useCallback(
		(serverName: string) => (e: Event | React.FormEvent<HTMLElement>) => {
			const target = (e as CustomEvent)?.detail?.target || (e.target as HTMLInputElement)
			const checked = target.checked
			setCachedAllowedMcpServers((prev) => {
				const current = prev || []
				if (checked) {
					return current.includes(serverName) ? current : [...current, serverName]
				}
				return current.filter((s) => s !== serverName)
			})
		},
		[],
	)

	return (
		<div className="mt-3 ml-1" data-testid="mcp-server-restriction">
			<VSCodeCheckbox checked={isRestricted} data-testid="restrict-mcp-servers-toggle" onChange={handleToggle}>
				Restrict to specific MCP servers
			</VSCodeCheckbox>
			{isRestricted && (
				<McpServerChecklist
					allowedMcpServers={cachedAllowedMcpServers ?? []}
					mcpServers={mcpServers}
					onServerToggle={handleServerToggle}
					testIdPrefix="mcp-server"
				/>
			)}
		</div>
	)
}

export default React.memo(McpServerRestriction)
export { McpServerRestriction as McpServerRestrictionImpl, arraysEqualOrBothUndefined }
