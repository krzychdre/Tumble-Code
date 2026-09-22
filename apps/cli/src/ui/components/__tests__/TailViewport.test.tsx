import { render } from "ink-testing-library"
import { Text } from "ink"

import TailViewport from "../TailViewport.js"

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("TailViewport", () => {
	it("renders short content at natural height", async () => {
		const { lastFrame } = render(
			<TailViewport maxRows={10}>
				<Text>one</Text>
				<Text>two</Text>
			</TailViewport>,
		)
		await tick()

		expect(lastFrame()).toBe("one\ntwo")
	})

	it("clips tall content to the last maxRows rows right after mount", async () => {
		const lines = Array.from({ length: 10 }, (_, i) => `line ${i}`)
		const { frames, lastFrame } = render(
			<TailViewport maxRows={4}>
				{lines.map((l) => (
					<Text key={l}>{l}</Text>
				))}
			</TailViewport>,
		)
		await tick()

		// The cap cannot reach the very first layout (the yoga node is created
		// in the commit that ink lays out), so at most one frame may exceed it
		// and the correction must follow in the same tick.
		expect(lastFrame()).toBe("line 6\nline 7\nline 8\nline 9")
		expect(frames.length).toBeLessThanOrEqual(2)
	})

	it("shrinks with the content in the same frame (no filler rows above a short tail)", async () => {
		const many = Array.from({ length: 10 }, (_, i) => `line ${i}`)
		const { frames, rerender } = render(
			<TailViewport maxRows={4}>
				{many.map((l) => (
					<Text key={l}>{l}</Text>
				))}
			</TailViewport>,
		)
		await tick()

		const framesBeforeShrink = frames.length
		rerender(
			<TailViewport maxRows={4}>
				<Text>only</Text>
			</TailViewport>,
		)
		await tick()

		// Regression (plan 2026-09-21, tail viewport stale height): the frame
		// written right after the tail collapses used to keep the previous
		// height and bottom-anchor the short content under a block of blank
		// rows. Ink writes that tall blank frame right after the promoted
		// transcript, which scrolls the freshly printed answer off the screen.
		const afterShrink = frames.slice(framesBeforeShrink)
		expect(afterShrink.length).toBeGreaterThan(0)
		for (const frame of afterShrink) {
			expect(frame).toBe("only")
		}
	})

	it("applies a lower maxRows in the same frame", async () => {
		const lines = Array.from({ length: 10 }, (_, i) => `line ${i}`)
		const { frames, lastFrame, rerender } = render(
			<TailViewport maxRows={4}>
				{lines.map((l) => (
					<Text key={l}>{l}</Text>
				))}
			</TailViewport>,
		)
		await tick()

		const framesBefore = frames.length
		rerender(
			<TailViewport maxRows={2}>
				{lines.map((l) => (
					<Text key={l}>{l}</Text>
				))}
			</TailViewport>,
		)
		await tick()

		// A cap decrease (terminal shrink) must not emit a frame taller than
		// the new cap: every frame after the rerender is already clipped.
		for (const frame of frames.slice(framesBefore)) {
			expect(frame).toBe("line 8\nline 9")
		}
		expect(lastFrame()).toBe("line 8\nline 9")
	})
})
