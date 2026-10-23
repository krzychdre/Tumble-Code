import { fixupPluginRules } from "@eslint/compat"
import js from "@eslint/js"
import eslintConfigPrettier from "eslint-config-prettier"
import typescriptEslint from "typescript-eslint"
import pluginReactHooks from "eslint-plugin-react-hooks"
import pluginReact from "eslint-plugin-react"
import globals from "globals"

import { config, deferredEslint10Rules } from "./base.js"

// eslint-plugin-react 7.37.5 (the latest release) still calls
// `context.getFilename()` when it detects the React version, and ESLint 10
// removed that method from the rule context. fixupPluginRules from the ESLint
// team's compat package puts the removed context members back for this plugin
// only. Drop the wrapper once eslint-plugin-react supports ESLint 10.
const pluginReactCompat = fixupPluginRules(pluginReact)

/**
 * @type {import("eslint").Linter.Config[]}
 */
export const reactConfig = [
	...config,
	js.configs.recommended,
	eslintConfigPrettier,
	...typescriptEslint.configs.recommended,
	{
		...pluginReact.configs.flat.recommended,
		plugins: { react: pluginReactCompat },
		languageOptions: {
			...pluginReact.configs.flat.recommended.languageOptions,
			globals: {
				...globals.serviceworker,
			},
		},
	},
	{
		plugins: {
			"react-hooks": pluginReactHooks,
		},
		settings: { react: { version: "detect" } },
		rules: {
			// eslint-plugin-react-hooks 7 adds the React Compiler diagnostics to its
			// recommended preset, so a new violation fails lint. set-state-in-effect
			// still reports findings in webview-ui and stays off until those
			// components are refactored; the compiled-or-not answer stays with
			// scripts/check-react-compiler-bailouts.mjs, which runs the build's own
			// compiler version.
			...pluginReactHooks.configs.recommended.rules,
			...deferredEslint10Rules,
			"react-hooks/set-state-in-effect": "off",
			// React scope no longer necessary with new JSX transform.
			"react/react-in-jsx-scope": "off",
		},
	},
]
