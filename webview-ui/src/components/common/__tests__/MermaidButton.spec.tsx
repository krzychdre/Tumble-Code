// cd webview-ui && ./node_modules/.bin/vitest run src/components/common/__tests__/MermaidButton.spec.tsx

import React, { createRef } from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"

import { render, fireEvent, createEvent, waitFor } from "@/utils/test-utils"

import { MermaidButton } from "../MermaidButton"

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
		i18n: { language: "en", changeLanguage: () => {}, t: (key: string) => key },
	}),
	initReactI18next: { type: "3rdParty", init: () => {} },
}))

vi.mock("@src/utils/vscode", () => ({
	vscode: { postMessage: vi.fn() },
}))

import { vscode } from "@src/utils/vscode"

const CODE = "graph TD\n  A-->B"
const SVG = '<svg data-testid="diagram"><text>A to B</text></svg>'

function renderButton(props: { isLoading?: boolean; svgToPng?: (svg: SVGElement) => Promise<string> } = {}) {
	const containerRef = createRef<HTMLDivElement>() as React.RefObject<HTMLDivElement>
	const svgToPng = props.svgToPng ?? vi.fn().mockResolvedValue("data:image/png;base64,AAAA")
	const utils = render(
		<MermaidButton containerRef={containerRef} code={CODE} isLoading={props.isLoading ?? false} svgToPng={svgToPng}>
			<div ref={containerRef} dangerouslySetInnerHTML={{ __html: SVG }} />
		</MermaidButton>,
	)
	return { ...utils, svgToPng }
}

/** The block wrapper that toggles the hover toolbar. */
const wrapper = (container: HTMLElement) => container.firstElementChild as HTMLElement

const button = (root: ParentNode, icon: string) =>
	root.querySelector(`.codicon-${icon}`)?.closest("button") ?? null

/** jsdom has no movementX/movementY on MouseEvent, so set them on the event itself. */
function drag(el: HTMLElement, movementX: number, movementY: number) {
	const event = createEvent.mouseMove(el)
	Object.defineProperties(event, { movementX: { value: movementX }, movementY: { value: movementY } })
	fireEvent(el, event)
}

function openModal(container: HTMLElement) {
	fireEvent.mouseEnter(wrapper(container))
	fireEvent.click(button(wrapper(container), "zoom-in")!)
	return modal()
}

/** The modal is rendered as a sibling of the block, fixed to the viewport. */
const modal = () => document.querySelector(".fixed.inset-0") as HTMLElement | null

/** The element that carries the zoom and pan transform. */
const panLayer = () => modal()!.querySelector('[style*="transform"]') as HTMLElement

/** The scroll area that listens for the wheel. */
const wheelArea = () => panLayer().parentElement as HTMLElement

/** The zoom badge in the lower left corner of the diagram area. */
const zoomBadge = () => modal()!.querySelector(".absolute.bottom-4.left-4")!.textContent

