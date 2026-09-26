// Since the last DEP-9 step the toolkit is no longer installed: these specs
// now run on the replacement components and keep pinning the behaviour the
// toolkit had (the toolkit-only branches in the helpers are unused).

// Characterization of the webview's VSCodeProgressRing call sites (refactor
// DEP-9: the deprecated `VSCodeProgressRing` from @vscode/webview-ui-toolkit
// is being replaced). The toolkit is NOT mocked. Its ring announces itself
// to screen readers as role="alert", aria-label="Loading",
// aria-live="assertive" (set once connected, hence findByRole) and carries the
// call site's className; the replacement must keep both.

import { render, screen } from "@/utils/test-utils"

import { ProgressIndicator } from "@src/components/chat/ProgressIndicator"
import CodeAccordion from "@src/components/common/CodeAccordion"

describe("VSCodeProgressRing call sites (replacement characterization)", () => {
	it("ProgressIndicator: announced as a live 'Loading' alert", async () => {
		render(<ProgressIndicator />)

		const ring = await screen.findByRole("alert", { name: "Loading" })
		expect(ring).toHaveAttribute("aria-live", "assertive")
	})

	it("CodeAccordion: a small ring with the call site's classes while loading, none otherwise", async () => {
		const props = { path: "src/a.ts", code: "x", language: "ts", header: "src/a.ts", onToggleExpand: () => {} }
		const { rerender } = render(<CodeAccordion {...props} isLoading isExpanded={false} />)
		expect(await screen.findByRole("alert", { name: "Loading" })).toHaveClass("size-3", "mr-2")

		rerender(<CodeAccordion {...props} isExpanded={false} />)
		expect(screen.queryByRole("alert", { name: "Loading" })).toBeNull()
	})
})
