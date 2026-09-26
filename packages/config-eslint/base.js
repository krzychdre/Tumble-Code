import js from "@eslint/js"
import eslintConfigPrettier from "eslint-config-prettier"
import turboPlugin from "eslint-plugin-turbo"
import tseslint from "typescript-eslint"
import onlyWarn from "eslint-plugin-only-warn"

import { boundariesPlugin } from "./boundaries.js"

/**
 * ESLint 10 added these three rules to eslint:recommended. On origin/main
 * (2026-09-26) they report code that works today, and the fixes are not
 * mechanical: attaching `cause` changes what callers log and serialize, and
 * several dead stores sit in task, condense and diff logic that deserves its
 * own reviewed change. They stay off; re-enable one at a time together with
 * the fixes. react.js applies them again after its own copy of
 * eslint:recommended.
 */
export const deferredEslint10Rules = {
	// 48 findings: extension (src) 40, cloud 4, cli 2, core 1, agent-interchange 1.
	"preserve-caught-error": "off",
	// 39 findings: extension (src) 31, core 4, webview 2, cli 1, vscode-shim 1.
	"no-useless-assignment": "off",
}

/**
 * A shared ESLint configuration for the repository.
 *
 * @type {import("eslint").Linter.Config[]}
 * */
export const config = [
	js.configs.recommended,
	eslintConfigPrettier,
	...tseslint.configs.recommended,
	{
		plugins: {
			turbo: turboPlugin,
		},
		rules: {
			"turbo/no-undeclared-env-vars": "off",
		},
	},
	{
		plugins: {
			onlyWarn,
		},
	},
	{
		ignores: ["dist/**"],
	},
	{
		// PKG-2: a relative import must not leave its workspace; see boundaries.js.
		plugins: {
			boundaries: boundariesPlugin,
		},
		rules: {
			"boundaries/no-relative-import-outside-package": "error",
		},
	},
	{
		rules: deferredEslint10Rules,
	},
	{
		rules: {
			"@typescript-eslint/no-unused-vars": [
				"error",
				{
					argsIgnorePattern: "^_",
					varsIgnorePattern: "^_",
					caughtErrorsIgnorePattern: "^_",
				},
			],
		},
	},
]
