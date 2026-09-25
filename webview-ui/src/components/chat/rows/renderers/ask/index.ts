import type { AskRendererMap } from "../types"

import {
	AutoApprovalMaxReqReachedRow,
	CommandAskRow,
	CompletionResultAskRow,
	FollowupRow,
	MistakeLimitReachedRow,
	UseMcpServerRow,
} from "./AskRows"

/**
 * Renderers for ask messages, by `ask`. A kind with no entry renders nothing.
 * Tool asks go through TOOL_RENDERERS first (when their payload parses).
 */
export const ASK_RENDERERS: AskRendererMap = {
	mistake_limit_reached: MistakeLimitReachedRow,
	command: CommandAskRow,
	use_mcp_server: UseMcpServerRow,
	completion_result: CompletionResultAskRow,
	followup: FollowupRow,
	auto_approval_max_req_reached: AutoApprovalMaxReqReachedRow,
}
