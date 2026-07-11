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
			// Unparseable tool ask — approve conservatively (reads are the common
			// case; a write would still be caught below only if parseable).
			return "approve"
		}
		if (parsed && isReadOnlyToolAction(parsed)) {
			return "approve"
		}
		// Any tool acting on a path inside the memory dir is allowed (memory write).
		const p = parsed?.path
		if (typeof p === "string" && p.length > 0 && isAutoMemPath(path.resolve(cwd, p), cwd)) {
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
