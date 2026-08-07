import stringWidth from "string-width"

import { SPINNER_FRAMES } from "../figures.js"

describe("SPINNER_FRAMES", () => {
	it("every frame is exactly one column wide (string-width, ink's metric)", () => {
		// Mixed-width frames make ink reserve a different number of columns
		// per frame, so the gap between the glyph and the verb jitters
		// (the old star set mixed ✳ U+2733 [wide] with narrow glyphs).
		for (const frame of SPINNER_FRAMES) {
			expect({ frame, width: stringWidth(frame) }).toEqual({ frame, width: 1 })
		}
	})
})
