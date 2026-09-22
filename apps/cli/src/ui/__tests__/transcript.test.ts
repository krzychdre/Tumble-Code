import { describe, it, expect } from "vitest"

import { buildStaticItems, getStaticCount, getStaticMessages, nextPromotion, type StaticItem } from "../transcript.js"
import { advanceStreamCommit, tailHeads, type StreamCommits } from "../streamCommit.js"
import type { TUIMessage } from "../types.js"
import type { WelcomeBannerProps } from "../components/WelcomeBanner.js"

function msg(id: string, partial = false): TUIMessage {
	return { id, role: "assistant", content: `content-${id}`, partial }
}

describe("getStaticCount", () => {
	it("returns 0 for empty messages", () => {
		expect(getStaticCount([], false, false)).toBe(0)
	})

	it("returns full length when all final, not loading, no pending ask", () => {
		const messages = [msg("1"), msg("2"), msg("3")]
		expect(getStaticCount(messages, false, false)).toBe(3)
	})

	it("holds back the trailing message when isLoading is true", () => {
		const messages = [msg("1"), msg("2"), msg("3")]
		expect(getStaticCount(messages, true, false)).toBe(2)
	})

	it("holds back the trailing message when hasPendingAsk is true", () => {
		const messages = [msg("1"), msg("2"), msg("3")]
		expect(getStaticCount(messages, false, true)).toBe(2)
	})

	it("returns 0 when loading and only one message exists", () => {
		const messages = [msg("1")]
		expect(getStaticCount(messages, true, false)).toBe(0)
	})

	it("keeps the first-partial clamp while loading", () => {
		// loading alone → 2 (length-1); partial at index 1 → min(2, 1) = 1
		const messages = [msg("1"), msg("2", true), msg("3")]
		expect(getStaticCount(messages, true, false)).toBe(1)
	})

	it("keeps the first-partial clamp while an ask is pending", () => {
		// pending ask alone → 2 (length-1); partial at index 1 → min(2, 1) = 1
		const messages = [msg("1"), msg("2", true), msg("3")]
		expect(getStaticCount(messages, false, true)).toBe(1)
	})

	it("clamps to first partial when partial is the leading message", () => {
		const messages = [msg("1", true), msg("2"), msg("3")]
		expect(getStaticCount(messages, true, false)).toBe(0)
		expect(getStaticCount(messages, false, true)).toBe(0)
	})

	it("does not hold back below the first partial when partial is later", () => {
		// partial at index 2; loading holds back index 3 → min(3, 2) = 2
		const messages = [msg("1"), msg("2"), msg("3", true), msg("4")]
		expect(getStaticCount(messages, true, false)).toBe(2)
		expect(getStaticCount(messages, false, true)).toBe(2)
	})

	it("promotes a stuck partial when idle", () => {
		// idle safety net: nothing can finalize message 2 any more, so holding the
		// rest of the transcript in the clamped tail would lose it for good
		const messages = [msg("1"), msg("2", true), msg("3")]
		expect(getStaticCount(messages, false, false)).toBe(3)
	})

	it("promotes a trailing partial when idle", () => {
		const messages = [msg("1"), msg("2"), msg("3", true)]
		expect(getStaticCount(messages, false, false)).toBe(3)
	})

	it("promotes a leading partial when idle", () => {
		const messages = [msg("1", true), msg("2"), msg("3")]
		expect(getStaticCount(messages, false, false)).toBe(3)
	})
})

describe("getStaticMessages", () => {
	it("returns the promoted prefix slice", () => {
		const messages = [msg("1"), msg("2"), msg("3")]
		const slice = getStaticMessages(messages, false, false)
		expect(slice.length).toBe(3)
		expect(slice.map((m) => m.id)).toEqual(["1", "2", "3"])
	})

	it("returns the held-back slice when loading", () => {
		const messages = [msg("1"), msg("2"), msg("3")]
		const slice = getStaticMessages(messages, true, false)
		expect(slice.map((m) => m.id)).toEqual(["1", "2"])
	})

	it("clamps the slice at the first partial message while loading", () => {
		const messages = [msg("1"), msg("2", true), msg("3")]
		const slice = getStaticMessages(messages, true, false)
		expect(slice.map((m) => m.id)).toEqual(["1"])
	})

	it("returns the whole slice with a stuck partial when idle", () => {
		const messages = [msg("1"), msg("2", true), msg("3")]
		const slice = getStaticMessages(messages, false, false)
		expect(slice.map((m) => m.id)).toEqual(["1", "2", "3"])
	})

	it("returns an empty array for empty messages", () => {
		expect(getStaticMessages([], false, false)).toEqual([])
	})
})

