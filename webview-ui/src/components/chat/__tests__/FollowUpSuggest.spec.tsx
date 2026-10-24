import React from "react"
import { render, screen, act, fireEvent } from "@testing-library/react"
import { TooltipProvider } from "@radix-ui/react-tooltip"

import { FollowUpSuggest } from "../FollowUpSuggest"

vi.mock("@src/i18n/TranslationContext", () => ({
	TranslationProvider: ({ children }: { children: React.ReactNode }) => children,
	useAppTranslation: () => ({
		t: (key: string, options?: { seconds?: number }) =>
			key === "chat:followUpSuggest.timerPrefix" ? `Selecting in ${options!.seconds}s` : key,
	}),
}))

const state = vi.hoisted(() => ({
	current: {} as {
		autoApprovalEnabled?: boolean
		alwaysAllowFollowupQuestions?: boolean
		followupAutoApproveTimeoutMs?: number
	},
}))

vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionSelector: (selector: (s: never) => unknown) => selector(state.current as never),
}))

type Props = React.ComponentProps<typeof FollowUpSuggest>

const SUGGESTIONS = [{ answer: "First suggestion" }, { answer: "Second suggestion", mode: "architect" }]
const AUTO_APPROVE = {
	autoApprovalEnabled: true,
	alwaysAllowFollowupQuestions: true,
	followupAutoApproveTimeoutMs: 3000,
}

const onSuggestionClick = vi.fn()
const onCancelAutoApproval = vi.fn()

const element = (props: Partial<Props>) => (
	<TooltipProvider>
		<FollowUpSuggest
			suggestions={SUGGESTIONS}
			onSuggestionClick={onSuggestionClick}
			ts={123}
			onCancelAutoApproval={onCancelAutoApproval}
			{...props}
		/>
	</TooltipProvider>
)

/** Renders with the given state; `update` re-renders with new props and state. */
const renderSuggest = (props: Partial<Props> = {}, extensionState = AUTO_APPROVE) => {
	state.current = extensionState
	const view = render(element(props))
	const update = (next: Partial<Props>, nextState = extensionState) => {
		state.current = nextState
		view.rerender(element(next))
	}
	return { ...view, update }
}

const countdown = () => screen.queryByText(/Selecting in \d+s/)?.textContent ?? null

const tick = (ms: number) =>
	act(async () => {
		vi.advanceTimersByTime(ms)
	})

