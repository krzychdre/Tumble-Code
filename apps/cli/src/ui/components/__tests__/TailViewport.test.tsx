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

	it("clips tall content to the last maxRows rows", async () => {
		const lines = Array.from({ length: 10 }, (_, i) => `line ${i}`)
		const { lastFrame, rerender } = render(
			<TailViewport maxRows={4}>
				{lines.map((l) => (
					<Text key={l}>{l}</Text>
				))}
			</TailViewport>,
		)
		await tick()
		// Re-render so the measured height from the effect is applied.
		rerender(
			<TailViewport maxRows={4}>
				{lines.map((l) => (
					<Text key={l}>{l}</Text>
				))}
			</TailViewport>,
		)
		await tick()

		expect(lastFrame()).toBe("line 6\nline 7\nline 8\nline 9")
	})

	it("grows back when content shrinks", async () => {
		const many = Array.from({ length: 10 }, (_, i) => `line ${i}`)
		const { lastFrame, rerender } = render(
			<TailViewport maxRows={4}>
				{many.map((l) => (
					<Text key={l}>{l}</Text>
				))}
			</TailViewport>,
		)
		await tick()

		rerender(
			<TailViewport maxRows={4}>
				<Text>only</Text>
			</TailViewport>,
		)
		await tick()
		rerender(
			<TailViewport maxRows={4}>
				<Text>only</Text>
			</TailViewport>,
		)
		await tick()

		expect(lastFrame()).toBe("only")
	})
})
