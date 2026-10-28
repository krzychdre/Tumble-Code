import { CloudAPIError, CloudService, type RecallFolder } from "@tumble-code/cloud"

import type { ClineSayTool } from "@tumble-code/types"

import { Task } from "../task/Task"
import type { PushToolResult } from "../../shared/tools"
import { formatResponse } from "../prompts/responses"
import { recallFolder } from "../../services/recall/recallScope"
import { describeRecallFailure, type RecallToolName } from "./helpers/pastSessions"

import { BaseTool } from "./BaseTool"

type RecallApi = NonNullable<CloudService["cloudAPI"]>

/** What a successful recall call shows: the chat row, and the text the model reads. */
export interface PastSessionAnswer {
	row: ClineSayTool
	text: string
}

/**
 * The part search_past_sessions and read_past_session share: the call to the cloud for the
 * task's folder, and every failure mapped to a tool result the model can act on. Read-only
 * and without approval, like search_task_history: the cloud decides what the user may see.
 */
export abstract class PastSessionTool<TName extends RecallToolName> extends BaseTool<TName> {
	protected async callCloud(
		task: Task,
		pushToolResult: PushToolResult,
		call: (api: RecallApi, folder: RecallFolder) => Promise<PastSessionAnswer>,
	): Promise<void> {
		const api = CloudService.hasInstance() ? CloudService.instance.cloudAPI : null
		// No cloud client at all answers like a signed-out one.
		let statusCode: number | undefined = 401
		if (api) {
			try {
				const { row, text } = await call(api, await recallFolder(task.cwd))
				await task.say("tool", JSON.stringify(row))
				task.consecutiveMistakeCount = 0
				pushToolResult(text)
				return
			} catch (error) {
				statusCode = error instanceof CloudAPIError ? error.statusCode : undefined
			}
		}

		const failure = describeRecallFailure(statusCode, this.name)
		await task.say("error", failure.message)
		if (failure.modelMistake) {
			this.recordFailure(task, this.name, { failTurn: true })
			pushToolResult(formatResponse.toolError(failure.message, this.name))
		} else {
			task.didToolFailInCurrentTurn = true
			pushToolResult(formatResponse.toolError(failure.message))
		}
	}
}
