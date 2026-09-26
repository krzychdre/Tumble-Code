import { render } from "ink-testing-library"

import InputArea from "../InputArea.js"
import { TerminalSizeProvider } from "../../../hooks/TerminalSizeContext.js"

const noop = () => {}

/** The rendered InputArea frame, wrapped like dimColours.test.tsx does. */
const frameOf = (compactSeparator?: boolean) => {
	const { lastFrame } = render(
		<TerminalSizeProvider>
			<InputArea
				onSubmit={noop}
				isActive={true}
				isLoading={false}
				compactSeparator={compactSeparator}
				triggers={[]}
			/>
		</TerminalSizeProvider>,
	)
	return lastFrame() ?? ""
}

// The bordered box starts with a top border rule ("─────…"). The number of
// lines before it IS the marginTop separator (0 = compact, 1 = gap).
function blankRowsAboveBorder(frame: string): number {
	const lines = frame.split("\n")
	const borderIndex = lines.findIndex((l) => l.includes("───"))
	if (borderIndex === -1) throw new Error(`no top border in ${JSON.stringify(frame)}`)
	return borderIndex
}

describe("InputArea compactSeparator (CLI-F2)", () => {
	it("keeps the blank separator row by default", () => {
		expect(blankRowsAboveBorder(frameOf())).toBe(1)
	})

	it("drops the blank separator row when compactSeparator is set", () => {
		expect(blankRowsAboveBorder(frameOf(true))).toBe(0)
	})
})
