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
			// recommended preset. The ones the webview already passes stay on
			// (static-components, use-memo, incompatible-library, error-boundaries,
			// set-state-in-render, unsupported-syntax, config, gating), so a new
			// violation fails lint. The six below still report findings on
			// origin/main (counts from `eslint src` in webview-ui, 2026-09-26) and
			// are off until those components are refactored one at a time; the
			// compiled-or-not answer stays with
			// scripts/check-react-compiler-bailouts.mjs, which runs the build's own
			// compiler version.
			...pluginReactHooks.configs.recommended.rules,
			...deferredEslint10Rules,
			"react-hooks/set-state-in-effect": "off", // 45 findings in 35 files
			"react-hooks/refs": "off", // 7 findings in 3 files
			"react-hooks/immutability": "off", // 3 findings in 2 files
			"react-hooks/preserve-manual-memoization": "off", // 3 findings in 2 files
			"react-hooks/purity": "off", // 2 findings in 1 file (Date.now() during render)
			"react-hooks/globals": "off", // 1 finding, in a spec file
			// React scope no longer necessary with new JSX transform.
			"react/react-in-jsx-scope": "off",
		},
	},
]
