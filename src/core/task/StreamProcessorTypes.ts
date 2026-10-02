import { type ClineApiReqCancelReason } from "@tumble-code/types"

export type UpdateApiReqMsgFn = (cancelReason?: ClineApiReqCancelReason, streamingFailedMessage?: string) => void

export type AbortStreamFn = (cancelReason: ClineApiReqCancelReason, streamingFailedMessage?: string) => Promise<void>

export interface TokenSnapshot {
	input: number
	output: number
	cacheWrite: number
	cacheRead: number
	total?: number | undefined
}