describe("FollowUpSuggest", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it.each([
		["auto-approval on", {}, AUTO_APPROVE, "Selecting in 3s"],
		["a custom timeout", {}, { ...AUTO_APPROVE, followupAutoApproveTimeoutMs: 5000 }, "Selecting in 5s"],
		["no timeout set", {}, { ...AUTO_APPROVE, followupAutoApproveTimeoutMs: NaN }, "Selecting in 60s"],
		["auto-approval off", {}, { ...AUTO_APPROVE, autoApprovalEnabled: false }, null],
		["follow-ups not auto-approved", {}, { ...AUTO_APPROVE, alwaysAllowFollowupQuestions: false }, null],
		["an answered question", { isAnswered: true }, AUTO_APPROVE, null],
		["the user typing", { isFollowUpAutoApprovalPaused: true }, AUTO_APPROVE, null],
	])("with %s shows the countdown %s", (_name, props, extensionState, shown) => {
		renderSuggest(props, extensionState)

		expect(countdown()).toBe(shown)
	})

	it("counts down each second and disappears at zero", async () => {
		renderSuggest()

		await tick(1000)
		expect(countdown()).toBe("Selecting in 2s")
		await tick(1000)
		expect(countdown()).toBe("Selecting in 1s")
		await tick(1000)

		expect(countdown()).toBeNull()
		// The answer itself is picked by ChatView, not here.
		expect(onSuggestionClick).not.toHaveBeenCalled()
	})

	it.each([
		["the user answers", { isAnswered: true }, AUTO_APPROVE],
		["the user starts typing", { isFollowUpAutoApprovalPaused: true }, AUTO_APPROVE],
		["auto-approval is switched off", {}, { ...AUTO_APPROVE, autoApprovalEnabled: false }],
		["follow-ups stop being auto-approved", {}, { ...AUTO_APPROVE, alwaysAllowFollowupQuestions: false }],
	])("stops the countdown and cancels the auto-approval when %s", async (_name, props, nextState) => {
		const { update } = renderSuggest()
		await tick(1000)

		update(props, nextState)

		expect(countdown()).toBeNull()
		expect(onCancelAutoApproval).toHaveBeenCalled()
		await tick(5000)
		expect(onSuggestionClick).not.toHaveBeenCalled()
	})

	it("starts over when the user clears the input again", async () => {
		const { update } = renderSuggest()
		await tick(1000)
		update({ isFollowUpAutoApprovalPaused: true })

		update({ isFollowUpAutoApprovalPaused: false })

		expect(countdown()).toBe("Selecting in 3s")
	})

	it.each([
		["a new timeout", SUGGESTIONS, 5000, "Selecting in 5s"],
		["new suggestions", [{ answer: "Other" }], 3000, "Selecting in 3s"],
	])("starts the countdown over on %s", async (_name, suggestions, timeoutMs, shown) => {
		const { update } = renderSuggest()
		await tick(1000)

		update({ suggestions }, { ...AUTO_APPROVE, followupAutoApproveTimeoutMs: timeoutMs })

		expect(countdown()).toBe(shown)
	})

	it("cancels the auto-approval when it unmounts", () => {
		const { unmount } = renderSuggest()

		unmount()

		expect(onCancelAutoApproval).toHaveBeenCalled()
	})

	it("picks a suggestion: passes it on, cancels the auto-approval and hides the countdown", () => {
		renderSuggest()

		fireEvent.click(screen.getByRole("button", { name: "Second suggestion" }))

		expect(onSuggestionClick).toHaveBeenCalledWith(SUGGESTIONS[1], expect.objectContaining({ shiftKey: false }))
		expect(onCancelAutoApproval).toHaveBeenCalled()
		expect(countdown()).toBeNull()
	})

	it("a Shift+click only copies the answer and keeps the countdown", () => {
		renderSuggest()

		fireEvent.click(screen.getByRole("button", { name: "First suggestion" }), { shiftKey: true })

		expect(onSuggestionClick).toHaveBeenCalledWith(SUGGESTIONS[0], expect.objectContaining({ shiftKey: true }))
		expect(onCancelAutoApproval).not.toHaveBeenCalled()
		expect(countdown()).toBe("Selecting in 3s")
	})

	it("the copy button copies with shift and cancels the auto-approval", () => {
		renderSuggest()

		fireEvent.click(screen.getAllByRole("button", { name: "chat:followUpSuggest.copyToInput" })[0])

		expect(onSuggestionClick).toHaveBeenCalledWith(SUGGESTIONS[0], expect.objectContaining({ shiftKey: true }))
		expect(onCancelAutoApproval).toHaveBeenCalled()
		expect(countdown()).toBeNull()
	})

	it("names the mode a suggestion switches to", () => {
		renderSuggest()

		expect(screen.getByText("architect")).toBeInTheDocument()
	})

	it("shows only suggestions with a usable answer", () => {
		const malformed = [{ answer: "" }, { answer: "   " }, { mode: "code" }, { answer: 42 }, { answer: "Usable" }]
		renderSuggest({ suggestions: malformed as never })

		const answers = screen
			.getAllByRole("button")
			.filter((button) => button.getAttribute("aria-label") !== "chat:followUpSuggest.copyToInput")
		expect(answers.map((button) => button.textContent)).toEqual(["Usable"])
	})

	it.each([
		["no usable suggestion", { suggestions: [{ answer: " " }] }],
		["no click handler", { onSuggestionClick: undefined }],
	])("renders nothing and counts nothing with %s", (_name, props) => {
		const { container } = renderSuggest(props as Partial<Props>)

		expect(container).toBeEmptyDOMElement()
	})
})
