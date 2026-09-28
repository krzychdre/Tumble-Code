import { defineRooVitestConfig } from "@roo-code/config-vitest"

export default defineRooVitestConfig({
	resolve: {
		alias: {
			vscode: new URL("./src/__mocks__/vscode.ts", import.meta.url).pathname,
		},
	},
})
