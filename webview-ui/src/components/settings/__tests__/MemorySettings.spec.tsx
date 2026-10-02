// npx vitest src/components/settings/__tests__/MemorySettings.spec.tsx

import { act, screen, fireEvent, waitFor } from "@/utils/test-utils"

import type { CachedSettings } from "../schema"
import { renderWithSettingsDraft } from "./settingsDraftTestUtils"
import { MemorySettings } from "../MemorySettings"
import { LabeledCheckbox as RealLabeledCheckbox } from "@/components/ui/labeled-checkbox"
import { Input as RealInput } from "@/components/ui/input"

// Mock the translation hook: return the key so assertions can match on it.
vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

// Mock the UI components used by MemorySettings. SelectValue renders nothing:
// the real Radix SelectValue is a display slot, not an option.
vi.mock("@/components/ui", () => ({
	// The real text field (a native input), not a stub.
	Input: (props: any) => <RealInput {...props} />,
	// The real checkbox (a native input), not a stub: only the barrel is mocked.
	LabeledCheckbox: (props: any) => <RealLabeledCheckbox {...props} />,
	Link: ({ children, ...props }: any) => <a {...props}>{children}</a>,
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
	Select: ({ value, onValueChange, children, "data-testid": dataTestId }: any) => (
		<select
			data-testid={dataTestId}
			data-value={value}
			value={value ?? ""}
			onChange={(e: any) => onValueChange?.(e.target.value)}>
			{children}
		</select>
	),
	SelectTrigger: ({ children }: any) => <>{children}</>,
	SelectValue: () => null,
	SelectContent: ({ children }: any) => <>{children}</>,
	SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}))

// The Save buffer the section reads (useSetting); only the profile list stays a prop.
const defaultDraft = {
	autoMemoryEnabled: true,
	memoryRecallEnabled: true,
	autoDreamEnabled: true,
	autoDreamMinHours: 24,
	autoDreamMinSessions: 5,
	memoryWriterApiConfigId: undefined,
}

const listApiConfigMeta = [
	{ id: "profile-1", name: "Cheap Local" },
	{ id: "profile-2", name: "Fast Cloud" },
]

const renderMemory = (draft: Partial<CachedSettings> = {}) =>
	renderWithSettingsDraft(<MemorySettings listApiConfigMeta={listApiConfigMeta} />, { ...defaultDraft, ...draft })

