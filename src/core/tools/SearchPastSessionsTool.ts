import { Task } from "../task/Task"
import type { NativeToolArgs } from "../../shared/tools"
import { clampPastSessionResults, formatPastSessionHits, searchScopeOf } from "./helpers/pastSessions"

import type { ToolCallbacks } from "./BaseTool"
import { PastSessionTool } from "./PastSessionTool"

/** Searches the cloud's cards of earlier sessions visible from this task's project. */
export class SearchPastSessionsTool extends PastSessionTool<"search_past_sessions"> {
	readonly name = "search_past_sessions" as const

	async execute(params: NativeToolArgs["search_past_sessions"], task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { pushToolResult } = callbacks
		const query = typeof params?.query === "string" ? params.query.trim() : ""

		if (query.length === 0) {
			this.recordFailure(task, this.name, { failTurn: true })
			pushToolResult(await task.sayAndCreateMissingParamError(this.name, "query"))
			return
		}

		await this.callCloud(task, pushToolResult, async (api, folder) => {
			const response = await api.recallSearch(folder, {
				query,
				scope: searchScopeOf(params.scope),
				limit: clampPastSessionResults(params.max_results),
				excludeTaskId: task.taskId,
			})
			return {
				row: { tool: "searchPastSessions", query, matchCount: response.results.length },
				text: formatPastSessionHits(query, response),
			}
		})
	}
}

export const searchPastSessionsTool = new SearchPastSessionsTool()
