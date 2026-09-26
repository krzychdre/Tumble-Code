import fs from "fs"
import path from "path"
import axios from "axios"
import type * as vscode from "vscode"

import { getNonce } from "./getNonce"
import { getUri } from "./getUri"

const DEFAULT_VITE_PORT = "5173"
const DEFAULT_OPENROUTER_ORIGIN = "https://openrouter.ai"

/**
 * What differs between the webviews that load the React app (the sidebar in
 * ClineProvider and the plan review panel). Everything else, the document,
 * the asset URIs and the Content Security Policy, is shared (CORE-R6 e).
 */
export interface WebviewHtmlOptions {
	webview: vscode.Webview
	/** The URI of the directory containing the extension. */
	extensionUri: vscode.Uri
	/** The document title. */
	title: string
	/** Sets `window.PLAN_REVIEW_MODE = true` in the boot script. */
	planReviewMode?: boolean
	/** Extra `connect-src` origins, right after the webview's own source (the sidebar allows OpenRouter). */
	connectOrigins?: string[]
	/** Extra `script-src` and `connect-src` origins in development mode only (the sidebar allows PostHog). */
	hmrAnalyticsOrigins?: string[]
}

export interface HmrHtmlOptions extends WebviewHtmlOptions {
	/** Called when the Vite dev server does not answer; the production HTML is returned instead. */
	onDevServerMissing?: () => void
	/** When set, the port-file lookup is logged to the console under this tag. */
	logTag?: string
}

/** The scheme and host of the configured OpenRouter base URL, for the CSP. */
export function openRouterOrigin(baseUrl: string | undefined): string {
	const openRouterBaseUrl = baseUrl || DEFAULT_OPENROUTER_ORIGIN
	return openRouterBaseUrl.match(/^(https?:\/\/[^/]+)/)?.[1] || DEFAULT_OPENROUTER_ORIGIN
}

function assetUris(webview: vscode.Webview, extensionUri: vscode.Uri) {
	return {
		stylesUri: getUri(webview, extensionUri, ["webview-ui", "build", "assets", "index.css"]),
		codiconsUri: getUri(webview, extensionUri, ["assets", "codicons", "codicon.css"]),
		materialIconsUri: getUri(webview, extensionUri, ["assets", "vscode-material-icons", "icons"]),
		imagesUri: getUri(webview, extensionUri, ["assets", "images"]),
		audioUri: getUri(webview, extensionUri, ["webview-ui", "audio"]),
	}
}

/**
 * The HTML that loads the built React app.
 *
 * The CSP allows only scripts that carry the per-document nonce (a value used
 * once and impossible to guess). `'unsafe-inline'` styles are needed for the
 * webview toolkit's dynamic style injection, `data:` images for the base64
 * images the extension posts, and `'wasm-unsafe-eval'` for Shiki's syntax
 * highlighting.
 */
export function getProductionHtml(options: WebviewHtmlOptions): string {
	const { webview, extensionUri, title, planReviewMode, connectOrigins = [] } = options
	const { stylesUri, codiconsUri, materialIconsUri, imagesUri, audioUri } = assetUris(webview, extensionUri)
	const scriptUri = getUri(webview, extensionUri, ["webview-ui", "build", "assets", "index.js"])
	const nonce = getNonce()
	const csp = webview.cspSource
	const connectSrc = [csp, ...connectOrigins, "https://api.requesty.ai"].join(" ")
	const planReviewFlag = planReviewMode ? "\n\t\t\t\t\twindow.PLAN_REVIEW_MODE = true" : ""

	// Tip: Install the es6-string-html VS Code extension to enable code highlighting below
	return /*html*/ `
		<!DOCTYPE html>
		<html lang="en">
			<head>
				<meta charset="utf-8">
				<meta name="viewport" content="width=device-width,initial-scale=1,shrink-to-fit=no">
				<meta name="theme-color" content="#000000">
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${csp} data:; style-src ${csp} 'unsafe-inline'; img-src ${csp} https://storage.googleapis.com https://img.clerk.com data:; media-src ${csp}; script-src ${csp} 'wasm-unsafe-eval' 'nonce-${nonce}' 'strict-dynamic'; connect-src ${connectSrc};">
				<link rel="stylesheet" type="text/css" href="${stylesUri}">
				<link href="${codiconsUri}" rel="stylesheet" />
				<script nonce="${nonce}">
					window.IMAGES_BASE_URI = "${imagesUri}"
					window.AUDIO_BASE_URI = "${audioUri}"
					window.MATERIAL_ICONS_BASE_URI = "${materialIconsUri}"${planReviewFlag}
				</script>
				<title>${title}</title>
			</head>
			<body>
				<noscript>You need to enable JavaScript to run this app.</noscript>
				<div id="root"></div>
				<script nonce="${nonce}" type="module" src="${scriptUri}"></script>
			</body>
		</html>
		`
}

