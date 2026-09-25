// npx vitest run src/components/common/__tests__/ImageViewer.spec.tsx

import { describe, it, expect, vi, beforeEach } from "vitest"

import { render, fireEvent, createEvent, waitFor } from "@/utils/test-utils"

import { ImageViewer } from "../ImageViewer"

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
		i18n: { language: "en", changeLanguage: () => {}, t: (key: string) => key },
	}),
	initReactI18next: { type: "3rdParty", init: () => {} },
}))

// Mock vscode API
vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

// Import the mocked vscode after the mock is set up
import { vscode } from "@src/utils/vscode"

describe("ImageViewer", () => {
	it("should render image with webview URI", () => {
		const webviewUri = "https://file+.vscode-resource.vscode-cdn.net/path/to/image.png"
		const { container } = render(<ImageViewer imageUri={webviewUri} alt="Test image" />)

		const img = container.querySelector("img")
		expect(img).toBeTruthy()
		expect(img?.src).toBe(webviewUri)
		expect(img?.alt).toBe("Test image")
	})

	it("should render image with vscode-resource URI", () => {
		const vscodeResourceUri = "vscode-resource://file///path/to/image.png"
		const { container } = render(<ImageViewer imageUri={vscodeResourceUri} alt="Test image" />)

		const img = container.querySelector("img")
		expect(img).toBeTruthy()
		expect(img?.src).toBe(vscodeResourceUri)
	})

	it("should handle base64 images", () => {
		const base64Image =
			"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
		const { container } = render(<ImageViewer imageUri={base64Image} alt="Base64 image" />)

		const img = container.querySelector("img")
		expect(img).toBeTruthy()
		expect(img?.src).toBe(base64Image)
	})

	it("should use imageUri for rendering and imagePath for display", () => {
		const webviewUri = "https://file+.vscode-resource.vscode-cdn.net/path/to/image.png"
		const filePath = "/Users/test/project/image.png"
		const { container } = render(<ImageViewer imageUri={webviewUri} imagePath={filePath} alt="Test image" />)

		const img = container.querySelector("img")
		expect(img).toBeTruthy()
		// Should use imageUri for src
		expect(img?.src).toBe(webviewUri)

		// Should display imagePath below image
		const pathElement = container.querySelector(".text-xs.text-vscode-descriptionForeground")
		expect(pathElement).toBeTruthy()
		expect(pathElement?.textContent).toContain("image.png")
	})

	it("should handle click to open in editor", () => {
		const webviewUri = "https://file+.vscode-resource.vscode-cdn.net/path/to/image.png"
		const filePath = "/Users/test/project/image.png"
		const { container } = render(<ImageViewer imageUri={webviewUri} imagePath={filePath} alt="Test image" />)

		const img = container.querySelector("img")
		expect(img).toBeTruthy()

		// Clear previous calls
		vi.clearAllMocks()

		// Click the image
		fireEvent.click(img!)

		// Check if vscode.postMessage was called to open the image with the actual path
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "openImage",
			text: filePath,
		})
	})

	it("should handle error state gracefully", () => {
		const invalidUri = "invalid://uri"
		const { container } = render(<ImageViewer imageUri={invalidUri} alt="Invalid image" />)

		const img = container.querySelector("img")
		expect(img).toBeTruthy()

		// Trigger error event
		fireEvent.error(img!)

		// Image should still be rendered but might have error styling
		expect(img).toBeTruthy()
	})

	it("should show no image message when imageUri is empty", () => {
		const { container } = render(<ImageViewer imageUri="" alt="Empty image" />)

		// Should show no image message
		expect(container.textContent).toContain("common:image.noData")
	})

	it("should display path below image when provided", () => {
		const filePath = "/Users/test/rc1/path/to/image.png"
		const webviewUri = "https://file+.vscode-resource.vscode-cdn.net/path/to/image.png"
		const { container } = render(<ImageViewer imageUri={webviewUri} imagePath={filePath} alt="Test image" />)

		// Check if path is displayed as relative path
		const pathElement = container.querySelector(".text-xs.text-vscode-descriptionForeground")
		expect(pathElement).toBeTruthy()
		// Accept filename or relative path depending on environment
		expect(pathElement?.textContent).toContain("image.png")
	})

	describe("zoom modal", () => {
		const URI = "https://file+.vscode-resource.vscode-cdn.net/path/to/image.png"
		const PATH = "/Users/test/project/image.png"

		const wrapper = (container: HTMLElement) => container.firstElementChild as HTMLElement
		const button = (root: ParentNode, icon: string) =>
			root.querySelector(`.codicon-${icon}`)?.closest("button") ?? null
		const modal = () => document.querySelector(".fixed.inset-0") as HTMLElement | null
		const panLayer = () => modal()!.querySelector('[style*="transform"]') as HTMLElement
		const wheelArea = () => panLayer().parentElement as HTMLElement
		const zoomBadge = () => modal()!.querySelector(".absolute.bottom-4.left-4")!.textContent
		const footer = () => modal()!.querySelector(".absolute.bottom-0") as HTMLElement

		/** jsdom has no movementX/movementY on MouseEvent, so set them on the event itself. */
		function drag(el: HTMLElement, movementX: number, movementY: number) {
			const event = createEvent.mouseMove(el)
			Object.defineProperties(event, { movementX: { value: movementX }, movementY: { value: movementY } })
			fireEvent(el, event)
		}

		function openModal(container: HTMLElement) {
			fireEvent.mouseEnter(wrapper(container))
			fireEvent.click(button(wrapper(container), "zoom-in")!)
		}

		beforeEach(() => {
			vi.clearAllMocks()
			Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
		})

		it("shows the hover toolbar only when controls are enabled", () => {
			const { container, rerender } = render(<ImageViewer imageUri={URI} imagePath={PATH} />)
			expect(button(container, "zoom-in")).toBeNull()
			fireEvent.mouseEnter(wrapper(container))
			expect(button(container, "zoom-in")).not.toBeNull()

			rerender(<ImageViewer imageUri={URI} imagePath={PATH} showControls={false} />)
			fireEvent.mouseEnter(wrapper(container))
			expect(button(container, "zoom-in")).toBeNull()
		})

		it("opens the image in a modal at 100% without a pan offset", () => {
			const { container } = render(<ImageViewer imageUri={URI} imagePath={PATH} alt="Test image" />)
			openModal(container)

			expect(zoomBadge()).toBe("100%")
			expect(panLayer().style.transform).toBe("scale(1) translate(0px, 0px)")
			expect(panLayer().querySelector("img")?.getAttribute("src")).toBe(URI)
		})

		it("zooms by 0.2 per wheel notch and stays within 50% and 2000%", () => {
			const { container } = render(<ImageViewer imageUri={URI} />)
			openModal(container)

			fireEvent.wheel(wheelArea(), { deltaY: -100 })
			expect(zoomBadge()).toBe("120%")
			fireEvent.wheel(wheelArea(), { deltaY: 100 })
			expect(zoomBadge()).toBe("100%")

			for (let i = 0; i < 10; i++) fireEvent.wheel(wheelArea(), { deltaY: 100 })
			expect(zoomBadge()).toBe("50%")
			expect(panLayer().style.transform).toBe("scale(0.5) translate(0px, 0px)")

			for (let i = 0; i < 150; i++) fireEvent.wheel(wheelArea(), { deltaY: -100 })
			expect(zoomBadge()).toBe("2000%")
			expect(panLayer().style.transform).toBe("scale(20) translate(0px, 0px)")
		})

		it("cancels the wheel event while zooming, so the page behind does not scroll", () => {
			const { container } = render(<ImageViewer imageUri={URI} />)
			openModal(container)

			// fireEvent returns false when a listener called preventDefault. React's
			// own onWheel is passive, so preventDefault there is ignored.
			expect(fireEvent.wheel(wheelArea(), { deltaY: -100 })).toBe(false)
			expect(zoomBadge()).toBe("120%")
		})

		it("zooms with the footer buttons in steps of 0.2", () => {
			const { container } = render(<ImageViewer imageUri={URI} />)
			openModal(container)

			fireEvent.mouseDown(button(footer(), "zoom-in")!)
			fireEvent.mouseUp(button(footer(), "zoom-in")!)
			expect(zoomBadge()).toBe("120%")
			fireEvent.mouseDown(button(footer(), "zoom-out")!)
			fireEvent.mouseUp(button(footer(), "zoom-out")!)
			fireEvent.mouseDown(button(footer(), "zoom-out")!)
			fireEvent.mouseUp(button(footer(), "zoom-out")!)
			expect(zoomBadge()).toBe("80%")
		})

		it("pans while the mouse is held down, scaled by the zoom level", () => {
			const { container } = render(<ImageViewer imageUri={URI} />)
			openModal(container)

			fireEvent.mouseDown(panLayer())
			expect(panLayer().style.cursor).toBe("grabbing")
			drag(panLayer(), 10, 4)
			expect(panLayer().style.transform).toBe("scale(1) translate(10px, 4px)")
			fireEvent.mouseUp(panLayer())
			expect(panLayer().style.cursor).toBe("grab")

			drag(panLayer(), 50, 50)
			expect(panLayer().style.transform).toBe("scale(1) translate(10px, 4px)")

			for (let i = 0; i < 5; i++) fireEvent.wheel(wheelArea(), { deltaY: -100 })
			fireEvent.mouseDown(panLayer())
			drag(panLayer(), 10, 4)
			fireEvent.mouseLeave(panLayer())
			expect(panLayer().style.transform).toMatch(/translate\(15px, 6px\)$/)
		})

		it("resets zoom and pan when the modal is opened again", () => {
			const { container } = render(<ImageViewer imageUri={URI} />)
			openModal(container)
			fireEvent.wheel(wheelArea(), { deltaY: -100 })
			fireEvent.mouseDown(panLayer())
			drag(panLayer(), 10, 4)
			fireEvent.mouseUp(panLayer())
			fireEvent.click(button(modal()!, "close")!)
			expect(modal()).toBeNull()

			openModal(container)
			expect(zoomBadge()).toBe("100%")
			expect(panLayer().style.transform).toBe("scale(1) translate(0px, 0px)")
		})

		it("copies the file path from the hover toolbar and shows a check mark", async () => {
			const { container } = render(<ImageViewer imageUri={URI} imagePath={PATH} />)
			fireEvent.mouseEnter(wrapper(container))
			fireEvent.click(button(wrapper(container), "copy")!)
			await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(PATH))
			await waitFor(() => expect(button(wrapper(container), "check")).not.toBeNull())
		})

		it("copies the file path from the modal footer", async () => {
			const { container } = render(<ImageViewer imageUri={URI} imagePath={PATH} />)
			openModal(container)
			fireEvent.click(button(footer(), "copy")!)
			await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(PATH))
		})

		it("has no copy button in the modal when there is no file path", () => {
			const { container } = render(<ImageViewer imageUri={URI} />)
			openModal(container)
			expect(button(footer(), "copy")).toBeNull()
			expect(button(footer(), "save")).not.toBeNull()
		})

		it("saves the image through the extension", () => {
			const { container } = render(<ImageViewer imageUri={URI} />)
			openModal(container)
			fireEvent.click(button(footer(), "save")!)
			expect(vscode.postMessage).toHaveBeenCalledWith({ type: "saveImage", dataUri: URI })
		})
	})
})
