import { describe, it, expect, vi, beforeEach } from "vitest"
import * as path from "path"

// Mock checkAutoApproval and isReadOnlyToolAction. vi.hoisted ensures the
// mock functions are available when the hoisted vi.mock factories run.
const { mockCheckAutoApproval, mockIsReadOnly } = vi.hoisted(() => ({
	mockCheckAutoApproval: vi.fn(),
	mockIsReadOnly: vi.fn(),
}))
vi.mock("../../auto-approval", () => ({
	checkAutoApproval: mockCheckAutoApproval,
}))
vi.mock("../../auto-approval/tools", () => ({
	isReadOnlyToolAction: mockIsReadOnly,
}))

import { buildSubagentApprovalPolicy } from "../subagentApproval"

const WORKTREE = "/home/user/worktree/child-1"

/** A state object that satisfies the Pick<ExtensionState, ...> contract. */
function makeState(overrides: Record<string, unknown> = {}) {
	return {
		autoApprovalEnabled: true,
		alwaysAllowExecute: false,
		allowedCommands: [],
		deniedCommands: [],
		...overrides,
	}
}

/** Build the policy with a getState that returns the given state. */
function makePolicy(state: Record<string, unknown> = {}) {
	return buildSubagentApprovalPolicy({
		getState: async () => makeState(state) as any,
		worktreePath: WORKTREE,
	})
}

const toolAsk = (tool: string, p?: string) => JSON.stringify({ tool, path: p })

beforeEach(() => {
	vi.clearAllMocks()
	mockIsReadOnly.mockReturnValue(false)
	mockCheckAutoApproval.mockResolvedValue({ decision: "ask" })
})

