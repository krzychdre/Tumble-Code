import { lazy, type ComponentType } from "react"

import { StaleBuildNotice } from "@src/components/common/StaleBuildNotice"

/**
 * True for the error a browser raises when a dynamic import cannot fetch its
 * module (Chromium, Firefox and Safari wordings).
 */
export const isChunkLoadError = (error: unknown): boolean =>
	error instanceof Error &&
	/Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(
		error.message,
	)

/**
 * React.lazy for a tab chunk. A chunk that cannot be fetched means the
 * extension files changed under a running window, so the tab renders
 * {@link StaleBuildNotice} (with a reload button) instead of crashing the
 * whole view into the error boundary. Any other import error is rethrown.
 */
export function lazyTab<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
	return lazy(() =>
		load().catch((error: unknown) => {
			if (!isChunkLoadError(error)) {
				throw error
			}
			// The notice ignores the tab's props.
			return { default: StaleBuildNotice as unknown as T }
		}),
	)
}
