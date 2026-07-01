// npx vitest src/components/settings/__tests__/MemorySettings.spec.tsx

import { render, screen, fireEvent, waitFor } from "@/utils/test-utils"
import { MemorySettings } from "../MemorySettings"

// Mock the translation hook — return the key so assertions can match on it.
vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

// Mock the UI components used by MemorySettings.
vi.mock("@/components/ui", () => ({
	Slider: ({ defaultValue, onValueChange, "data-testid": dataTestId, min, max }: any) => (
		<input
			type="range"
			data-testid={dataTestId}
			min={min}
			max={max}
			defaultValue={defaultValue?.[0] ?? 0}
			onChange={(e) => onValueChange?.([parseFloat(e.target.value)])}
			role="slider"
		/>
	),
}))

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeCheckbox: ({ checked, onChange, children, "data-testid": dataTestId }: any) => (
		<label data-testid={dataTestId}>
			<input
				type="checkbox"
				checked={checked || false}
				onChange={(e: any) => onChange?.({ target: { checked: e.target.checked } })}
			/>
			{children}
		</label>
	),
	VSCodeTextField: ({ value, onInput, placeholder, "data-testid": dataTestId }: any) => (
		<input
			type="text"
			data-testid={dataTestId ?? "memory-directory-input"}
			value={value ?? ""}
			placeholder={placeholder}
			onInput={(e: any) => onInput?.({ target: { value: e.target.value } })}
		/>
	),
	VSCodeLink: ({ children, href }: any) => (
		<a href={href} data-testid="vscode-link">
			{children}
		</a>
	),
}))

const defaultProps = {
	autoMemoryEnabled: true,
	memoryRecallEnabled: true,
	autoDreamEnabled: true,
	autoDreamMinHours: 24,
	autoDreamMinSessions: 5,
	setCachedStateField: vi.fn(),
}

describe("MemorySettings", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders the section header and the enable checkbox", () => {
		render(<MemorySettings {...defaultProps} />)
		expect(screen.getByText("settings:sections.memory")).toBeInTheDocument()
		expect(screen.getByText("settings:memory.enable.label")).toBeInTheDocument()
	})

	it("calls setCachedStateField('autoMemoryEnabled', false) when the enable checkbox is toggled off", async () => {
		const setCachedStateField = vi.fn()
		render(<MemorySettings {...defaultProps} setCachedStateField={setCachedStateField} />)
		const checkbox = screen.getAllByRole("checkbox")[0]
		fireEvent.click(checkbox)
		await waitFor(() => {
			expect(setCachedStateField).toHaveBeenCalledWith("autoMemoryEnabled", false)
		})
	})

	it("binds the directory input to cachedState (typing calls setCachedStateField)", async () => {
		const setCachedStateField = vi.fn()
		render(<MemorySettings {...defaultProps} setCachedStateField={setCachedStateField} autoMemoryDirectory="" />)
		const input = screen.getByTestId("memory-directory-input")
		fireEvent.input(input, { target: { value: "/custom/mem" } })
		await waitFor(() => {
			expect(setCachedStateField).toHaveBeenCalledWith("autoMemoryDirectory", "/custom/mem")
		})
	})

	it("clears the directory (undefined) when the input is emptied", async () => {
		const setCachedStateField = vi.fn()
		render(<MemorySettings {...defaultProps} setCachedStateField={setCachedStateField} autoMemoryDirectory="/x" />)
		const input = screen.getByTestId("memory-directory-input")
		fireEvent.input(input, { target: { value: "" } })
		await waitFor(() => {
			expect(setCachedStateField).toHaveBeenCalledWith("autoMemoryDirectory", undefined)
		})
	})

	it("calls setCachedStateField when the recall checkbox is toggled", async () => {
		const setCachedStateField = vi.fn()
		render(<MemorySettings {...defaultProps} setCachedStateField={setCachedStateField} />)
		// The recall checkbox is the second one rendered.
		const checkboxes = screen.getAllByRole("checkbox")
		const recallCheckbox = checkboxes[1]
		fireEvent.click(recallCheckbox)
		await waitFor(() => {
			expect(setCachedStateField).toHaveBeenCalledWith("memoryRecallEnabled", false)
		})
	})

	it("renders the dream hours + sessions sliders when dream is enabled", () => {
		render(<MemorySettings {...defaultProps} />)
		expect(screen.getByTestId("memory-dream-hours-slider")).toBeInTheDocument()
		expect(screen.getByTestId("memory-dream-sessions-slider")).toBeInTheDocument()
	})

	it("calls setCachedStateField when the dream-hours slider changes", async () => {
		const setCachedStateField = vi.fn()
		render(<MemorySettings {...defaultProps} setCachedStateField={setCachedStateField} />)
		const slider = screen.getByTestId("memory-dream-hours-slider") as HTMLInputElement
		fireEvent.change(slider, { target: { value: "48" } })
		await waitFor(() => {
			expect(setCachedStateField).toHaveBeenCalledWith("autoDreamMinHours", 48)
		})
	})

	it("hides the recall/directory/dream controls when memory is disabled", () => {
		render(<MemorySettings {...defaultProps} autoMemoryEnabled={false} />)
		// Only the enable checkbox should be present; no directory input or sliders.
		expect(screen.queryByTestId("memory-directory-input")).not.toBeInTheDocument()
		expect(screen.queryByTestId("memory-dream-hours-slider")).not.toBeInTheDocument()
	})
})
