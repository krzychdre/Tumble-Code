// Characterization of what users rely on at the webview's link call sites
// (refactor DEP-9: the deprecated `VSCodeLink` from @vscode/webview-ui-toolkit
// is being replaced by a plain anchor).
//
// The toolkit is NOT mocked here. In jsdom it renders a `<vscode-link>` custom
// element that carries the call site's className, style and click handler,
// while the real `<a href>` lives in its shadow root. A plain replacement puts
// all of that on one `<a>`. `linkParts` resolves both shapes, so every
// assertion below holds before and after the swap.

import React from "react"

import { fireEvent, render, screen, waitFor } from "@/utils/test-utils"

import { About } from "@src/components/settings/About"
import TelemetryBanner from "@src/components/common/TelemetryBanner"
import { CheckpointWarning } from "@src/components/chat/CheckpointWarning"
import { IssueFooter } from "@src/components/marketplace/IssueFooter"
import { Vertex } from "@src/components/settings/providers/Vertex"
import { ModelDescriptionMarkdown } from "@src/components/settings/ModelDescriptionMarkdown"

vi.mock("@src/utils/vscode", () => ({
	vscode: { postMessage: vi.fn() },
}))

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("@roo/package", () => ({
	Package: { version: "1.0.0", sha: "abc12345" },
}))

// Without an i18n instance <Trans> drops its `components`; render each one with
// its placeholder name as the link text so the link can be found by text.
vi.mock("react-i18next", async () => {
	const actual = await vi.importActual<typeof import("react-i18next")>("react-i18next")
	const React = await import("react")
	return {
		...actual,
		Trans: ({
			children,
			components,
		}: {
			children?: React.ReactNode
			components?: Record<string, React.ReactElement>
		}) =>
			components
				? React.createElement(
						React.Fragment,
						null,
						Object.entries(components).map(([name, element]) =>
							React.cloneElement(element, { key: name }, name),
						),
					)
				: React.createElement(React.Fragment, null, children),
	}
})

/**
 * `host` is the element that receives the call site's props (className, style,
 * onClick); `anchor` is the `<a>` the browser actually focuses and follows.
 */
async function linkParts(text: string) {
	const host = screen.getByText(text).closest("a, vscode-link") as HTMLElement | null
	expect(host).not.toBeNull()
	const resolveAnchor = () =>
		host!.tagName === "A" ? (host as HTMLAnchorElement) : host!.shadowRoot?.querySelector("a")
	await waitFor(() => expect(resolveAnchor()).toBeTruthy())
	return { host: host!, anchor: resolveAnchor()! }
}

/** The toolkit copies props into its shadow anchor asynchronously. */
async function expectHref(anchor: HTMLAnchorElement, href: string) {
	await waitFor(() => expect(anchor.getAttribute("href")).toBe(href))
}

describe("link call sites (VSCodeLink replacement characterization)", () => {
	let postMessageSpy: ReturnType<typeof vi.spyOn>

	beforeEach(() => {
		vi.clearAllMocks()
		postMessageSpy = vi.spyOn(window, "postMessage").mockImplementation(() => {})
	})

	afterEach(() => {
		postMessageSpy.mockRestore()
	})

	it("About: plain href links render as keyboard-focusable anchors to their targets", async () => {
		render(<About telemetrySetting="enabled" setTelemetrySetting={vi.fn()} />)

		const cases: Array<[string, string]> = [
			[
				"settings:about.bugReport.link",
				"https://github.com/RooCodeInc/Roo-Code/issues/new?template=bug_report.yml",
			],
			[
				"settings:about.featureRequest.link",
				"https://github.com/RooCodeInc/Roo-Code/issues/new?template=feature_request.yml",
			],
			["settings:about.securityIssue.link", "https://github.com/RooCodeInc/Roo-Code/security/policy"],
			// Links passed to <Trans components>, text supplied by the translation.
			["privacyLink", "https://roocode.com/privacy"],
			["redditLink", "https://reddit.com/r/RooCode"],
			["discordLink", "https://discord.gg/roocode"],
		]

		for (const [text, href] of cases) {
			const { anchor } = await linkParts(text)
			// An <a> with an href has the implicit ARIA role "link".
			expect(anchor.tagName).toBe("A")
			await expectHref(anchor, href)
			// In the tab order by default.
			expect(anchor.tabIndex).toBe(0)
		}
	})

	it("TelemetryBanner: the settings link opens the About settings section", async () => {
		render(<TelemetryBanner />)

		const { host, anchor } = await linkParts("settingsLink")
		await expectHref(anchor, "#")

		fireEvent.click(host)

		expect(postMessageSpy).toHaveBeenCalledWith({
			type: "action",
			action: "settingsButtonClicked",
			values: { section: "about" },
		})
	})

	it("CheckpointWarning: the settings link cancels navigation and opens the checkpoint settings", async () => {
		render(<CheckpointWarning warning={{ type: "WAIT_TIMEOUT", timeout: 5 }} />)

		const { host, anchor } = await linkParts("settingsLink")
		await expectHref(anchor, "#")
		expect(host).toHaveClass("inline")

		// fireEvent returns false when a handler called preventDefault().
		const notCancelled = fireEvent.click(host)

		expect(notCancelled).toBe(false)
		expect(postMessageSpy).toHaveBeenCalledWith(
			{ type: "action", action: "settingsButtonClicked", values: { section: "checkpoints" } },
			"*",
		)
	})

	it("IssueFooter: the inline style from the call site reaches the link", async () => {
		render(<IssueFooter />)

		const { host, anchor } = await linkParts("Open a GitHub issue")
		await expectHref(anchor, "https://github.com/RooCodeInc/Roo-Code/issues/new?template=marketplace.yml")
		expect(host.style.display).toBe("inline")
		expect(host.style.fontSize).toBe("inherit")
	})

	it("Vertex: setup links keep their className and targets", async () => {
		render(<Vertex apiConfiguration={{}} setApiConfigurationField={vi.fn()} />)

		const { host, anchor } = await linkParts("settings:providers.googleCloudSetup.step1")
		expect(host).toHaveClass("text-sm")
		await expectHref(
			anchor,
			"https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-claude#before_you_begin",
		)
	})

	it("ModelDescriptionMarkdown: the More/Less link without href has no href and toggles the description", async () => {
		const setIsExpanded = vi.fn()
		render(
			<ModelDescriptionMarkdown
				key="description"
				markdown="A model."
				isExpanded={true}
				setIsExpanded={setIsExpanded}
			/>,
		)

		const { host, anchor } = await linkParts("Less")
		// No href, so a browser keeps it out of the tab order (jsdom does not
		// model that, hence no tabIndex assertion here).
		expect(anchor.hasAttribute("href")).toBe(false)
		// The Radix trigger props land on the link.
		expect(host).toHaveAttribute("aria-expanded", "true")

		fireEvent.click(host)

		expect(setIsExpanded).toHaveBeenCalledWith(false)
	})
})
