import { imageSourceMediaType, imageSourceToUrl } from "../image-source"

describe("imageSourceToUrl", () => {
	it("keeps the data URL for a base64 source (the only kind the task history stores)", () => {
		expect(imageSourceToUrl({ type: "base64", media_type: "image/png", data: "AAAA" })).toBe(
			"data:image/png;base64,AAAA",
		)
	})

	it("passes a URL source through", () => {
		expect(imageSourceToUrl({ type: "url", url: "https://example.com/a.png" })).toBe("https://example.com/a.png")
	})

	it("rejects a Files API source instead of building data:undefined", () => {
		expect(() => imageSourceToUrl({ type: "file", file_id: "file_1" })).toThrow(/"file"/)
	})
})

describe("imageSourceMediaType", () => {
	it("reads the media type of a base64 source only", () => {
		expect(imageSourceMediaType({ type: "base64", media_type: "image/jpeg", data: "AAAA" })).toBe("image/jpeg")
		expect(imageSourceMediaType({ type: "url", url: "https://example.com/a.png" })).toBeUndefined()
		expect(imageSourceMediaType(undefined)).toBeUndefined()
	})
})
