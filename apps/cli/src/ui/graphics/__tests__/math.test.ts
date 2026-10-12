import { renderMathImage } from "../math.js"

describe("renderMathImage", () => {
	it("lays a formula out as an SVG in the given colour and size", () => {
		const rendered = renderMathImage(
			String.raw`\int_{-\infty}^{0} \frac{1}{2}\,dx \quad \text{(rozbieżna)}`,
			"#abcdef",
			20,
		)

		expect(rendered).toBeDefined()
		const { svg, size } = rendered!
		expect(svg).not.toContain("currentColor")
		expect(svg).toContain("#abcdef")
		// The size is in pixels, from the viewBox in thousandths of an em.
		expect(svg).toMatch(new RegExp(`^<svg[^>]* width="${size.width}" height="${size.height}"`))
		expect(svg).not.toMatch(/^<svg[^>]*\d+ex"/)
		expect(size.width).toBeGreaterThan(size.height)
		expect(size.height).toBeGreaterThan(20)
	})

	it.each([String.raw`\frac{1}{2`, String.raw`\unknowncommand{x}`])("gives up on TeX with an error: %s", (tex) => {
		expect(renderMathImage(tex, "#ffffff", 20)).toBeUndefined()
	})
})
