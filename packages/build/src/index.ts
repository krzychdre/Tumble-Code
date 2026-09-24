export { getGitSha } from "./git.js"
export { copyPaths, copyWasms, copyLocales, setupLocaleWatcher, generatePackageJson } from "./esbuild.js"
export {
	extensionAliases,
	extensionExternals,
	createBuildOptions,
	createExtensionBuildOptions,
	isRunAsScript,
} from "./extension.js"
