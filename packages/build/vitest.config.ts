import path from "path"
import { defineRooVitestConfig } from "@tumble-code/config-vitest"

export default defineRooVitestConfig({
	resolve: {
		alias: {
			// The esbuild configs of src/ and apps/vscode-nightly/ import this package;
			// resolve it to the sources so the tests do not need a prior `tsc` build.
			"@tumble-code/build": path.resolve(__dirname, "src/index.ts"),
		},
	},
})