describe("buildStaticItems", () => {
	const welcomeProps: WelcomeBannerProps = {
		workspacePath: "/repo",
		provider: "openai",
		model: "gpt-5",
		mode: "code",
		version: "1.0.0",
	}

	it("opens epoch 0 with the welcome banner and no divider", () => {
		const items = buildStaticItems({
			messages: [msg("1"), msg("2")],
			welcomeProps,
			expanded: false,
			reprintEpoch: 0,
		})

		expect(items.map((i) => i.kind)).toEqual(["welcome", "message", "message"])
		expect(items[0]?.id).toBe("__welcome__:0")
		expect(items.some((i) => i.kind === "divider")).toBe(false)
	})

	it("marks every message item collapsed by default", () => {
		const items = buildStaticItems({
			messages: [msg("1"), msg("2")],
			welcomeProps,
			expanded: false,
			reprintEpoch: 0,
		})

		for (const item of items) {
			if (item.kind === "message") expect(item.expanded).toBe(false)
		}
	})

	it("restores the banner on a reprint and adds the verbosity header", () => {
		// ctrl+o wipes the screen, banner included, so the reprint is the only
		// thing that can put the session's context back.
		const items = buildStaticItems({
			messages: [msg("1"), msg("2")],
			welcomeProps,
			expanded: true,
			reprintEpoch: 1,
		})

		expect(items.map((i) => i.kind)).toEqual(["welcome", "divider", "message", "message"])
		expect(items[0]?.id).toBe("__welcome__:1")
		expect(items[1]?.id).toBe("__divider__:1")
		for (const item of items) {
			if (item.kind === "message") expect(item.expanded).toBe(true)
		}
	})

	it("uses hyphens only in the divider label", () => {
		const [, divider] = buildStaticItems({ messages: [], welcomeProps, expanded: true, reprintEpoch: 2 })

		expect(divider?.kind).toBe("divider")
		if (divider?.kind === "divider") {
			expect(divider.label).toContain("ctrl+o")
			// U+2010..U+2015 are the unicode dashes (hyphen, en dash, em dash,
			// horizontal bar), U+2500..U+257F the box-drawing rules. None of
			// them may appear in UI strings; a plain "-" must be used instead.
			expect(divider.label).not.toMatch(/[\u2010-\u2015\u2500-\u257F]/)
			expect(divider.label).toContain("--")
		}
	})

	it("gives every reprint epoch its own item ids", () => {
		const first = buildStaticItems({ messages: [], welcomeProps, expanded: true, reprintEpoch: 1 })
		const second = buildStaticItems({ messages: [], welcomeProps, expanded: true, reprintEpoch: 2 })

		expect(first.map((i) => i.id)).not.toEqual(second.map((i) => i.id))
	})

	it("heads a collapsed reprint too, since ctrl+o now works in both directions", () => {
		const items = buildStaticItems({
			messages: [msg("1")],
			welcomeProps,
			expanded: false,
			reprintEpoch: 2,
		})

		expect(items.map((i) => i.kind)).toEqual(["welcome", "divider", "message"])
		for (const item of items) {
			if (item.kind === "message") expect(item.expanded).toBe(false)
		}
	})

	it("names the verbosity it is printing at, and the way back out of it", () => {
		const labelOf = (expanded: boolean) => {
			const [, header] = buildStaticItems({ messages: [], welcomeProps, expanded, reprintEpoch: 1 })
			return header?.kind === "divider" ? header.label : ""
		}

		expect(labelOf(true)).toContain("expanded transcript")
		expect(labelOf(true)).toContain("ctrl+o to collapse")
		expect(labelOf(false)).toContain("collapsed transcript")
		expect(labelOf(false)).toContain("ctrl+o to expand")
	})

	it("returns just the head item when there are no promoted messages", () => {
		expect(buildStaticItems({ messages: [], welcomeProps, expanded: false, reprintEpoch: 0 })).toHaveLength(1)
	})
})

