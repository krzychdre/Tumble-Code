// npx vitest src/components/settings/__tests__/NotificationSettings.spec.tsx

import { act, fireEvent, screen } from "@/utils/test-utils"

import { renderWithSettingsDraft } from "./settingsDraftTestUtils"
import { NotificationSettings } from "../NotificationSettings"

const { postMessage, extensionState, t } = vi.hoisted(() => ({
	postMessage: vi.fn(),
	extensionState: { current: {} as Record<string, unknown> },
	// Stable like the real one (useCallback in TranslationProvider): the row's effect depends on it.
	t: (key: string) => key,
}))
vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage } }))
vi.mock("@src/context/ExtensionStateContext", () => ({ useExtensionState: () => extensionState.current }))
vi.mock("@/i18n/TranslationContext", () => ({ useAppTranslation: () => ({ t }) }))

// The webview's Audio element is the boundary: jsdom loads no media, so the spec sets the duration it reports.
class FakeAudio extends EventTarget {
	static created: FakeAudio[] = []
	preload = ""
	src = ""
	duration = NaN
	constructor() {
		super()
		FakeAudio.created.push(this)
	}
}

const TOO_LONG = "settings:notifications.sound.custom.tooLong"
const withCelebration = {
	customSoundCelebration: "long.mp3",
	customSoundUris: { celebration: "vscode-resource:/sounds/long.mp3" },
}

function loadMetadata(durationSeconds: number) {
	const audio = FakeAudio.created.find((a) => a.src !== "")!
	audio.duration = durationSeconds
	act(() => {
		audio.dispatchEvent(new Event("loadedmetadata"))
	})
}

beforeEach(() => {
	FakeAudio.created = []
	postMessage.mockClear()
	vi.stubGlobal("Audio", FakeAudio)
})

afterEach(() => {
	vi.unstubAllGlobals()
})

describe("NotificationSettings custom sound longer than the limit", () => {
	it("resets the slot and keeps the message after the extension has reset it", () => {
		extensionState.current = withCelebration
		const { rerender } = renderWithSettingsDraft(<NotificationSettings />, { soundEnabled: true })

		loadMetadata(20)

		expect(postMessage).toHaveBeenCalledWith({ type: "resetCustomSound", audioType: "celebration" })
		expect(screen.getByText(TOO_LONG)).toBeInTheDocument()

		// The extension answers the reset with a state that has no custom file for the slot.
		extensionState.current = { customSoundUris: {} }
		rerender(<NotificationSettings />)

		expect(screen.getByText(TOO_LONG)).toBeInTheDocument()
	})

	it("clears the message when the user chooses another file", () => {
		extensionState.current = withCelebration
		renderWithSettingsDraft(<NotificationSettings />, { soundEnabled: true })
		loadMetadata(20)

		fireEvent.click(screen.getByTestId("custom-sound-choose-celebration"))

		expect(postMessage).toHaveBeenLastCalledWith({ type: "selectCustomSound", audioType: "celebration" })
		expect(screen.queryByText(TOO_LONG)).not.toBeInTheDocument()
	})

	it("shows no message for a file within the limit", () => {
		extensionState.current = withCelebration
		renderWithSettingsDraft(<NotificationSettings />, { soundEnabled: true })

		loadMetadata(5)

		expect(postMessage).not.toHaveBeenCalled()
		expect(screen.queryByText(TOO_LONG)).not.toBeInTheDocument()
	})
})

describe("NotificationSettings volume", () => {
	it("shows the volume only while sound is on, at the default when none is set", () => {
		extensionState.current = {}
		renderWithSettingsDraft(<NotificationSettings />, { soundEnabled: false })
		expect(screen.queryByTestId("sound-volume-slider")).not.toBeInTheDocument()

		fireEvent.click(screen.getByTestId("sound-enabled-checkbox"))

		expect(screen.getByTestId("sound-volume-slider")).toBeInTheDocument()
		expect(screen.getByText("50%")).toBeInTheDocument()
	})
})