/** The Vite dev server port: the `.vite-port` file written by the dev script, else 5173. */
function readVitePort(logTag: string | undefined): string {
	let localPort = DEFAULT_VITE_PORT

	try {
		const portFilePath = path.resolve(__dirname, "../../.vite-port")

		if (fs.existsSync(portFilePath)) {
			localPort = fs.readFileSync(portFilePath, "utf8").trim()
			if (logTag) {
				console.log(`[${logTag}] Using Vite server port from ${portFilePath}: ${localPort}`)
			}
		} else if (logTag) {
			console.log(`[${logTag}] Port file not found at ${portFilePath}, using default port: ${localPort}`)
		}
	} catch (err) {
		if (logTag) {
			console.error(`[${logTag}] Failed to read Vite port file:`, err)
		}
	}

	return localPort
}

/**
 * The HTML that loads the React app from the Vite dev server with hot module
 * replacement (HMR). Falls back to {@link getProductionHtml} when the dev
 * server does not answer.
 */
export async function getHmrHtml(options: HmrHtmlOptions): Promise<string> {
	const { webview, extensionUri, title, planReviewMode, connectOrigins = [], hmrAnalyticsOrigins = [] } = options
	const localPort = readVitePort(options.logTag)
	const localServerUrl = `localhost:${localPort}`

	// Check if local dev server is running.
	try {
		await axios.get(`http://${localServerUrl}`)
	} catch {
		options.onDevServerMissing?.()
		return getProductionHtml(options)
	}

	const nonce = getNonce()
	const { stylesUri, codiconsUri, materialIconsUri, imagesUri, audioUri } = assetUris(webview, extensionUri)

	const file = "src/index.tsx"
	const scriptUri = `http://${localServerUrl}/${file}`

	const reactRefresh = /*html*/ `
			<script nonce="${nonce}" type="module">
				import RefreshRuntime from "http://localhost:${localPort}/@react-refresh"
				RefreshRuntime.injectIntoGlobalHook(window)
				window.$RefreshReg$ = () => {}
				window.$RefreshSig$ = () => (type) => type
				window.__vite_plugin_react_preamble_installed__ = true
			</script>
		`

	const devServer = [`http://${localServerUrl}`, `http://0.0.0.0:${localPort}`]
	const csp = [
		"default-src 'none'",
		`font-src ${webview.cspSource} data:`,
		["style-src", webview.cspSource, "'unsafe-inline'", "https://*", ...devServer].join(" "),
		`img-src ${webview.cspSource} https://storage.googleapis.com https://img.clerk.com data:`,
		`media-src ${webview.cspSource}`,
		[
			"script-src 'unsafe-eval'",
			webview.cspSource,
			"https://*",
			...hmrAnalyticsOrigins,
			...devServer,
			`'nonce-${nonce}'`,
		].join(" "),
		[
			"connect-src",
			webview.cspSource,
			...connectOrigins,
			"https://*",
			...hmrAnalyticsOrigins,
			`ws://${localServerUrl}`,
			`ws://0.0.0.0:${localPort}`,
			...devServer,
		].join(" "),
	]
	const planReviewFlag = planReviewMode ? "\n\t\t\t\t\t\twindow.PLAN_REVIEW_MODE = true" : ""

	return /*html*/ `
			<!DOCTYPE html>
			<html lang="en">
				<head>
					<meta charset="utf-8">
					<meta name="viewport" content="width=device-width,initial-scale=1,shrink-to-fit=no">
					<meta http-equiv="Content-Security-Policy" content="${csp.join("; ")}">
					<link rel="stylesheet" type="text/css" href="${stylesUri}">
					<link href="${codiconsUri}" rel="stylesheet" />
					<script nonce="${nonce}">
						window.IMAGES_BASE_URI = "${imagesUri}"
						window.AUDIO_BASE_URI = "${audioUri}"
						window.MATERIAL_ICONS_BASE_URI = "${materialIconsUri}"${planReviewFlag}
					</script>
					<title>${title}</title>
				</head>
				<body>
					<div id="root"></div>
					${reactRefresh}
					<script type="module" src="${scriptUri}"></script>
				</body>
			</html>
		`
}
