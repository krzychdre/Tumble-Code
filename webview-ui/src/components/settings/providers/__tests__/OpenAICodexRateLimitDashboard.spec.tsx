import { act, fireEvent, render, screen, waitFor } from "@/utils/test-utils"

import { OpenAICodexRateLimitDashboard } from "../OpenAICodexRateLimitDashboard"

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string, options?: Record<string, any>) => {
			switch (key) {
				case "settings:providers.openAiCodexRateLimits.title":
					return `Usage Limits for Codex${options?.planLabel ?? ""}`
				case "settings:providers.openAiCodexRateLimits.plan.withType":
					return ` (${options?.planType ?? ""})`
				case "settings:providers.openAiCodexRateLimits.plan.default":
					return ""
				case "settings:providers.openAiCodexRateLimits.window.fiveHour":
					return "5h limit"
				case "settings:providers.openAiCodexRateLimits.window.weekly":
					return "Weekly limit"
				case "settings:providers.openAiCodexRateLimits.usedPercent":
					return `${options?.percent ?? ""}% used`
				case "settings:providers.openAiCodexRateLimits.duration.hoursMinutes":
					return `${options?.hours}h ${options?.minutes}m`
				case "settings:providers.openAiCodexRateLimits.resetsIn":
					return `resets in ${options?.time}`
				default:
					return key
			}
		},
	}),
}))

const { postMessageMock } = vi.hoisted(() => ({
	postMessageMock: vi.fn(),
}))

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: postMessageMock,
	},
}))

describe("OpenAICodexRateLimitDashboard", () => {
	beforeEach(() => {
		postMessageMock.mockClear()
	})

	it("hides when not authenticated", () => {
		const { container } = render(<OpenAICodexRateLimitDashboard isAuthenticated={false} />)
		expect(container.firstChild).toBeNull()
	})

	it("sends request message when authenticated", () => {
		render(<OpenAICodexRateLimitDashboard isAuthenticated={true} />)
		expect(postMessageMock).toHaveBeenCalledWith({ type: "requestOpenAiCodexRateLimits" })
	})

	it("renders usage values from payload", () => {
		render(<OpenAICodexRateLimitDashboard isAuthenticated={true} />)

		window.dispatchEvent(
			new MessageEvent("message", {
				data: {
					type: "openAiCodexRateLimits",
					values: {
						primary: { usedPercent: 12.3, windowMinutes: 300, resetsAt: Date.now() + 60_000 },
						secondary: { usedPercent: 45.6, windowMinutes: 10080, resetsAt: Date.now() + 120_000 },
						credits: { hasCredits: true, unlimited: true },
						fetchedAt: Date.now(),
						planType: "pro",
					},
				},
			}),
		)

		return waitFor(() => {
			expect(screen.getByText(/Usage Limits for Codex \(pro\)/)).toBeInTheDocument()
			expect(screen.getByText(/5h limit/)).toBeInTheDocument()
			expect(screen.getByText(/Weekly limit/)).toBeInTheDocument()
			expect(screen.getByText(/12% used/)).toBeInTheDocument()
			expect(screen.getByText(/46% used/)).toBeInTheDocument()
		})
	})

	it("counts the time until a reset from when the limits arrived", async () => {
		const arrivedAt = 1_000_000
		vi.spyOn(Date, "now").mockReturnValue(arrivedAt)
		render(<OpenAICodexRateLimitDashboard isAuthenticated={true} />)

		window.dispatchEvent(
			new MessageEvent("message", {
				data: {
					type: "openAiCodexRateLimits",
					values: { primary: { usedPercent: 10, windowMinutes: 300, resetsAt: arrivedAt + 90 * 60_000 } },
				},
			}),
		)

		expect(await screen.findByText(/resets in 1h 30m/)).toBeInTheDocument()
		vi.mocked(Date.now).mockRestore()
	})
	const LOADING = "settings:providers.openAiCodexRateLimits.loading"
	const requests = () => postMessageMock.mock.calls.filter(([m]) => m.type === "requestOpenAiCodexRateLimits").length

	it("signing in requests the limits and shows loading until they arrive", () => {
		const { rerender } = render(<OpenAICodexRateLimitDashboard isAuthenticated={false} />)
		expect(requests()).toBe(0)

		rerender(<OpenAICodexRateLimitDashboard isAuthenticated={true} />)

		expect(requests()).toBe(1)
		expect(screen.getByText(LOADING)).toBeInTheDocument()
	})

	it("retry after an error requests the limits again and shows loading", () => {
		render(<OpenAICodexRateLimitDashboard isAuthenticated={true} />)
		act(() => {
			window.dispatchEvent(
				new MessageEvent("message", { data: { type: "openAiCodexRateLimits", error: "boom" } }),
			)
		})
		expect(screen.getByText("boom")).toBeInTheDocument()

		fireEvent.click(screen.getByText("settings:providers.openAiCodexRateLimits.retry"))

		expect(requests()).toBe(2)
		expect(screen.getByText(LOADING)).toBeInTheDocument()
	})
})
