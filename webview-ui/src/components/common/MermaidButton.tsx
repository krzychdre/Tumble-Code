import { useState } from "react"
import { useCopyToClipboard } from "@src/utils/clipboard"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { vscode } from "@src/utils/vscode"
import { MermaidActionButtons } from "./MermaidActionButtons"
import { ZoomableModal } from "./ZoomableModal"
import { TabButton } from "./TabButton"
import { IconButton } from "./IconButton"
import { StandardTooltip } from "@/components/ui"

export interface MermaidButtonProps {
	containerRef: React.RefObject<HTMLDivElement>
	code: string
	isLoading: boolean
	svgToPng: (svgEl: SVGElement) => Promise<string>
	children: React.ReactNode
}

export function MermaidButton({ containerRef, code, isLoading, svgToPng, children }: MermaidButtonProps) {
	const [showModal, setShowModal] = useState(false)
	const [copyFeedback, setCopyFeedback] = useState(false)
	const [isHovering, setIsHovering] = useState(false)
	const [modalViewMode, setModalViewMode] = useState<"diagram" | "code">("diagram")
	const { copyWithFeedback } = useCopyToClipboard()
	const { t } = useAppTranslation()

	/**
	 * Opens a modal with the diagram for zooming
	 */
	const handleZoom = async (e: React.MouseEvent) => {
		e.stopPropagation()
		setShowModal(true)
		setModalViewMode("diagram")
	}

	/**
	 * Copies the diagram text to clipboard
	 */
	const handleCopy = async (e: React.MouseEvent) => {
		e.stopPropagation()

		try {
			await copyWithFeedback(code, e)

			// Show feedback
			setCopyFeedback(true)
			setTimeout(() => setCopyFeedback(false), 2000)
		} catch (err) {
			console.error("Error copying text:", err instanceof Error ? err.message : String(err))
		}
	}

	/**
	 * Saves the diagram as an image file
	 */
	const handleSave = async (e: React.MouseEvent) => {
		e.stopPropagation()

		// Get the SVG element from the container
		const svgEl = containerRef.current?.querySelector("svg")
		if (!svgEl) {
			console.error("SVG element not found")
			return
		}

		try {
			// Convert SVG to PNG
			const pngDataUrl = await svgToPng(svgEl)

			// Send message to VSCode to save the image
			vscode.postMessage({
				type: "saveImage",
				dataUri: pngDataUrl,
			})
		} catch (error) {
			console.error("Error saving image:", error)
		}
	}

	/**
	 * Handle mouse enter event for diagram container
	 */
	const handleMouseEnter = () => {
		setIsHovering(true)
	}

	/**
	 * Handle mouse leave event for diagram container
	 */
	const handleMouseLeave = () => {
		setIsHovering(false)
	}

	return (
		<>
			<div className="relative w-full" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
				{children}
				{!isLoading && isHovering && (
					<div className="absolute bottom-2 right-2 flex gap-1 bg-vscode-editor-background/90 rounded p-0.5 z-10 opacity-100 transition-opacity duration-200 ease-in-out">
						<MermaidActionButtons
							onZoom={handleZoom}
							onCopy={handleCopy}
							onSave={handleSave}
							onViewCode={() => {
								setShowModal(true)
								setModalViewMode("code")
							}}
							copyFeedback={copyFeedback}
						/>
					</div>
				)}
			</div>

			<ZoomableModal
				isOpen={showModal}
				onClose={() => setShowModal(false)}
				zoomable={modalViewMode === "diagram"}
				tabs={
					<>
						<TabButton
							icon="graph"
							label={t("common:mermaid.tabs.diagram")}
							isActive={modalViewMode === "diagram"}
							onClick={() => setModalViewMode("diagram")}
						/>
						<TabButton
							icon="code"
							label={t("common:mermaid.tabs.code")}
							isActive={modalViewMode === "code"}
							onClick={() => setModalViewMode("code")}
						/>
					</>
				}
				footerActions={
					modalViewMode === "diagram" ? (
						<>
							<StandardTooltip content={t("common:mermaid.buttons.copy")}>
								<IconButton icon={copyFeedback ? "check" : "copy"} onClick={handleCopy} />
							</StandardTooltip>
							<StandardTooltip content={t("common:mermaid.buttons.save")}>
								<IconButton icon="save" onClick={handleSave} />
							</StandardTooltip>
						</>
					) : (
						<StandardTooltip content={t("common:mermaid.buttons.copy")}>
							<IconButton icon={copyFeedback ? "check" : "copy"} onClick={handleCopy} />
						</StandardTooltip>
					)
				}>
				{modalViewMode === "diagram" ? (
					containerRef.current &&
					containerRef.current.innerHTML && (
						<div dangerouslySetInnerHTML={{ __html: containerRef.current.innerHTML }} />
					)
				) : (
					<textarea
						className="w-full min-h-[200px] bg-vscode-editor-background text-vscode-editor-foreground border border-vscode-editorGroup-border rounded-[3px] p-2 font-mono resize-y outline-none"
						readOnly
						value={code}
						style={{ height: "100%", minHeight: "unset", fontSize: "var(--vscode-editor-font-size)" }}
					/>
				)}
			</ZoomableModal>
		</>
	)
}
