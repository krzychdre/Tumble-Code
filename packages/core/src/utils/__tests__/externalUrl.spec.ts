import { isOpenableExternalUrl } from "../externalUrl.js"

describe("isOpenableExternalUrl", () => {
	it.each([
		"https://example.com/a?b=c",
		"http://localhost:3000/",
		"mailto:someone@example.com",
		"HTTPS://EXAMPLE.COM",
	])("opens %s", (url) => {
		expect(isOpenableExternalUrl(url)).toBe(true)
	})

	it.each([
		"command:workbench.action.terminal.new",
		"file:///etc/passwd",
		"javascript:alert(1)",
		"vscode://some.extension/handle?x=1",
		"ms-msdt:/id PCWDiagnostic",
		"//example.com/no-scheme",
		"example.com",
		"https://example.com/\r\nInjected: header",
		"",
	])("refuses %j", (url) => {
		expect(isOpenableExternalUrl(url)).toBe(false)
	})
})
