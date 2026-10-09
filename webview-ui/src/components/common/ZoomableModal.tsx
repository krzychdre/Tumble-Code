import type React from "react"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { useZoomPan, WHEEL_ZOOM_STEP } from "@src/hooks/useZoomPan"
import { Dialog, DialogContent, DialogTitle, IconButton, StandardTooltip } from "@/components/ui"

import { ZoomControls } from "./ZoomControls"

export interface ZoomableModalProps {
	isOpen: boolean
	onClose: () => void
	/** Accessible name of the dialog, read by screen readers only. */
	title: string
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
export function ZoomableModal({ isOpen, onClose, title, ...rest }: ZoomableModalProps) {
	return (
		<Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
			<DialogContent
				className="w-[90%] h-[90%] max-w-[1200px] sm:max-w-[1200px] flex flex-col gap-0 p-0 border-frame-hover rounded-floating shadow-[0_8px_28px_var(--vscode-widget-shadow)]"
				showCloseButton={false}
				aria-describedby={undefined}>
				<DialogTitle className="sr-only">{title}</DialogTitle>
				<ZoomableModalContent onClose={onClose} {...rest} />
			</DialogContent>
		</Dialog>
	)
}

function ZoomableModalContent({
	onClose,
	tabs,
	footerActions,
	zoomable = true,
	children,
}: Omit<ZoomableModalProps, "isOpen" | "title">) {
	const { t } = useAppTranslation()
	const { zoomLevel, adjustZoom, wheelAreaRef, panLayerProps } = useZoomPan()

	return (
		<>
			<div className="flex justify-between items-center border-b border-frame">
				<div className="flex gap-0">{tabs}</div>

				<div className="pr-3">
					<StandardTooltip content={t("common:mermaid.buttons.close")}>
						<IconButton
							aria-label={t("common:mermaid.buttons.close")}
							variant="toolbar"
							icon="close"
							onClick={onClose}
						/>
					</StandardTooltip>
				</div>
			</div>
			<div
				className="flex-1 p-4 pb-[60px] overflow-auto flex items-center justify-center"
				ref={zoomable ? wheelAreaRef : undefined}>
				{zoomable ? (
					<>
						<div {...panLayerProps}>{children}</div>
						<div className="absolute bottom-4 left-4 bg-vscode-editor-background border border-frame rounded-control px-2 py-1 text-xs text-vscode-descriptionForeground pointer-events-none">
							{Math.round(zoomLevel * 100)}%
						</div>
					</>
				) : (
					children
				)}
			</div>
			<div className="absolute bottom-0 right-0 left-0 p-3 flex items-center justify-end gap-2 bg-vscode-editor-background border-t border-frame">
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
