/**
 * Source Map Initializer
 *
 * This utility ensures source maps are properly loaded in production builds.
 * It preloads the source map of every script on the page and sets up
 * global error handlers to enhance errors with source maps.
 *
 * This implementation is compatible with VSCode's Content Security Policy.
 */

import { enhanceErrorWithSourceMaps } from "./sourceMapUtils"

/**
 * Initialize source map support for production builds
 */
export function initializeSourceMaps(): void {
	if (process.env.NODE_ENV !== "production") {
		// Only needed in production builds
		return
	}

	console.debug("Initializing CSP-compatible source map support for production build")

	// Set up global error handler
	window.addEventListener("error", async (event) => {
		if (event.error && event.error instanceof Error) {
			try {
				// Apply source maps to the error
				const enhancedError = await enhanceErrorWithSourceMaps(event.error)

				// Log the enhanced error
				console.error("Source mapped error:", enhancedError)

				// Don't prevent default handling - let the ErrorBoundary catch it
			} catch (e) {
				console.error("Error enhancing error with source maps:", e)
			}
		}
	})

	// Set up unhandled promise rejection handler
	window.addEventListener("unhandledrejection", async (event) => {
		if (event.reason && event.reason instanceof Error) {
			try {
				// Apply source maps to the error
				const enhancedError = await enhanceErrorWithSourceMaps(event.reason)

				// Log the enhanced error
				console.error("Source mapped rejection:", enhancedError)
			} catch (e) {
				console.error("Error enhancing rejection with source maps:", e)
			}
		}
	})

	// Preload the source map of every script. The build writes it next to the
	// script as `<name>.js.map` (vite `build.sourcemap`, sourcemapPlugin).
	try {
		const scripts = document.getElementsByTagName("script")
		for (let i = 0; i < scripts.length; i++) {
			const script = scripts[i]
			if (script.src) {
				const link = document.createElement("link")
				link.rel = "preload"
				link.as = "fetch"
				link.href = `${script.src}.map`
				link.crossOrigin = "anonymous"
				document.head.appendChild(link)
			}
		}
	} catch (e) {
		console.error("Error preloading source maps:", e)
	}
}

/**
 * Expose source maps on the window object for debugging
 */
export function exposeSourceMapsForDebugging(): void {
	if (process.env.NODE_ENV !== "production") {
		return
	}

	try {
		// Add a global function to manually apply source maps to an error
		;(window as any).__applySourceMaps = async (error: Error) => {
			if (!(error instanceof Error)) {
				console.error("Not an Error object:", error)
				return error
			}
			return await enhanceErrorWithSourceMaps(error)
		}

		console.debug("Source map debugging utilities exposed on window object")
	} catch (e) {
		console.error("Error exposing source maps for debugging:", e)
	}
}
