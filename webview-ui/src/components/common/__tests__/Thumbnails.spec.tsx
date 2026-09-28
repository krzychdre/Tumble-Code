// §2.5: attachment tiles are square 48px, the remove control is a real
// focusable <button> that stays in the tab order even while visually hidden,
// and focusing it makes it visible.

import { render, screen, fireEvent } from "@src/utils/test-utils"

import Thumbnails from "../Thumbnails"

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

import { vscode } from "@src/utils/vscode"

const mockPostMessage = vscode.postMessage as ReturnType<typeof vi.fn>

const images = ["data:image/png;base64,AAA", "data:image/png;base64,BBB"]

describe("Thumbnails (§2.5 attachment tiles)", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders 48px square tiles", () => {
		render(<Thumbnails images={images} />)
		const tiles = screen.getAllByRole("img")
		expect(tiles).toHaveLength(2)
		for (const tile of tiles) {
			// The size is set through the style prop (48x48 square, §2.5).
			expect((tile as HTMLImageElement).style.width).toBe("48px")
			expect((tile as HTMLImageElement).style.height).toBe("48px")
		}
	})

	it("the remove button is a real button in the tab order with an aria-label", () => {
		const setImages = vi.fn()
		render(<Thumbnails images={images} setImages={setImages} />)

		const remove = screen.getAllByRole("button").at(-1)!
		expect(remove).toHaveAttribute("aria-label", "chat:removeImage")
		expect(remove).toBeInTheDocument()

		// Visually hidden (opacity 0) but still focusable.
		expect((remove as HTMLButtonElement).style.opacity).toBe("0")
		expect(remove.tabIndex).toBe(0)
	})

	it("focusing the remove button makes it visible", () => {
		const setImages = vi.fn()
		render(<Thumbnails images={images} setImages={setImages} />)

		const remove = screen.getAllByRole("button").at(-1)! as HTMLButtonElement
		fireEvent.focus(remove)
		expect(remove.style.opacity).toBe("1")

		fireEvent.blur(remove)
		expect(remove.style.opacity).toBe("0")
	})

	it("clicking the remove button deletes the image", () => {
		const setImages = vi.fn()
		render(<Thumbnails images={images} setImages={setImages} />)

		const remove = screen.getAllByRole("button")[0] as HTMLButtonElement
		fireEvent.click(remove)
		expect(setImages).toHaveBeenCalledTimes(1)
		const updater = setImages.mock.calls[0][0] as (prev: string[]) => string[]
		expect(updater(images)).toEqual(["data:image/png;base64,BBB"])
	})

	it("without setImages there is no remove button", () => {
		render(<Thumbnails images={images} />)
		expect(screen.queryAllByRole("button")).toHaveLength(0)
	})

	it("clicking a tile opens the image", () => {
		render(<Thumbnails images={images} />)
		fireEvent.click(screen.getAllByRole("img")[0])
		expect(mockPostMessage).toHaveBeenCalledWith({ type: "openImage", text: images[0] })
	})
})