describe("nextPromotion", () => {
	const ids = (...names: string[]) => names

	it("promotes nothing and remounts nothing for an untouched empty transcript", () => {
		expect(nextPromotion({ messageIds: [], previousIds: [], staticCount: 0, promoted: 0 })).toEqual({
			remount: false,
			promoted: 0,
		})
	})

	it("keeps the watermark monotonic while a task grows", () => {
		expect(
			nextPromotion({ messageIds: ids("1", "2", "3"), previousIds: ids("1", "2"), staticCount: 2, promoted: 2 }),
		).toEqual({ remount: false, promoted: 2 })

		expect(
			nextPromotion({ messageIds: ids("1", "2", "3"), previousIds: ids("1", "2"), staticCount: 3, promoted: 2 }),
		).toEqual({ remount: false, promoted: 3 })
	})

	it("never lets a promoted message fall back into the tail", () => {
		// staticCount dips (a new partial arrived); what is already in
		// scrollback cannot be un-printed, so the watermark holds.
		expect(
			nextPromotion({ messageIds: ids("1", "2", "3"), previousIds: ids("1", "2"), staticCount: 1, promoted: 3 }),
		).toEqual({ remount: false, promoted: 3 })
	})

	it("remounts when the ids diverge (task switch)", () => {
		expect(
			nextPromotion({ messageIds: ids("9", "8"), previousIds: ids("1", "2"), staticCount: 2, promoted: 2 }),
		).toEqual({ remount: true, promoted: 0 })
	})

	it("remounts when the transcript shrank without emptying", () => {
		expect(
			nextPromotion({ messageIds: ids("1"), previousIds: ids("1", "2", "3"), staticCount: 1, promoted: 3 }),
		).toEqual({ remount: true, promoted: 0 })
	})

	it("drops the watermark when the store is reset to empty", () => {
		// /new and /clear both empty the transcript. Keeping the old watermark
		// here is what promoted the next task's first messages on sight.
		expect(nextPromotion({ messageIds: [], previousIds: ids("1", "2", "3"), staticCount: 0, promoted: 3 })).toEqual(
			{ remount: false, promoted: 0 },
		)
	})

	it("holds back the first streaming message of the task after a reset", () => {
		// The reset dropped the watermark to 0, so the message that arrives
		// next is promoted only when the promotion rule says so (0 while it is
		// still streaming), not because an old high-water mark covers it.
		const afterReset = nextPromotion({
			messageIds: [],
			previousIds: ids("1", "2", "3"),
			staticCount: 0,
			promoted: 3,
		})

		expect(
			nextPromotion({
				messageIds: ids("new-1"),
				previousIds: [],
				staticCount: getStaticCount([msg("new-1", true)], true, false),
				promoted: afterReset.promoted,
			}),
		).toEqual({ remount: false, promoted: 0 })
	})
})

