import type { McpResourceTemplate } from "@tumble-code/types"

import { findMatchingTemplate } from "../mcp"

const template = (uriTemplate: string) => ({ uriTemplate, name: uriTemplate }) as McpResourceTemplate

describe("findMatchingTemplate", () => {
	it("matches a {param} segment and treats the rest of the template literally", () => {
		const templates = [template("file:///logs/{name}.txt")]

		expect(findMatchingTemplate("file:///logs/app.txt", templates)).toBe(templates[0])
		// "." is literal, not "any character"; a parameter never spans a slash.
		expect(findMatchingTemplate("file:///logs/appxtxt", templates)).toBeUndefined()
		expect(findMatchingTemplate("file:///logs/a/b.txt", templates)).toBeUndefined()
	})

	it("escapes other regex metacharacters in the template", () => {
		const templates = [template("db://q?id=(1)+[x]")]

		expect(findMatchingTemplate("db://q?id=(1)+[x]", templates)).toBe(templates[0])
		expect(findMatchingTemplate("db://qid=1x", templates)).toBeUndefined()
	})
})