describe("MermaidButton", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
	})

	it("shows the action toolbar only on hover and only when the diagram is not loading", () => {
		const { container, rerender } = renderButton()
		expect(button(container, "zoom-in")).toBeNull()

		fireEvent.mouseEnter(wrapper(container))
		expect(button(container, "zoom-in")).not.toBeNull()
		expect(button(container, "code")).not.toBeNull()
		expect(button(container, "copy")).not.toBeNull()
		expect(button(container, "save")).not.toBeNull()

		fireEvent.mouseLeave(wrapper(container))
		expect(button(container, "zoom-in")).toBeNull()

		rerender(
			<MermaidButton
				containerRef={createRef<HTMLDivElement>() as React.RefObject<HTMLDivElement>}
				code={CODE}
				isLoading={true}
				svgToPng={vi.fn()}>
				<div />
			</MermaidButton>,
		)
		fireEvent.mouseEnter(wrapper(container))
		expect(button(container, "zoom-in")).toBeNull()
	})

	it("opens the diagram in a modal at 100% with a copy of the rendered SVG", () => {
		const { container } = renderButton()
		expect(modal()).toBeNull()

		openModal(container)

		expect(modal()).not.toBeNull()
		expect(zoomBadge()).toBe("100%")
		expect(panLayer().style.transform).toBe("scale(1) translate(0px, 0px)")
		expect(panLayer().querySelector('[data-testid="diagram"]')).not.toBeNull()
	})

	it("zooms by 0.2 per wheel notch: up zooms in, down zooms out", () => {
		const { container } = renderButton()
		openModal(container)

		fireEvent.wheel(wheelArea(), { deltaY: -100 })
		expect(zoomBadge()).toBe("120%")
		fireEvent.wheel(wheelArea(), { deltaY: -100 })
		expect(zoomBadge()).toBe("140%")
		fireEvent.wheel(wheelArea(), { deltaY: 100 })
		expect(zoomBadge()).toBe("120%")
		expect(panLayer().style.transform).toMatch(/^scale\(1\.2\d*\)/)
	})

	it("never zooms out below 50%", () => {
		const { container } = renderButton()
		openModal(container)

		for (let i = 0; i < 10; i++) fireEvent.wheel(wheelArea(), { deltaY: 100 })

		expect(zoomBadge()).toBe("50%")
		expect(panLayer().style.transform).toBe("scale(0.5) translate(0px, 0px)")
	})

	it("never zooms in above 2000%", () => {
		const { container } = renderButton()
		openModal(container)

		for (let i = 0; i < 150; i++) fireEvent.wheel(wheelArea(), { deltaY: -100 })

		expect(zoomBadge()).toBe("2000%")
		expect(panLayer().style.transform).toBe("scale(20) translate(0px, 0px)")
	})

	it("zooms with the footer buttons in steps of 0.2", () => {
		const { container } = renderButton()
		const dialog = openModal(container)!
		const footer = dialog.querySelector(".absolute.bottom-0") as HTMLElement

		fireEvent.mouseDown(button(footer, "zoom-in")!)
		fireEvent.mouseUp(button(footer, "zoom-in")!)
		expect(zoomBadge()).toBe("120%")

		fireEvent.mouseDown(button(footer, "zoom-out")!)
		fireEvent.mouseUp(button(footer, "zoom-out")!)
		fireEvent.mouseDown(button(footer, "zoom-out")!)
		fireEvent.mouseUp(button(footer, "zoom-out")!)
		expect(zoomBadge()).toBe("80%")
	})

	it("pans while the mouse is held down, scaled by the zoom level", () => {
		const { container } = renderButton()
		openModal(container)

		fireEvent.mouseDown(panLayer())
		expect(panLayer().style.cursor).toBe("grabbing")
		drag(panLayer(), 10, 4)
		expect(panLayer().style.transform).toBe("scale(1) translate(10px, 4px)")
		fireEvent.mouseUp(panLayer())
		expect(panLayer().style.cursor).toBe("grab")

		// Moving without a pressed button does not pan.
		drag(panLayer(), 50, 50)
		expect(panLayer().style.transform).toBe("scale(1) translate(10px, 4px)")

		// At 200% the same mouse movement pans half as far in diagram units.
		for (let i = 0; i < 5; i++) fireEvent.wheel(wheelArea(), { deltaY: -100 })
		expect(zoomBadge()).toBe("200%")
		fireEvent.mouseDown(panLayer())
		drag(panLayer(), 10, 4)
		fireEvent.mouseLeave(panLayer())
		expect(panLayer().style.transform).toMatch(/translate\(15px, 6px\)$/)
	})

	it("copies the Mermaid source from the hover toolbar and shows a check mark", async () => {
		const { container } = renderButton()
		fireEvent.mouseEnter(wrapper(container))

		fireEvent.click(button(wrapper(container), "copy")!)

		await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(CODE))
		await waitFor(() => expect(button(wrapper(container), "check")).not.toBeNull())
	})

	it("copies the Mermaid source from the modal footer", async () => {
		const { container } = renderButton()
		const dialog = openModal(container)!
		const footer = dialog.querySelector(".absolute.bottom-0") as HTMLElement

		fireEvent.click(button(footer, "copy")!)

		await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(CODE))
	})

	it("saves the diagram as a PNG through the extension", async () => {
		const { container, svgToPng } = renderButton()
		fireEvent.mouseEnter(wrapper(container))

		fireEvent.click(button(wrapper(container), "save")!)

		await waitFor(() =>
			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "saveImage",
				dataUri: "data:image/png;base64,AAAA",
			}),
		)
		expect(svgToPng).toHaveBeenCalledWith(container.querySelector("svg"))
	})

	it("shows the source in the code tab, where the wheel does not zoom", () => {
		const { container } = renderButton()
		fireEvent.mouseEnter(wrapper(container))
		fireEvent.click(button(wrapper(container), "code")!)

		const textarea = modal()!.querySelector("textarea") as HTMLTextAreaElement
		expect(textarea.value).toBe(CODE)
		expect(textarea.readOnly).toBe(true)

		fireEvent.wheel(textarea.parentElement!, { deltaY: -100 })
		fireEvent.click(button(modal()!, "graph")!)
		expect(zoomBadge()).toBe("100%")
	})

	it("closes the modal with the close button and with a click on the backdrop", () => {
		const { container } = renderButton()
		openModal(container)
		fireEvent.click(button(modal()!, "close")!)
		expect(modal()).toBeNull()

		openModal(container)
		fireEvent.click(modal()!)
		expect(modal()).toBeNull()
	})
})