describe("buildStaticItems with an answer streamed into scrollback", () => {
	const welcomeProps: WelcomeBannerProps = {
		workspacePath: "/repo",
		provider: "openai",
		model: "gpt-5",
		mode: "code",
		version: "1.0.0",
	}
	const user: TUIMessage = { id: "u", role: "user", content: "question" }

	/** One App render: promotion rule, tail heads, commit step, item list. */
	function renderStep(messages: TUIMessage[], isLoading: boolean, commits: StreamCommits) {
		const staticCount = getStaticCount(messages, isLoading, false)
		const heads = tailHeads(messages[staticCount], commits)
		if (heads.streaming) {
			const next = advanceStreamCommit(heads.streaming.content, commits[heads.streaming.id])
			if (next) commits = { ...commits, [heads.streaming.id]: next }
		}
		// The commit lands in state, so the list reflects it on the next render.
		const { committed } = tailHeads(messages[staticCount], commits)
		const items = buildStaticItems({
			messages: messages.slice(0, staticCount),
			welcomeProps,
			expanded: false,
			reprintEpoch: 0,
			commits,
			streamingHead: committed,
		})
		return { items, commits }
	}

	it("only ever appends, and prints every line exactly once", () => {
		const answer = (content: string, partial: boolean): TUIMessage => ({
			id: "a",
			role: "assistant",
			content,
			partial,
		})
		const steps: Array<[TUIMessage[], boolean]> = [
			[[user, answer("First para", true)], true],
			[[user, answer("First paragraph.\nSecond", true)], true],
			[[user, answer("First paragraph.\nSecond paragraph.\n\nThird", true)], true],
			// finalized, but held back as the trailing message while loading
			[[user, answer("First paragraph.\nSecond paragraph.\n\nThird paragraph.", false)], true],
			// promoted when the turn goes idle
			[[user, answer("First paragraph.\nSecond paragraph.\n\nThird paragraph.", false)], false],
		]

		let commits: StreamCommits = {}
		let previous: StaticItem[] = []
		for (const [messages, isLoading] of steps) {
			const step = renderStep(messages, isLoading, commits)
			commits = step.commits
			expect(step.items.slice(0, previous.length)).toEqual(previous)
			previous = step.items
		}

		const printed = previous
			.map((item) =>
				item.kind === "chunk" ? item.text : item.kind === "message" ? item.message.content : undefined,
			)
			.filter((text): text is string => text !== undefined)
		expect(previous.map((item) => item.kind)).toEqual(["welcome", "message", "chunk", "chunk", "message"])
		expect(printed).toEqual(["question", "First paragraph.", "Second paragraph.\n", "Third paragraph."])
		expect(
			previous.filter((item) => item.kind === "chunk").map((item) => item.kind === "chunk" && item.first),
		).toEqual([true, false])
		const last = previous[previous.length - 1]
		expect(last?.kind === "message" && last.continuation).toBe(true)
	})

	it("prints the whole message when its final text no longer starts with the chunks", () => {
		const commits: StreamCommits = { a: { chunks: ["Old line"], lines: 1 } }
		const final: TUIMessage = { id: "a", role: "assistant", content: "New text entirely\nmore" }
		const items = buildStaticItems({ messages: [final], welcomeProps, expanded: false, reprintEpoch: 0, commits })

		expect(items.map((item) => item.id)).toEqual(["__welcome__:0", "a#chunk0", "a#full"])
	})

	it("adds no closing item when the chunks already covered the message", () => {
		const commits: StreamCommits = { a: { chunks: ["All of it.", ""], lines: 2 } }
		const final: TUIMessage = { id: "a", role: "assistant", content: "All of it.\n\n" }
		const items = buildStaticItems({ messages: [final], welcomeProps, expanded: false, reprintEpoch: 0, commits })

		expect(items.map((item) => item.id)).toEqual(["__welcome__:0", "a#chunk0", "a#chunk1"])
	})
})

describe("getStaticCount with settleSupersededThinking", () => {
	const thinking = (partial: boolean): TUIMessage => ({ id: "r", role: "thinking", content: "reasoning", partial })
	const answer: TUIMessage = { id: "a", role: "assistant", content: "Para one.\nPara", partial: true }
	const user: TUIMessage = { id: "u", role: "user", content: "q" }

	it("lets the answer lead the tail once it follows an unfinalized thinking message", () => {
		expect(getStaticCount([user, thinking(true), answer], true, false, { settleSupersededThinking: true })).toBe(2)
	})

	it("keeps the strict rule for the expanded transcript", () => {
		expect(getStaticCount([user, thinking(true), answer], true, false)).toBe(1)
	})

	it("still holds a thinking message that nothing follows yet", () => {
		expect(getStaticCount([user, thinking(true)], true, false, { settleSupersededThinking: true })).toBe(1)
	})

	it("never settles a partial message of another role", () => {
		const tool: TUIMessage = { id: "t", role: "tool", content: "out", partial: true }
		expect(getStaticCount([user, tool, answer], true, false, { settleSupersededThinking: true })).toBe(1)
	})
})
