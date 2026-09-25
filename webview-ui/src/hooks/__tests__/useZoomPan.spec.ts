// cd webview-ui && ./node_modules/.bin/vitest run src/hooks/__tests__/useZoomPan.spec.ts

import type React from "react"
import { act, renderHook } from "@testing-library/react"

import { MAX_ZOOM, MIN_ZOOM, useZoomPan, WHEEL_ZOOM_STEP } from "../useZoomPan"

const mouse = (movementX = 0, movementY = 0) =>
	({ movementX, movementY, preventDefault: vi.fn() }) as unknown as React.MouseEvent

const wheel = (deltaY: number) =>
	({ deltaY, preventDefault: vi.fn(), stopPropagation: vi.fn() }) as unknown as React.WheelEvent

describe("useZoomPan", () => {
	it("keeps the limits and the step of the two modals it replaces", () => {
		expect(MIN_ZOOM).toBe(0.5)
		expect(MAX_ZOOM).toBe(20)
		expect(WHEEL_ZOOM_STEP).toBe(0.2)
	})

	it("starts at 100% without a pan offset", () => {
		const { result } = renderHook(() => useZoomPan())
		expect(result.current.zoomLevel).toBe(1)
		expect(result.current.panLayerProps.style.transform).toBe("scale(1) translate(0px, 0px)")
		expect(result.current.panLayerProps.style.cursor).toBe("grab")
	})

	it("clamps adjustZoom to the limits", () => {
		const { result } = renderHook(() => useZoomPan())
		act(() => result.current.adjustZoom(-5))
		expect(result.current.zoomLevel).toBe(MIN_ZOOM)
		act(() => result.current.adjustZoom(100))
		expect(result.current.zoomLevel).toBe(MAX_ZOOM)
	})

	it("zooms in on wheel up and out on wheel down, and swallows the event", () => {
		const { result } = renderHook(() => useZoomPan())
		const up = wheel(-100)
		act(() => result.current.handleWheel(up))
		expect(result.current.zoomLevel).toBeCloseTo(1.2)
		expect(up.preventDefault).toHaveBeenCalled()
		expect(up.stopPropagation).toHaveBeenCalled()
		act(() => result.current.handleWheel(wheel(100)))
		act(() => result.current.handleWheel(wheel(100)))
		expect(result.current.zoomLevel).toBeCloseTo(0.8)
	})

	it("pans only while dragging, divided by the zoom level", () => {
		const { result } = renderHook(() => useZoomPan())
		act(() => result.current.panLayerProps.onMouseMove(mouse(10, 10)))
		expect(result.current.panLayerProps.style.transform).toBe("scale(1) translate(0px, 0px)")

		act(() => result.current.adjustZoom(1))
		act(() => result.current.panLayerProps.onMouseDown(mouse()))
		expect(result.current.panLayerProps.style.cursor).toBe("grabbing")
		expect(result.current.panLayerProps.style.transition).toBe("none")
		act(() => result.current.panLayerProps.onMouseMove(mouse(10, 4)))
		expect(result.current.panLayerProps.style.transform).toBe("scale(2) translate(5px, 2px)")

		act(() => result.current.panLayerProps.onMouseLeave())
		act(() => result.current.panLayerProps.onMouseMove(mouse(10, 4)))
		expect(result.current.panLayerProps.style.transform).toBe("scale(2) translate(5px, 2px)")
	})

	it("zooms through a non-passive native wheel listener attached by wheelAreaRef", () => {
		const { result } = renderHook(() => useZoomPan())
		const area = document.createElement("div")
		const addSpy = vi.spyOn(area, "addEventListener")
		const removeSpy = vi.spyOn(area, "removeEventListener")

		act(() => result.current.wheelAreaRef(area))

		// React registers onWheel as a passive listener, where preventDefault is
		// ignored, so the hook attaches its own listener with passive: false.
		expect(addSpy).toHaveBeenCalledWith("wheel", expect.any(Function), { passive: false })

		const event = new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true })
		act(() => {
			area.dispatchEvent(event)
		})
		expect(event.defaultPrevented).toBe(true)
		expect(result.current.zoomLevel).toBeCloseTo(1.2)

		// Detaching the element removes the same listener.
		const listener = addSpy.mock.calls.find(([type]) => type === "wheel")![1]
		act(() => result.current.wheelAreaRef(null))
		expect(removeSpy).toHaveBeenCalledWith("wheel", listener)
		act(() => {
			area.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, cancelable: true }))
		})
		expect(result.current.zoomLevel).toBeCloseTo(1.2)
	})
})
