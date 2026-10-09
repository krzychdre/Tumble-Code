import { useEffect, useRef, useState } from "react"
import { useDebounceEffect } from "@src/utils/useDebounceEffect"
import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { useCopyToClipboard } from "@src/utils/clipboard"
import CodeBlock from "./CodeBlock"
import { MermaidButton } from "@/components/common/MermaidButton"
import { buildMermaidConfig, diagramBackground, readVscodeTheme } from "./mermaidTheme"

// Mermaid is imported on first use (see loadMermaid below), so its core stays
// out of the startup bundle; its diagram types were already lazy chunks.

let mermaidLoad: Promise<(typeof import("mermaid"))["default"]> | undefined
let configuredFor: string | undefined

// Imports Mermaid once, the first time a diagram is rendered, and configures it
// for the active VS Code theme. A theme change applies to the next diagram that
// renders; the configuration is only rebuilt when the theme differs.
const loadMermaid = async () => {
	mermaidLoad ??= import("mermaid").then(
		({ default: mermaid }) => mermaid,
		(error) => {
			// Let the next diagram retry instead of caching the failure.
			mermaidLoad = undefined
			throw error
		},
	)

	const mermaid = await mermaidLoad
	const { kind, colors } = readVscodeTheme()
	const key = JSON.stringify([kind, colors])
	if (configuredFor !== key) {
		mermaid.initialize(buildMermaidConfig(kind, colors))
		configuredFor = key
	}
	return mermaid
}

interface MermaidBlockProps {
	code: string
}

export default function MermaidBlock({ code }: MermaidBlockProps) {
	const containerRef = useRef<HTMLDivElement>(null)
	const [isLoading, setIsLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [isErrorExpanded, setIsErrorExpanded] = useState(false)
	const { showCopyFeedback, copyWithFeedback } = useCopyToClipboard()
	const { t } = useAppTranslation()

	// 1) Whenever `code` changes, mark that we need to re-render a new chart
	useEffect(() => {
		setIsLoading(true)
		setError(null)
	}, [code])

	// 2) Debounce the actual parse/render
	useDebounceEffect(
		() => {
			if (containerRef.current) {
				containerRef.current.innerHTML = ""
			}

			loadMermaid()
				.then(async (mermaid) => {
					await mermaid.parse(code)
					const id = `mermaid-${Math.random().toString(36).substring(2)}`
					return mermaid.render(id, code)
				})
				.then(({ svg }) => {
					if (containerRef.current) {
						containerRef.current.innerHTML = svg
					}
				})
				.catch((err) => {
					console.warn("Mermaid parse/render failed:", err)
					setError(err.message || "Failed to render Mermaid diagram")
				})
				.finally(() => {
					setIsLoading(false)
				})
		},
		500, // Delay 500ms
		[code], // Dependencies for scheduling
	)

	/**
	 * Called when user clicks the rendered diagram.
	 * Converts the <svg> to a PNG and sends it to the extension.
	 */
	const handleClick = async () => {
		if (!containerRef.current) return
		const svgEl = containerRef.current.querySelector("svg")
		if (!svgEl) return

		try {
			const pngDataUrl = await svgToPng(svgEl)
			vscode.postMessage({
				type: "openImage",
				text: pngDataUrl,
			})
		} catch (err) {
			console.error("Error converting SVG to PNG:", err)
		}
	}

	// Copy functionality handled directly through the copyWithFeedback utility

	return (
		// The look comes from the `.mermaid-block*` rules in the content-blocks
		// section of index.css.
		<div className="mermaid-block">
			{isLoading && <div className="mermaid-block-loading">{t("common:mermaid.loading")}</div>}

			{error ? (
				<div style={{ marginTop: "0px", overflow: "hidden", marginBottom: "8px" }}>
					<div
						style={{
							borderBottom: isErrorExpanded ? "1px solid var(--frame)" : "none",
							fontWeight: "normal",
							fontSize: "var(--vscode-font-size)",
							color: "var(--vscode-editor-foreground)",
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							cursor: "pointer",
						}}
						onClick={() => setIsErrorExpanded(!isErrorExpanded)}>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: "10px",
								flexGrow: 1,
							}}>
							<span
								className="codicon codicon-warning"
								style={{
									color: "var(--vscode-editorWarning-foreground)",
									opacity: 0.8,
									fontSize: 16,
									marginBottom: "-1.5px",
								}}
								aria-hidden="true"></span>
							<span style={{ fontWeight: "bold" }}>{t("common:mermaid.render_error")}</span>
						</div>
						<div style={{ display: "flex", alignItems: "center" }}>
							<button
								className="mermaid-block-copy"
								aria-label={t("common:mermaid.buttons.copy")}
								onClick={(e) => {
									e.stopPropagation()
									const combinedContent = `Error: ${error}\n\n\`\`\`mermaid\n${code}\n\`\`\``
									copyWithFeedback(combinedContent, e)
								}}>
								<span className={`codicon codicon-${showCopyFeedback ? "check" : "copy"}`}></span>
							</button>
							<span
								className={`codicon codicon-chevron-${isErrorExpanded ? "up" : "down"}`}
								aria-hidden="true"></span>
						</div>
					</div>
					{isErrorExpanded && (
						<div
							style={{
								padding: "8px",
								backgroundColor: "var(--vscode-editor-background)",
								borderTop: "none",
							}}>
							<div style={{ marginBottom: "8px", color: "var(--vscode-descriptionForeground)" }}>
								{error}
							</div>
							<CodeBlock language="mermaid" source={code} />
						</div>
					)}
				</div>
			) : (
				<MermaidButton containerRef={containerRef} code={code} isLoading={isLoading} svgToPng={svgToPng}>
					<div
						className="mermaid-block-diagram"
						data-loading={isLoading ? "true" : "false"}
						onClick={handleClick}
						ref={containerRef}></div>
				</MermaidButton>
			)}
		</div>
	)
}

