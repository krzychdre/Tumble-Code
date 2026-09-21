import { render } from "ink-testing-library"

import UserMessage from "../UserMessage.js"

describe("UserMessage", () => {
	it("renders the pointer and text", () => {
		const { lastFrame } = render(<UserMessage content="Hello world" />)
		const output = lastFrame()

		expect(output).toContain("❯")
		expect(output).toContain("Hello world")
	})

	it("sanitizes tabs to 4 spaces", () => {
		const { lastFrame } = render(<UserMessage content={"code:\n\treturn true;"} />)
		const output = lastFrame()

		expect(output).toContain("    return true;")
		expect(output).not.toContain("\t")
	})

	it("strips carriage returns", () => {
		const { lastFrame } = render(<UserMessage content={"Line 1\r\nLine 2"} />)
		const output = lastFrame()

		expect(output).not.toContain("\r")
		expect(output).toContain("Line 1")
		expect(output).toContain("Line 2")
	})

	it("truncates content >10k chars to head 5k + … [+N chars] … + tail 5k", () => {
		const head = "HEAD".repeat(1250) // 5000 chars
		const middle = "MIDDLE".repeat(1000) // 6000 chars
		const tail = "TAIL".repeat(1250) // 5000 chars
		const total = head + middle + tail // 16000 chars
		const dropped = total.length - 10000 // 6000

		const { lastFrame } = render(<UserMessage content={total} />)
		const output = lastFrame()

		expect(output).toContain("HEAD")
		expect(output).toContain("TAIL")
		expect(output).toContain(`[+${dropped} chars]`)
		// The middle should NOT be fully present
		expect(output).not.toContain("MIDDLEMIDDLE")
	})

	it("does not truncate content <=10k chars", () => {
		const content = "X".repeat(10000)
		const { lastFrame } = render(<UserMessage content={content} />)
		const output = lastFrame()

		// No truncation marker for content at the boundary
		expect(output).not.toContain("[+")
		expect(output).not.toContain("chars]")
	})

	it("truncates at exactly 10001 chars", () => {
		const content = "A".repeat(10001)
		const { lastFrame } = render(<UserMessage content={content} />)
		const output = lastFrame()

		// One char dropped from the middle
		expect(output).toContain("[+1 chars]")
	})
})
