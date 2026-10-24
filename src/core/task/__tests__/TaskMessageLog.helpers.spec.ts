// npx vitest run core/task/__tests__/TaskMessageLog.helpers.spec.ts

import type { Anthropic } from "@anthropic-ai/sdk"

import { withoutEnvironmentDetails } from "../TaskMessageLog.helpers"

const text = (value: string): Anthropic.Messages.TextBlockParam => ({ type: "text", text: value })

describe("withoutEnvironmentDetails", () => {
	it("drops whole environment_details blocks, padded or not, and keeps everything else in order", () => {
		const kept = [
			text("Some user message"),
			text("Let me explain how <environment_details> work"),
			text("The closing tag is </environment_details>"),
			text("<environment_details> is the tag the extension adds"),
			{ type: "tool_result", tool_use_id: "tool_1", content: "<environment_details>x</environment_details>" },
		] as Anthropic.Messages.ContentBlockParam[]

		expect(
			withoutEnvironmentDetails([
				kept[0],
				text("<environment_details>\n# Old\n</environment_details>"),
				kept[1],
				text("  \n<environment_details>stale</environment_details>\n"),
				kept[2],
				kept[3],
				kept[4],
			]),
		).toEqual(kept)
	})
})
