/**
 * The write sandbox for the headless memory sub-agent.
 *
 * Phase 2 of ai_plans/2026-07-01_memory-hook-and-headless-subagent.md.
 *
 * The memory background task runs a real Task loop (so it reuses Roo's native
 * tool-calling and write tools), but must be prevented from writing anywhere
 * except the per-workspace memory directory. We enforce this at the *approval*
 * layer via a per-task `autoApprovalOverride`: the write tools call
 * `askApproval("tool", …)` **before** touching disk, so a `"deny"` here stops the
 * write from ever happening.
 *
 * Policy (fail-safe — the override must ALWAYS decide, never return `undefined`,
 * or a non-current background task would block forever on a webview response):
 * - `command` / `use_mcp_server` asks → `"deny"` (the memory agent never needs
 *   a shell or MCP);
 * - non-`tool` asks (followup, completion_result, resume, …) → `"approve"` (so
 *   nothing hangs — the task runs autonomously);
 * - read-only tool actions → `"approve"` (reads/searches are safe anywhere);
 * - any tool whose target path resolves inside the memory dir → `"approve"`;
 * - everything else (writes outside the memory dir, path-less write actions) →
 *   `"deny"`.
 */

import * as path from "path"

import type { ClineSayTool } from "@roo-code/types"

import { isReadOnlyToolAction } from "../auto-approval/tools"
import { isAutoMemPath } from "./paths"

export type SandboxDecision = "approve" | "deny"

/**
 * Key names that are considered path-bearing for write containment. Any field
 * with one of these keys whose value is a non-empty string is validated against
 * the memory directory. The list covers all current write-tool arg shapes
 * (`path` for write_to_file/apply_diff, `file_path` for edit/edit_file) plus
 * likely future write-capable field names (`dest`, `destination`, `target`,
 * `targetPath`, `to`). Read-only pattern fields (`searchPattern`, `filePattern`,
 * `regex`) are intentionally NOT listed — they are not path-bearing for writes.
 */
const PATH_BEARING_KEYS = new Set([
	"path",
	"file_path",
	"filePath",
	"dest",
	"destination",
	"target",
	"targetPath",
	"to",
])

/**
 * Collect all string values from the parsed tool-ask payload whose key matches a
 * path-bearing name. Checks the top level and one level into arrays of objects
 * (e.g. `files: [{path: …}]`). Returns the raw string values (unresolved).
 */
function collectPathBearingValues(parsed: Record<string, unknown>): string[] {
	const values: string[] = []
	for (const [key, val] of Object.entries(parsed)) {
		if (PATH_BEARING_KEYS.has(key) && typeof val === "string" && val.length > 0) {
			values.push(val)
		} else if (Array.isArray(val)) {
			// Arrays of objects (e.g. `files: [{path: …}]`) are scanned regardless
			// of the array's own key — the array key ("files") is not path-bearing,
			// its items' keys are.
			for (const item of val) {
				if (item && typeof item === "object") {
					for (const [subKey, subVal] of Object.entries(item as Record<string, unknown>)) {
						if (PATH_BEARING_KEYS.has(subKey) && typeof subVal === "string" && subVal.length > 0) {
							values.push(subVal)
						}
					}
				}
			}
		}
	}
	return values
}

/**
 * Build the memory write-sandbox auto-approval predicate for a given cwd. The
 * returned function is structurally compatible with `Task`'s
 * `AutoApprovalOverride` ((ask, text) => "approve" | "deny" | undefined).
 */
export function memoryWriteSandbox(cwd: string): (ask: string, text?: string) => SandboxDecision {
	return (ask, text) => {
		// Capabilities the memory agent must never use.
		if (ask === "command" || ask === "use_mcp_server") {
			return "deny"
		}
		// Non-tool asks (followup / completion_result / resume / …): approve so the
		// autonomous task never blocks waiting for a user it can't reach.
		if (ask !== "tool") {
			return "approve"
		}
		let parsed: ClineSayTool | undefined
		try {
			parsed = JSON.parse(text ?? "{}") as ClineSayTool
		} catch {
			// Unparseable tool ask — fail-safe deny: a malformed write must not
			// bypass the containment check.
			return "deny"
		}
		if (parsed && isReadOnlyToolAction(parsed)) {
			return "approve"
		}
		// Generic path containment: collect ALL path-bearing fields from the parsed
		// payload and require EVERY one to resolve inside the memory dir. This
		// catches not just `parsed.path` but also `file_path`, `dest`, etc. that a
		// future write-capable tool might carry.
		const pathValues = collectPathBearingValues(parsed as unknown as Record<string, unknown>)
		if (pathValues.length > 0 && pathValues.every((p) => isAutoMemPath(path.resolve(cwd, p), cwd))) {
			return "approve"
		}
		// Writes outside the memory dir (or path-less write actions) are denied.
		return "deny"
	}
}

/**
 * Filter a set of task-edited paths down to those inside the memory directory,
 * resolved to absolute paths. Used to report what the memory sub-agent wrote.
 */
export function filterMemoryWrittenPaths(paths: ReadonlyArray<string>, cwd: string): string[] {
	return paths.map((p) => (path.isAbsolute(p) ? p : path.resolve(cwd, p))).filter((p) => isAutoMemPath(p, cwd))
}
