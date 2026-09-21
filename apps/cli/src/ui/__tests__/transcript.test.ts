import { describe, it, expect } from "vitest"

import { getStaticCount, getStaticMessages } from "../transcript.js"
import type { TUIMessage } from "../types.js"

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
