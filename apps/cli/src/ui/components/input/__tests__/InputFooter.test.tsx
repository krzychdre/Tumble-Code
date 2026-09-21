import { render } from "ink-testing-library"

import InputFooter from "../InputFooter.js"
import type { Toast } from "../../../hooks/useToast.js"

describe("InputFooter", () => {
	describe("left hint priority", () => {
		it("renders the toast (colored) when present, overriding exitHint and default", () => {
			const toast: Toast = {
				id: "t1",
				message: "Saved successfully",
				type: "success",
				duration: 3000,
				createdAt: Date.now(),
			}
			const { lastFrame } = render(
				<InputFooter toast={toast} exitHint="Press ctrl+c again to exit" mode="code" model="gpt-5" />,
			)
			const frame = lastFrame() ?? ""
			expect(frame).toContain("✓ Saved successfully")
			// exitHint and default hint are not shown when toast is present
			expect(frame).not.toContain("Press ctrl+c again to exit")
			expect(frame).not.toContain("? for shortcuts")
		})

		it("renders the exitHint when no toast is present, overriding default", () => {
			const { lastFrame } = render(<InputFooter exitHint="Press ctrl+c again to exit" />)
			const frame = lastFrame() ?? ""
			expect(frame).toContain("Press ctrl+c again to exit")
			expect(frame).not.toContain("? for shortcuts")
		})

		it("renders '? for shortcuts' when neither toast nor exitHint is present", () => {
			const { lastFrame } = render(<InputFooter />)
			const frame = lastFrame() ?? ""
			expect(frame).toContain("? for shortcuts")
		})

		it("renders warning toast with warning icon", () => {
			const toast: Toast = {
				id: "t2",
				message: "Context almost full",
				type: "warning",
				duration: 3000,
				createdAt: Date.now(),
			}
			const { lastFrame } = render(<InputFooter toast={toast} />)
			const frame = lastFrame() ?? ""
			expect(frame).toContain("⚠ Context almost full")
		})

		it("renders error toast with error icon", () => {
			const toast: Toast = {
				id: "t3",
				message: "Something broke",
				type: "error",
				duration: 3000,
				createdAt: Date.now(),
			}
			const { lastFrame } = render(<InputFooter toast={toast} />)
			const frame = lastFrame() ?? ""
			expect(frame).toContain("✗ Something broke")
		})

		it("renders info toast with info icon", () => {
			const toast: Toast = {
				id: "t4",
				message: "Switched mode",
				type: "info",
				duration: 3000,
				createdAt: Date.now(),
			}
			const { lastFrame } = render(<InputFooter toast={toast} />)
			const frame = lastFrame() ?? ""
			expect(frame).toContain("ℹ Switched mode")
		})
	})

	describe("right side status", () => {
		it("renders mode · model · ctx% when all provided", () => {
			const { lastFrame } = render(<InputFooter mode="code" model="gpt-5" contextPercent={38} />)
			const frame = lastFrame() ?? ""
			expect(frame).toContain("code")
			expect(frame).toContain("gpt-5")
			expect(frame).toContain("38%")
		})

		it("renders cost when > 0", () => {
			const { lastFrame } = render(<InputFooter cost={0.12} />)
			const frame = lastFrame() ?? ""
			expect(frame).toContain("$0.12")
		})

		it("does not render cost when 0", () => {
			const { lastFrame } = render(<InputFooter cost={0} mode="code" model="gpt-5" />)
			const frame = lastFrame() ?? ""
			expect(frame).not.toContain("$0.00")
		})

		it("does not render ctx% when null", () => {
			const { lastFrame } = render(<InputFooter mode="code" model="gpt-5" contextPercent={null} />)
			const frame = lastFrame() ?? ""
			expect(frame).not.toContain("%")
		})

		it("renders ctx% text when >= 80 (warning color — text still present)", () => {
			const { lastFrame } = render(<InputFooter mode="code" model="gpt-5" contextPercent={85} />)
			const frame = lastFrame() ?? ""
			expect(frame).toContain("85%")
		})

		it("renders full status line: mode · model · ctx% · cost", () => {
			const { lastFrame } = render(<InputFooter mode="ask" model="claude-4" contextPercent={50} cost={1.5} />)
			const frame = lastFrame() ?? ""
			expect(frame).toContain("ask")
			expect(frame).toContain("claude-4")
			expect(frame).toContain("50%")
			expect(frame).toContain("$1.50")
		})
	})

	describe("empty state", () => {
		it("renders only the default hint and no right status when no props given", () => {
			const { lastFrame } = render(<InputFooter />)
			const frame = lastFrame() ?? ""
			expect(frame).toContain("? for shortcuts")
			expect(frame).not.toContain("%")
			expect(frame).not.toContain("$")
		})
	})
})
