/**
 * Load the React packages the TUI renders with in their production builds,
 * whatever NODE_ENV the user's shell exports.
 *
 * `react`, `react/jsx-runtime`, `react-reconciler` and `scheduler` each pick a
 * development or a production build once, when they are first loaded, from
 * `process.env.NODE_ENV`. Nothing set it for the CLI, so it ran the
 * development builds, and the development reconciler of React 19.2+ reports
 * every commit to the DevTools performance track through
 * `performance.measure()`, with a diff of the props that changed. Node keeps
 * every measure for the life of the process. A streaming message is such a
 * prop, so every render stored the message's whole text as JSON, both before
 * and after the change, and a long session ran out of heap (4 GB, 26 minutes
 * into a GLM task with long reasoning blocks).
 *
 * NODE_ENV is set only while the packages load: commands the agent runs
 * inherit this process's environment, and NODE_ENV=production changes what
 * they do (`npm install` skips devDependencies). The production builds never
 * read it again.
 *
 * The packages are loaded with `import()` rather than `require()` so the
 * release bundle (tsup bundles React and ink, see BUNDLED_DEPENDENCIES) runs
 * its own bundled copies here; there is no node_modules copy to require.
 * Loading ink is what loads `react-reconciler` and `scheduler`, resolved the
 * way ink resolves them.
 *
 * Must run before anything imports React, which is why `index.ts` loads the
 * rest of the CLI with a dynamic import after awaiting this.
 */
export async function loadReactProductionBuilds(): Promise<void> {
	const inherited = process.env.NODE_ENV
	process.env.NODE_ENV = "production"

	try {
		await import("react")
		await import("react/jsx-runtime")
		await import("ink")
	} finally {
		if (inherited === undefined) {
			delete process.env.NODE_ENV
		} else {
			process.env.NODE_ENV = inherited
		}
	}
}
