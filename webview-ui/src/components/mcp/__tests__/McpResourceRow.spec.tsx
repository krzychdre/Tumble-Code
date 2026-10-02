import { render, screen } from "@/utils/test-utils"

import McpResourceRow from "../McpResourceRow"

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

describe("McpResourceRow", () => {
	it("translates the fallbacks for a resource without description or MIME type", () => {
		render(<McpResourceRow item={{ uri: "x://y" } as any} />)

		expect(screen.getByText("mcp:resource.noDescription")).toBeInTheDocument()
		expect(screen.getByText("mcp:resource.returns")).toBeInTheDocument()
		expect(screen.getByText("mcp:resource.unknownType")).toBeInTheDocument()
	})

	it("shows the name, description and MIME type when they are present", () => {
		render(
			<McpResourceRow
				item={{ uriTemplate: "w://{city}", name: "Weather", description: "Today", mimeType: "text/plain" }}
			/>,
		)

		expect(screen.getByText("Weather: Today")).toBeInTheDocument()
		expect(screen.getByText("text/plain")).toBeInTheDocument()
	})
})
