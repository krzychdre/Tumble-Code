import { parseFrontmatter } from "../frontmatter"

describe("parseFrontmatter", () => {
	it("parses a valid memory frontmatter block", () => {
		const content = `---
name: Testing policy
description: Integration tests must hit a real DB
type: feedback
---

Body line one.
Body line two.`
		const result = parseFrontmatter(content, "/mem/feedback.md")
		expect(result.hasFrontmatter).toBe(true)
		expect(result.data.name).toBe("Testing policy")
		expect(result.data.description).toBe("Integration tests must hit a real DB")
		expect(result.data.type).toBe("feedback")
		expect(result.body.trim()).toBe("Body line one.\nBody line two.")
	})

	it("returns hasFrontmatter=false and body=content when no fence", () => {
		const content = "no frontmatter here"
		const result = parseFrontmatter(content)
		expect(result.hasFrontmatter).toBe(false)
		expect(result.data).toEqual({})
		expect(result.body).toBe(content)
	})

	it("handles empty input", () => {
		const result = parseFrontmatter("")
		expect(result.hasFrontmatter).toBe(false)
		expect(result.data).toEqual({})
	})

	it("handles a value containing colon-space (e.g. a ratio)", () => {
		const content = `---
description: ratio of a: b is 2:1
type: reference
---

body`
		const result = parseFrontmatter(content)
		// Only the first colon splits key/value; the rest stays in the value.
		expect(result.data.description).toBe("ratio of a: b is 2:1")
		expect(result.data.type).toBe("reference")
	})

	it("strips surrounding quotes from values", () => {
		const content = `---
description: "quoted value"
type: 'feedback'
---

body`
		const result = parseFrontmatter(content)
		expect(result.data.description).toBe("quoted value")
		expect(result.data.type).toBe("feedback")
	})

	it("skips blank lines and comments", () => {
		const content = `---
# a comment

name: foo
type: user
---

body`
		const result = parseFrontmatter(content)
		expect(result.data.name).toBe("foo")
		expect(result.data.type).toBe("user")
	})

	it("last definition wins on duplicate keys", () => {
		const content = `---
type: user
type: feedback
---

body`
		const result = parseFrontmatter(content)
		expect(result.data.type).toBe("feedback")
	})

	it("treats a fence with no keys as frontmatter with empty data", () => {
		const content = `---

---

body`
		const result = parseFrontmatter(content)
		expect(result.hasFrontmatter).toBe(true)
		expect(result.data).toEqual({})
		expect(result.body).toBe("body")
	})
})
