import { Text } from "ink"
import { render } from "ink-testing-library"

import type { AutocompleteTrigger, ModeResult } from "../../components/autocomplete/index.js"
import { useCLIStore } from "../../store.js"
import { useUIStateStore } from "../../stores/uiStateStore.js"
import { usePickerHandlers, type UsePickerHandlersReturn } from "../usePickerHandlers.js"

describe("usePickerHandlers mode selection", () => {
	const architect: ModeResult = { key: "architect", slug: "architect", name: "Architect" }
	const sendToExtension = vi.fn()
	const showInfo = vi.fn()

	function renderHandlers(getModelForMode?: (mode: string) => string | undefined): UsePickerHandlersReturn {
		let handlers: UsePickerHandlersReturn | undefined

		function Harness() {
			handlers = usePickerHandlers({
				autocompleteRef: { current: null },
				followupAutocompleteRef: { current: null },
				sendToExtension,
				showInfo,
				getModelForMode,
				resetTranscript: vi.fn(),
			})
			return <Text>harness</Text>
		}

		render(<Harness />)
		return handlers!
	}

	beforeEach(() => {
		useCLIStore.getState().reset()
		useUIStateStore.setState(useUIStateStore.getInitialState())
		useUIStateStore.getState().setPickerState({
			...useUIStateStore.getInitialState().pickerState,
			isOpen: true,
			activeTrigger: { id: "mode" } as AutocompleteTrigger<ModeResult>,
		})
		sendToExtension.mockClear()
		showInfo.mockClear()
	})

	it("switches the mode and names the model it runs with", () => {
		renderHandlers((mode) => (mode === "architect" ? "GLM-5.3-NVFP4" : undefined)).handlePickerSelect(architect)

		expect(sendToExtension).toHaveBeenCalledWith({ type: "mode", text: "architect" })
		expect(showInfo).toHaveBeenCalledWith("Switched to Architect (GLM-5.3-NVFP4)", 2000)
	})

	it("names the mode only when the model is unknown", () => {
		renderHandlers().handlePickerSelect(architect)

		expect(showInfo).toHaveBeenCalledWith("Switched to Architect", 2000)
	})
})
