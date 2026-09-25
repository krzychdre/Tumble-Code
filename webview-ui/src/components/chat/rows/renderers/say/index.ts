import type { SayRendererMap } from "../types"

import { ApiReqRateLimitWaitRow, ApiReqRetryDelayedRow, ApiReqStartedRow } from "./ApiRequestRows"
import { CompletionResultSayRow, ImageRow, SubtaskResultRow, TextRow, UserFeedbackDiffRow } from "./MessageRows"
import { UserFeedbackRow } from "./UserFeedbackRow"
import {
	CheckpointSavedRow,
	CodebaseSearchResultRow,
	CondenseContextErrorRow,
	CondenseContextRow,
	ContextPrunedRow,
	DiffErrorRow,
	ErrorSayRow,
	NoRow,
	ReasoningRow,
	ShellIntegrationWarningRow,
	SlidingWindowTruncationRow,
	TooManyToolsWarningRow,
	UserEditTodosRow,
} from "./StatusRows"
import { SayToolRow } from "./SayToolRows"

export { DefaultSayRow } from "./MessageRows"

/**
 * Renderers for say messages, by `say`. A kind with no entry renders through
 * DefaultSayRow (its text as markdown).
 */
export const SAY_RENDERERS: SayRendererMap = {
	diff_error: DiffErrorRow,
	subtask_result: SubtaskResultRow,
	reasoning: ReasoningRow,
	api_req_started: ApiReqStartedRow,
	api_req_retry_delayed: ApiReqRetryDelayedRow,
	api_req_rate_limit_wait: ApiReqRateLimitWaitRow,
	api_req_finished: NoRow, // we should never see this message type
	text: TextRow,
	user_feedback: UserFeedbackRow,
	user_feedback_diff: UserFeedbackDiffRow,
	error: ErrorSayRow,
	completion_result: CompletionResultSayRow,
	shell_integration_warning: ShellIntegrationWarningRow,
	checkpoint_saved: CheckpointSavedRow,
	condense_context: CondenseContextRow,
	condense_context_error: CondenseContextErrorRow,
	sliding_window_truncation: SlidingWindowTruncationRow,
	context_pruned: ContextPrunedRow,
	codebase_search_result: CodebaseSearchResultRow,
	user_edit_todos: UserEditTodosRow,
	tool: SayToolRow,
	image: ImageRow,
	too_many_tools_warning: TooManyToolsWarningRow,
}
