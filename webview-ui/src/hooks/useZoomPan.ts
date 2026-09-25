import { useCallback, useState } from "react"
import type React from "react"

export const MIN_ZOOM = 0.5
export const MAX_ZOOM = 20
/** Zoom change per wheel notch and per click of a zoom button. */
export const WHEEL_ZOOM_STEP = 0.2

/**
 * Zoom and drag-to-pan state for a zoomable view (the Mermaid and image
 * modals). The zoom stays within MIN_ZOOM and MAX_ZOOM; the pan offset is
 * kept in unzoomed units, so a mouse movement is divided by the zoom level.
 */
export function useZoomPan() {
	const [zoomLevel, setZoomLevel] = useState(1)
	const [isDragging, setIsDragging] = useState(false)
	const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 })

	const adjustZoom = useCallback((amount: number) => {
		setZoomLevel((prev) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev + amount)))
	}, [])

	const handleWheel = useCallback(
		(e: React.WheelEvent) => {
			e.preventDefault()
			e.stopPropagation()
			// Negative deltaY means scrolling up (zoom in), positive means scrolling down (zoom out).
			adjustZoom(e.deltaY > 0 ? -WHEEL_ZOOM_STEP : WHEEL_ZOOM_STEP)
		},
		[adjustZoom],
	)

	const stopDragging = useCallback(() => setIsDragging(false), [])

	const panLayerProps = {
		style: {
			transform: `scale(${zoomLevel}) translate(${dragPosition.x}px, ${dragPosition.y}px)`,
			transformOrigin: "center center",
			transition: isDragging ? "none" : "transform 0.1s ease",
			cursor: isDragging ? "grabbing" : "grab",
		} satisfies React.CSSProperties,
		onMouseDown: (e: React.MouseEvent) => {
			setIsDragging(true)
			e.preventDefault()
		},
		onMouseMove: (e: React.MouseEvent) => {
			if (isDragging) {
				setDragPosition((prev) => ({
					x: prev.x + e.movementX / zoomLevel,
					y: prev.y + e.movementY / zoomLevel,
				}))
			}
		},
		onMouseUp: stopDragging,
		onMouseLeave: stopDragging,
	}

	return { zoomLevel, adjustZoom, handleWheel, panLayerProps }
}
