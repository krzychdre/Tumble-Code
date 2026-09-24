import { config } from "@roo-code/config-eslint/base"

/** @type {import("eslint").Linter.Config} */
export default [
	...config,
	{
		rules: {
			// TODO: The rules listed below should be re-enabled once their existing violations are fixed.
			"no-useless-escape": "off",
			"no-empty": "off",
			"prefer-const": "off",

			"@typescript-eslint/no-unused-vars": "off",
			"@typescript-eslint/no-explicit-any": "off",
			"@typescript-eslint/no-require-imports": "off",
			"@typescript-eslint/ban-ts-comment": "off",
		},
	},
	{
		files: ["core/assistant-message/presentAssistantMessage.ts", "core/webview/webviewMessageHandler.ts"],
		rules: {
			"no-case-declarations": "off",
		},
	},
	{
		// PKG-2: src/shared is bundled into the webview through the `@roo/*` alias
		// (webview-ui/tsconfig.json, vite.config.ts), where `vscode` does not exist.
		// The TEST-8 bundle guard is the runtime backstop.
		files: ["shared/**/*.ts"],
		ignores: [
			// Specs run in the extension test environment and never reach the bundle.
			"shared/**/__tests__/**",
			// Extension-only, never imported by the webview; SVC-16 / PKG-6 move them
			// out of src/shared.
			"shared/cloud-urls.ts",
			"shared/vsCodeSelectorUtils.ts",
		],
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
