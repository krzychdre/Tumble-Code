import type { ExtensionHost } from "@/agent/index.js"

import { isLiveResumeAskWaiting } from "../run.js"

/**
 * F1 regression: the stdin-stream resume bootstrap must tell the task's LIVE
 * resume ask apart from the stale persisted history tail. The eager state
 * push after showTaskWithId carries the persisted messages, whose tail is
 * the pre-resume ask (typically completion_result, or a stale resume ask
 * from an abandoned open). A message command routed against that stale state
 * answers an ask nothing is waiting on; the answer is cleared when the real
 * ask is registered and the first turn is lost. See
 * ai_plans/2026-09-27_f1-cli-integration-resume-flake.md.
 */

function fakeHost(state: { isWaitingForInput: boolean; currentAsk?: string; lastMessageTs?: number }): ExtensionHost {
	return {
		client: {
			getAgentState: () => state,
		},
	} as unknown as ExtensionHost
}

describe("isLiveResumeAskWaiting", () => {
	const since = 1_000

	it("accepts the live resume ask of a finished task", () => {
		expect(
			isLiveResumeAskWaiting(
				fakeHost({ isWaitingForInput: true, currentAsk: "resume_completed_task", lastMessageTs: 2_000 }),
				since,
			),
		).toBe(true)
	})

	it("accepts the live resume ask of a paused task", () => {
		expect(
			isLiveResumeAskWaiting(
				fakeHost({ isWaitingForInput: true, currentAsk: "resume_task", lastMessageTs: 2_000 }),
				since,
			),
		).toBe(true)
	})

	it("rejects the stale history tail: a completion ask from the persisted messages", () => {
		expect(
			isLiveResumeAskWaiting(
				fakeHost({ isWaitingForInput: true, currentAsk: "completion_result", lastMessageTs: 500 }),
				since,
			),
		).toBe(false)
	})

	it("rejects a resume ask persisted before the bootstrap started (abandoned open)", () => {
		expect(
			isLiveResumeAskWaiting(
				fakeHost({ isWaitingForInput: true, currentAsk: "resume_completed_task", lastMessageTs: 500 }),
				since,
			),
		).toBe(false)
	})

	it("rejects any state where the task is not waiting for input", () => {
		expect(
			isLiveResumeAskWaiting(
				fakeHost({ isWaitingForInput: false, currentAsk: "resume_task", lastMessageTs: 2_000 }),
				since,
			),
		).toBe(false)
	})

	it("rejects a live non-resume ask (a followup the resumed turn produced)", () => {
		expect(
			isLiveResumeAskWaiting(
				fakeHost({ isWaitingForInput: true, currentAsk: "followup", lastMessageTs: 2_000 }),
				since,
			),
		).toBe(false)
	})
})