async function svgToPng(svgEl: SVGElement): Promise<string> {
	// Clone the SVG to avoid modifying the original
	const svgClone = svgEl.cloneNode(true) as SVGElement

	// Get the original viewBox
	const viewBox = svgClone.getAttribute("viewBox")?.split(" ").map(Number) || []
	const originalWidth = viewBox[2] || svgClone.clientWidth
	const originalHeight = viewBox[3] || svgClone.clientHeight

	// Calculate the scale factor to fit editor width while maintaining aspect ratio

	// Unless we can find a way to get the actual editor window dimensions through the VS Code API (which might be possible but would require changes to the extension side),
	// the fixed width seems like a reliable approach.
	const editorWidth = 3_600

	const scale = editorWidth / originalWidth
	const scaledHeight = originalHeight * scale

	// Update SVG dimensions
	svgClone.setAttribute("width", `${editorWidth}`)
	svgClone.setAttribute("height", `${scaledHeight}`)

	const serializer = new XMLSerializer()
	const svgString = serializer.serializeToString(svgClone)

	// Create a data URL directly
	// First, ensure the SVG string is properly encoded
	const encodedSvg = encodeURIComponent(svgString).replace(/'/g, "%27").replace(/"/g, "%22")

	const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodedSvg}`

	return new Promise((resolve, reject) => {
		const img = new Image()

		img.onload = () => {
			const canvas = document.createElement("canvas")
			canvas.width = editorWidth
			canvas.height = scaledHeight

			const ctx = canvas.getContext("2d")
			if (!ctx) return reject("Canvas context not available")

			// Fill with the same background the diagram was drawn on (the editor
			// background of the active theme).
			const { kind, colors } = readVscodeTheme()
			ctx.fillStyle = diagramBackground(kind, colors)
			ctx.fillRect(0, 0, canvas.width, canvas.height)

			ctx.imageSmoothingEnabled = true
			ctx.imageSmoothingQuality = "high"

			ctx.drawImage(img, 0, 0, editorWidth, scaledHeight)
			resolve(canvas.toDataURL("image/png", 1.0))
		}
		img.onerror = reject
		img.src = svgDataUrl
	})
}