describe("MemorySettings", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders the section header and the enable checkbox", () => {
		renderMemory()
		expect(screen.getByText("settings:sections.memory")).toBeInTheDocument()
		expect(screen.getByText("settings:memory.enable.label")).toBeInTheDocument()
	})

	it("calls setCachedStateField('autoMemoryEnabled', false) when the enable checkbox is toggled off", async () => {
		const { setField: setCachedStateField } = renderMemory()
		const checkbox = screen.getAllByRole("checkbox")[0]
		fireEvent.click(checkbox)
		await waitFor(() => {
			expect(setCachedStateField).toHaveBeenCalledWith("autoMemoryEnabled", false)
		})
	})

	it("binds the directory input to cachedState (typing calls setCachedStateField)", async () => {
		const { setField: setCachedStateField } = renderMemory({ autoMemoryDirectory: "" })
		const input = screen.getByTestId("memory-directory-input")
		fireEvent.input(input, { target: { value: "/custom/mem" } })
		await waitFor(() => {
			expect(setCachedStateField).toHaveBeenCalledWith("autoMemoryDirectory", "/custom/mem")
		})
	})

	// "" (not undefined): JSON drops undefined, so the host would keep the old directory.
	it("clears the directory to an empty string when the input is emptied", async () => {
		const { setField: setCachedStateField } = renderMemory({ autoMemoryDirectory: "/x" })
		const input = screen.getByTestId("memory-directory-input")
		fireEvent.input(input, { target: { value: "" } })
		await waitFor(() => {
			expect(setCachedStateField).toHaveBeenCalledWith("autoMemoryDirectory", "")
		})
	})

	it("calls setCachedStateField when the recall checkbox is toggled", async () => {
		const { setField: setCachedStateField } = renderMemory()
		// The recall checkbox is the second one rendered.
		const checkboxes = screen.getAllByRole("checkbox")
		const recallCheckbox = checkboxes[1]
		fireEvent.click(recallCheckbox)
		await waitFor(() => {
			expect(setCachedStateField).toHaveBeenCalledWith("memoryRecallEnabled", false)
		})
	})

	it("renders the dream hours + sessions sliders when dream is enabled", () => {
		renderMemory()
		expect(screen.getByTestId("memory-dream-hours-slider")).toBeInTheDocument()
		expect(screen.getByTestId("memory-dream-sessions-slider")).toBeInTheDocument()
	})

	it("calls setCachedStateField when the dream-hours slider changes", async () => {
		const { setField: setCachedStateField } = renderMemory()
		const slider = screen.getByTestId("memory-dream-hours-slider") as HTMLInputElement
		fireEvent.change(slider, { target: { value: "48" } })
		await waitFor(() => {
			expect(setCachedStateField).toHaveBeenCalledWith("autoDreamMinHours", 48)
		})
	})

	it("hides the recall/directory/dream controls when memory is disabled", () => {
		renderMemory({ autoMemoryEnabled: false })
		// Only the enable checkbox should be present; no directory input or sliders.
		expect(screen.queryByTestId("memory-directory-input")).not.toBeInTheDocument()
		expect(screen.queryByTestId("memory-dream-hours-slider")).not.toBeInTheDocument()
	})

	it("renders the writer-profile dropdown with profiles from listApiConfigMeta", () => {
		renderMemory()
		const select = screen.getByTestId("memory-writer-profile-select") as HTMLSelectElement
		expect(select).toBeInTheDocument()
		// The dropdown includes the "Use current profile" option plus one per profile.
		expect(screen.getByText("settings:memory.writerProfile.useCurrent")).toBeInTheDocument()
		expect(screen.getByText("Cheap Local")).toBeInTheDocument()
		expect(screen.getByText("Fast Cloud")).toBeInTheDocument()
	})

	it("never renders a SelectItem with an empty-string value (Radix rejects it at runtime)", () => {
		renderMemory()
		const select = screen.getByTestId("memory-writer-profile-select") as HTMLSelectElement
		const optionValues = Array.from(select.querySelectorAll("option")).map((o) => o.getAttribute("value"))
		expect(optionValues.length).toBeGreaterThan(0)
		expect(optionValues).not.toContain("")
	})

	it("selecting a profile calls setCachedStateField with the profile id", async () => {
		const { setField: setCachedStateField } = renderMemory()
		const select = screen.getByTestId("memory-writer-profile-select") as HTMLSelectElement
		fireEvent.change(select, { target: { value: "profile-1" } })
		await waitFor(() => {
			expect(setCachedStateField).toHaveBeenCalledWith("memoryWriterApiConfigId", "profile-1")
		})
	})

	// "" (not undefined): JSON drops undefined, so the host would keep the old profile.
	it("selecting the 'use current profile' sentinel calls setCachedStateField with an empty string", async () => {
		const { setField: setCachedStateField } = renderMemory({ memoryWriterApiConfigId: "profile-1" })
		const select = screen.getByTestId("memory-writer-profile-select") as HTMLSelectElement
		fireEvent.change(select, { target: { value: "-" } })
		await waitFor(() => {
			expect(setCachedStateField).toHaveBeenCalledWith("memoryWriterApiConfigId", "")
		})
	})

	it("shows 'use current profile' for a cleared (empty string) writer profile", () => {
		renderMemory({ memoryWriterApiConfigId: "" })
		// The value handed to Select, not the DOM value: a native select falls
		// back to its first option by itself, the Radix one shows no item.
		expect(screen.getByTestId("memory-writer-profile-select")).toHaveAttribute("data-value", "-")
	})
	it("toggles sharing the memory directory with Claude Code", async () => {
		const { setField: setCachedStateField } = renderMemory()

		fireEvent.click(screen.getByTestId("memory-share-claude-code-checkbox"))

		await waitFor(() => {
			expect(setCachedStateField).toHaveBeenCalledWith("autoMemoryShareWithClaudeCode", true)
		})
	})

	it("explains that a custom directory overrides sharing", () => {
		const { store } = renderMemory()
		expect(screen.getByText("settings:memory.shareWithClaudeCode.description")).toBeInTheDocument()

		act(() => store.setField("autoMemoryDirectory", "/srv/memories"))
		expect(screen.getByText("settings:memory.shareWithClaudeCode.overridden")).toBeInTheDocument()
	})
})
