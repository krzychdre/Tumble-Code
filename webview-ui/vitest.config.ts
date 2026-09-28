import path from "path"
import { defineRooVitestConfig, resolveVerbosity } from "@roo-code/config-vitest"

export default defineRooVitestConfig({
	test: {
		...resolveVerbosity(),
		setupFiles: ["./vitest.setup.ts"],
		environment: "jsdom",
		// The convention here is *.spec.*, but *.test.* is collected too (as in
		// src/): three *.test.ts files once sat here for months without ever
		// running, and one of them had a wrong expectation nobody saw.
		include: ["src/**/*.{spec,test}.{ts,tsx}"],
	},
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
			"@src": path.resolve(__dirname, "./src"),
			"@roo": path.resolve(__dirname, "../src/shared"),
			// Mock the vscode module for tests since it's not available outside
			// VS Code extension context.
			vscode: path.resolve(__dirname, "./src/__mocks__/vscode.ts"),
		},
	},
})
