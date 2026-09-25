import type React from "react"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { useZoomPan, WHEEL_ZOOM_STEP } from "@src/hooks/useZoomPan"
import { StandardTooltip } from "@/components/ui"

import { Modal } from "./Modal"
import { IconButton } from "./IconButton"
import { ZoomControls } from "./ZoomControls"

export interface ZoomableModalProps {
	isOpen: boolean
	onClose: () => void
	/** Tab buttons shown on the left of the header; the close button is always on the right. */
	tabs: React.ReactNode
	/** Buttons shown in the footer after the zoom controls. */
	footerActions: React.ReactNode
	/**
	 * When false the body shows the children as they are, with no wheel zoom,
	 * pan or zoom controls (the Mermaid code tab). Zoom and pan are kept while
	 * the modal stays open, so switching back restores them.
	 */
	zoomable?: boolean
	children: React.ReactNode
}

/**
 * The full-screen modal behind the Mermaid diagram and image zoom buttons:
 * wheel and button zoom, drag to pan, a zoom badge. Every opening starts at
 * 100% without a pan offset, because the zoom state lives in a component that
 * only exists while the modal is open.
 */
export function ZoomableModal({ isOpen, onClose, ...rest }: ZoomableModalProps) {
	return (
		<Modal isOpen={isOpen} onClose={onClose}>
			<ZoomableModalContent onClose={onClose} {...rest} />
		</Modal>
	)
}

function ZoomableModalContent({
	onClose,
	tabs,
	footerActions,
	zoomable = true,
	children,
}: Omit<ZoomableModalProps, "isOpen">) {
	const { t } = useAppTranslation()
	const { zoomLevel, adjustZoom, handleWheel, panLayerProps } = useZoomPan()

	return (
		<>
			<div className="flex justify-between items-center border-b border-vscode-editorGroup-border">
				<div className="flex gap-0">{tabs}</div>

				<div className="pr-3">
					<StandardTooltip content={t("common:mermaid.buttons.close")}>
						<IconButton icon="close" onClick={onClose} />
					</StandardTooltip>
				</div>
			</div>
			<div
				className="flex-1 p-4 pb-[60px] overflow-auto flex items-center justify-center"
				onWheel={zoomable ? handleWheel : undefined}>
				{zoomable ? (
					<>
						<div {...panLayerProps}>{children}</div>
						<div className="absolute bottom-4 left-4 bg-vscode-editor-background border border-vscode-editorGroup-border rounded px-2 py-1 text-xs text-vscode-descriptionForeground pointer-events-none opacity-80">
							{Math.round(zoomLevel * 100)}%
						</div>
					</>
				) : (
					children
				)}
			</div>
			<div className="absolute bottom-0 right-0 left-0 p-3 flex items-center justify-end gap-2 bg-vscode-editor-background border-t border-vscode-editorGroup-border rounded-b">
				{zoomable && (
					<ZoomControls
						zoomLevel={zoomLevel}
						zoomInTitle={t("common:mermaid.buttons.zoomIn")}
						zoomOutTitle={t("common:mermaid.buttons.zoomOut")}
						useContinuousZoom={true}
						adjustZoom={adjustZoom}
						zoomInStep={WHEEL_ZOOM_STEP}
						zoomOutStep={-WHEEL_ZOOM_STEP}
					/>
				)}
				{footerActions}
			</div>
		</>
	)
}
