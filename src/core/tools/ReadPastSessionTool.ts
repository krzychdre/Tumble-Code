import { Task } from "../task/Task"
import type { NativeToolArgs } from "../../shared/tools"
import { formatPastSessionPage, sessionPartOf } from "./helpers/pastSessions"

import type { ToolCallbacks } from "./BaseTool"
import { PastSessionTool } from "./PastSessionTool"

/** Reads the card, or a page of the conversation, of one session search_past_sessions found. */
export class ReadPastSessionTool extends PastSessionTool<"read_past_session"> {
	readonly name = "read_past_session" as const

	async execute(params: NativeToolArgs["read_past_session"], task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { pushToolResult } = callbacks
		const sessionId = typeof params?.session_id === "string" ? params.session_id.trim() : ""

		if (sessionId.length === 0) {
			this.recordFailure(task, this.name, { failTurn: true })
			pushToolResult(await task.sayAndCreateMissingParamError(this.name, "session_id"))
			return
		}

		await this.callCloud(task, pushToolResult, async (api, folder) => {
			const page = await api.recallSession(folder, sessionId, {
				part: sessionPartOf(params.part),
				offset: params.offset,
			})
			return {
				// The row names the session by its title (see toolPayloadSubject).
				row: { tool: "readPastSession", description: page.title },
				text: formatPastSessionPage(page),
			}
		})
	}
}

export const readPastSessionTool = new ReadPastSessionTool()
