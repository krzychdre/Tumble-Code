import { describe, it, expect } from "vitest"

import { buildStaticItems, getStaticCount, getStaticMessages, nextPromotion } from "../transcript.js"
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
		expect(items[0]?.id).toBe("__welcome__")
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

	it("opens a reprint epoch with the divider instead of the banner", () => {
		const items = buildStaticItems({
			messages: [msg("1"), msg("2")],
			welcomeProps,
			expanded: true,
			reprintEpoch: 1,
		})

		expect(items.map((i) => i.kind)).toEqual(["divider", "message", "message"])
		expect(items[0]?.id).toBe("__divider__:1")
		expect(items.some((i) => i.kind === "welcome")).toBe(false)
		for (const item of items) {
			if (item.kind === "message") expect(item.expanded).toBe(true)
		}
	})

	it("uses hyphens only in the divider label", () => {
		const [divider] = buildStaticItems({ messages: [], welcomeProps, expanded: true, reprintEpoch: 2 })

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

	it("gives every reprint epoch its own divider id", () => {
		const first = buildStaticItems({ messages: [], welcomeProps, expanded: true, reprintEpoch: 1 })
		const second = buildStaticItems({ messages: [], welcomeProps, expanded: true, reprintEpoch: 2 })

		expect(first[0]?.id).not.toBe(second[0]?.id)
	})

	it("keeps the divider for an epoch after verbose is switched back off", () => {
		// Toggling off does not bump the epoch, and the batch it labels is
		// already in scrollback, so the divider must not disappear.
		const items = buildStaticItems({
			messages: [msg("1")],
			welcomeProps,
			expanded: false,
			reprintEpoch: 1,
		})

		expect(items.map((i) => i.kind)).toEqual(["divider", "message"])
		for (const item of items) {
			if (item.kind === "message") expect(item.expanded).toBe(false)
		}
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
