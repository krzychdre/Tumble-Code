import type { ClineMessage } from "@roo-code/types"
import { isNonBlockingAsk } from "@roo-code/types"

/**
 * Whether the current task is doing work the user may want to stop: an LLM
 * request, a running command or MCP call, a retry or rate-limit countdown,
 * another tool, condensing. Only two states are idle: there is no task, or
 * the task waits on the user (an ask nobody has answered yet).
 *
 * `isStreaming` covers the LLM request and stays authoritative: whenever it
 * is true the task is busy, as it was before this helper existed.
 *
 * The rest is read from the last raw message (not the combined history: that
 * one folds `command_output` into its `command` ask and MCP responses into
 * their `use_mcp_server` ask):
 * - a complete ask waits on the user, unless the host already answered it
 *   (`isAnswered`, set by auto-approval), the user answered it from this view
 *   and the host has not sent the next message yet (`answeredAskTs`), or it
 *   is non-blocking (`command_output`: the process is still running);
 * - anything else (a say, the task message alone, a partial ask) means the
 *   host is still working.
 */
export function isTaskBusy(
	lastMessage: ClineMessage | undefined,
	isStreaming: boolean,
	answeredAskTs: number | undefined,
): boolean {
	if (isStreaming) {
		return true
	}

	if (!lastMessage) {
		return false
	}

	const waitsOnUser =
		lastMessage.type === "ask" &&
		lastMessage.partial !== true &&
		lastMessage.isAnswered !== true &&
		lastMessage.ts !== answeredAskTs &&
		!(lastMessage.ask !== undefined && isNonBlockingAsk(lastMessage.ask))

	return !waitsOnUser
}