describe("buildSubagentApprovalPolicy", () => {
	describe("non-actionable asks → approve (no delegation)", () => {
		it("defers followup to the normal ask flow (interactive, bounded by the TaskAskSay fallback)", async () => {
			const decide = makePolicy()
			expect(await decide("followup", JSON.stringify({ suggest: [] }))).toBeUndefined()
			expect(mockCheckAutoApproval).not.toHaveBeenCalled()
		})

		it("approves completion_result without consulting checkAutoApproval", async () => {
			const decide = makePolicy()
			expect(await decide("completion_result", "done")).toBe("approve")
			expect(mockCheckAutoApproval).not.toHaveBeenCalled()
		})

		it("approves api_req_failed without consulting checkAutoApproval", async () => {
			const decide = makePolicy()
			expect(await decide("api_req_failed")).toBe("approve")
			expect(mockCheckAutoApproval).not.toHaveBeenCalled()
		})

		it("approves resume_task without consulting checkAutoApproval", async () => {
			const decide = makePolicy()
			expect(await decide("resume_task")).toBe("approve")
			expect(mockCheckAutoApproval).not.toHaveBeenCalled()
		})
	})

	describe("tool asks", () => {
		it("approves read-only tool actions without consulting checkAutoApproval", async () => {
			mockIsReadOnly.mockReturnValue(true)
			const decide = makePolicy()
			expect(await decide("tool", toolAsk("readFile", "/anywhere"))).toBe("approve")
			expect(mockCheckAutoApproval).not.toHaveBeenCalled()
		})

		it("approves tool write with path inside the worktree without consulting checkAutoApproval", async () => {
			const decide = makePolicy()
			const inside = path.join(WORKTREE, "src", "main.ts")
			expect(await decide("tool", toolAsk("editedExistingFile", inside))).toBe("approve")
			expect(mockCheckAutoApproval).not.toHaveBeenCalled()
		})

		it("approves tool write with relative path resolving inside the worktree", async () => {
			const decide = makePolicy()
			expect(await decide("tool", toolAsk("newFileCreated", "src/main.ts"))).toBe("approve")
			expect(mockCheckAutoApproval).not.toHaveBeenCalled()
		})

		it("approves tool write inside the worktree when isProtected is undefined/false", async () => {
			const decide = makePolicy()
			const inside = path.join(WORKTREE, "src", "main.ts")
			expect(await decide("tool", toolAsk("editedExistingFile", inside), undefined)).toBe("approve")
			expect(await decide("tool", toolAsk("editedExistingFile", inside), false)).toBe("approve")
			expect(mockCheckAutoApproval).not.toHaveBeenCalled()
		})

		it("delegates a protected-file write inside the worktree to checkAutoApproval", async () => {
			mockCheckAutoApproval.mockResolvedValue({ decision: "deny" })
			const decide = makePolicy()
			const inside = path.join(WORKTREE, ".rooignore")
			const text = toolAsk("editedExistingFile", inside)
			expect(await decide("tool", text, true)).toBe("deny")
			expect(mockCheckAutoApproval).toHaveBeenCalledWith({
				state: expect.any(Object),
				ask: "tool",
				text,
				isProtected: true,
			})
		})

		it("maps checkAutoApproval approve to approve for a protected write inside the worktree", async () => {
			mockCheckAutoApproval.mockResolvedValue({ decision: "approve" })
			const decide = makePolicy({ alwaysAllowWriteProtected: true })
			const inside = path.join(WORKTREE, ".roomodes")
			expect(await decide("tool", toolAsk("editedExistingFile", inside), true)).toBe("approve")
			expect(mockCheckAutoApproval).toHaveBeenCalledOnce()
		})

		it("delegates tool write with path outside the worktree to checkAutoApproval", async () => {
			mockCheckAutoApproval.mockResolvedValue({ decision: "deny" })
			const decide = makePolicy()
			expect(await decide("tool", toolAsk("editedExistingFile", "/workspace/src/evil.ts"))).toBe("deny")
			expect(mockCheckAutoApproval).toHaveBeenCalledOnce()
		})

		it("delegates path traversal attempt (../outside.ts) to checkAutoApproval", async () => {
			mockCheckAutoApproval.mockResolvedValue({ decision: "deny" })
			const decide = makePolicy()
			expect(await decide("tool", toolAsk("editedExistingFile", "../../outside.ts"))).toBe("deny")
			expect(mockCheckAutoApproval).toHaveBeenCalledOnce()
		})

		it("denies unparseable tool text (fail-safe: malformed write must not bypass containment)", async () => {
			const decide = makePolicy()
			expect(await decide("tool", "not json")).toBe("deny")
			expect(await decide("tool", "{invalid")).toBe("deny")
			expect(mockCheckAutoApproval).not.toHaveBeenCalled()
		})
	})

	describe("command asks → delegate to checkAutoApproval", () => {
		it("approves when checkAutoApproval returns approve", async () => {
			mockCheckAutoApproval.mockResolvedValue({ decision: "approve" })
			const decide = makePolicy({ allowedCommands: ["echo"] })
			expect(await decide("command", "echo hi")).toBe("approve")
		})

		it("denies when checkAutoApproval returns deny", async () => {
			mockCheckAutoApproval.mockResolvedValue({ decision: "deny" })
			const decide = makePolicy({ deniedCommands: ["rm"] })
			expect(await decide("command", "rm -rf /")).toBe("deny")
		})

		it("denies when checkAutoApproval returns ask (headless child has no user)", async () => {
			mockCheckAutoApproval.mockResolvedValue({ decision: "ask" })
			const decide = makePolicy()
			expect(await decide("command", "some-cmd")).toBe("deny")
		})

		it("denies when checkAutoApproval returns timeout", async () => {
			mockCheckAutoApproval.mockResolvedValue({
				decision: "timeout",
				timeout: 60_000,
				fn: () => ({ askResponse: "messageResponse", text: "" }),
			})
			const decide = makePolicy()
			expect(await decide("command", "some-cmd")).toBe("deny")
		})

		it("passes ask/text/isProtected to checkAutoApproval", async () => {
			mockCheckAutoApproval.mockResolvedValue({ decision: "approve" })
			const decide = makePolicy()
			await decide("command", "echo hi", true)
			expect(mockCheckAutoApproval).toHaveBeenCalledWith({
				state: expect.any(Object),
				ask: "command",
				text: "echo hi",
				isProtected: true,
			})
		})
	})

	describe("use_mcp_server asks → delegate", () => {
		it("delegates use_mcp_server to checkAutoApproval", async () => {
			mockCheckAutoApproval.mockResolvedValue({ decision: "ask" })
			const decide = makePolicy()
			expect(await decide("use_mcp_server", '{"type":"use_mcp_tool"}')).toBe("deny")
			expect(mockCheckAutoApproval).toHaveBeenCalledOnce()
		})

		it("approves use_mcp_server when checkAutoApproval returns approve", async () => {
			mockCheckAutoApproval.mockResolvedValue({ decision: "approve" })
			const decide = makePolicy()
			expect(await decide("use_mcp_server", '{"type":"use_mcp_tool"}')).toBe("approve")
		})
	})

	describe("always decides except interactive followups", () => {
		it("decides for every non-followup ask type", async () => {
			const decide = makePolicy()
			for (const ask of [
				"tool",
				"command",
				"use_mcp_server",
				"completion_result",
				"api_req_failed",
				"resume_task",
			]) {
				const result = await decide(ask as any, "{}")
				expect(["approve", "deny"]).toContain(result)
			}
		})

		it("returns undefined only for followup (blocking wait is bounded in TaskAskSay)", async () => {
			const decide = makePolicy()
			expect(await decide("followup", "{}")).toBeUndefined()
		})
	})
})
