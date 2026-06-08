import React, { useState, useEffect, useRef, useCallback } from "react"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import type { McpServer } from "@roo-code/types"
import McpServerChecklist from "./McpServerChecklist"

export interface McpServerRestrictionProps {
	/** Identity of the mode being edited; a change reseeds the cache (mode switch). */
	slug: string
	/** The mode's current allowlist from the host (`undefined` = unrestricted, `[]` = none). */
	value: string[] | undefined
	mcpServers: McpServer[]
	/** Called (debounced) with the next allowlist value to persist. */
	onChange: (next: string[] | undefined) => void
}

/**
 * Returns true when both inputs are undefined OR both are arrays containing
 * the same set of strings (order-insensitive). Used to decide whether the local
 * cached state and the host-side `value` are already in sync, so we can skip
 * redundant persistence calls and external-edit overwrites.
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
 * Edit-panel UI for the per-mode MCP server restriction list. Storage-agnostic: it works for both
 * custom modes (persist via `updateCustomMode`) and built-in modes (persist via the `updatePrompt`
 * / `customModePrompts` override path) — the caller wires `onChange` to the right channel.
 *
 * Implements the cached-state pattern (see AGENTS.md): inputs bind to a local
 * `cachedAllowedMcpServers` buffer rather than the live prop, flushed to the host
 * via `onChange` after a 150 ms debounce. This isolates user edits from the host
 * round-trip so the toggle and per-server checkboxes don't snap back / flicker.
 *
 * Reconciliation rules:
 *  - When `slug` changes (mode switch), reseed from props.
 *  - When `value` changes externally (not our own most recent flush — tracked via
 *    `lastFlushedRef`), overwrite the cache.
 */
const McpServerRestriction: React.FC<McpServerRestrictionProps> = ({ slug, value, mcpServers, onChange }) => {
	const [cachedAllowedMcpServers, setCachedAllowedMcpServers] = useState<string[] | undefined>(value)

	const lastFlushedRef = useRef<string[] | undefined>(value)
	const isInitialMountRef = useRef(true)
	const lastSlugRef = useRef(slug)

	// Always hold the latest `onChange` so the debounced flush calls the freshest closure
	// (which, for custom modes, merges into the freshest mode snapshot) instead of a stale one
	// captured when the timeout was scheduled.
	const latestOnChangeRef = useRef(onChange)
	useEffect(() => {
		latestOnChangeRef.current = onChange
	})

	// Reseed when the user switches to a different mode.
	useEffect(() => {
		if (lastSlugRef.current !== slug) {
			lastSlugRef.current = slug
			setCachedAllowedMcpServers(value)
			lastFlushedRef.current = value
			isInitialMountRef.current = true
		}
	}, [slug, value])

	// External-edit reconciliation.
	useEffect(() => {
		if (lastSlugRef.current !== slug) return
		if (arraysEqualOrBothUndefined(value, cachedAllowedMcpServers)) return
		if (arraysEqualOrBothUndefined(value, lastFlushedRef.current)) return
		setCachedAllowedMcpServers(value)
		lastFlushedRef.current = value
		isInitialMountRef.current = true
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [value, slug])

	// Debounced flush: 150 ms after the last local edit, persist to host.
	useEffect(() => {
		if (isInitialMountRef.current) {
			isInitialMountRef.current = false
			return
		}
		if (arraysEqualOrBothUndefined(cachedAllowedMcpServers, value)) {
			return
		}
		const handle = setTimeout(() => {
			lastFlushedRef.current = cachedAllowedMcpServers
			latestOnChangeRef.current(cachedAllowedMcpServers)
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
