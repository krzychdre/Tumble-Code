import { config } from "@roo-code/config-eslint/base"

/** @type {import("eslint").Linter.Config} */
export default [
	...config,
	{
		rules: {
			// TODO: Re-enable these once the existing violations are fixed. See
			// ai_plans/2026-09-26_re-enable-eslint-rules.md for the measured
			// violation counts and scope decision.
			"@typescript-eslint/no-unused-vars": "off",
			"@typescript-eslint/no-explicit-any": "off",
			"@typescript-eslint/no-require-imports": "off",
		},
	},
	{
		// PKG-2 / SVC-16: src/shared is bundled into the webview through the
		// `@roo/*` alias (webview-ui/tsconfig.json, vite.config.ts), where `vscode`
		// and Node APIs do not exist. So no file in it may import vscode or the
		// extension-only directories (the list mirrors webview-ui's
		// bundleBoundaryPlugin, the build-time backstop). Keep extension-only
		// helpers next to their callers instead, e.g. core/prompts/modeDetails.ts.
		files: ["shared/**/*.ts"],
		// Specs run in the extension test environment and never reach the bundle.
		ignores: ["shared/**/__tests__/**"],
		rules: {
			"no-restricted-imports": [
				"error",
				{
					paths: [
						{
							name: "vscode",
							message:
								"src/shared is bundled into the webview, where the vscode module does not exist. Keep vscode-bound code outside src/shared.",
						},
					],
					patterns: [
						{
							regex: "^\\.\\./(activate|api|core|extension|i18n|integrations|services|utils|workers)(/|$)",
							message:
								"src/shared is bundled into the webview and must not import extension code. Move the extension-only function next to its callers instead.",
						},
					],
				},
			],
		},
	},
	{
		files: ["__mocks__/**/*.js"],
		rules: {
			"no-undef": "off",
		},
	},
	{
		ignores: ["webview-ui", "out"],
	},
]
