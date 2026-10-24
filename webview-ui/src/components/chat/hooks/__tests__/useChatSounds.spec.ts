import { renderHook } from "@testing-library/react"

import { useChatSounds } from "../useChatSounds"

const sounds = vi.hoisted(() => ({ played: [] as string[], options: [] as Array<{ src: string; volume: number }> }))

vi.mock("use-sound", () => ({
	default: (src: string, options: { volume: number }) => {
		sounds.options.push({ src, volume: options.volume })
		return [() => sounds.played.push(src)]
	},
}))

describe("useChatSounds", () => {
	beforeEach(() => {
		sounds.played = []
		sounds.options = []
		vi.useFakeTimers({ toFake: ["Date"] })
		vi.setSystemTime(1_000_000)
	})

	afterEach(() => vi.useRealTimers())

	it("skips a sound of the same kind played less than 100 ms ago", () => {
		const { result } = renderHook(() => useChatSounds({ soundEnabled: true }))

		result.current("celebration")
		vi.setSystemTime(1_000_099)
		result.current("celebration")
		result.current("notification")
		vi.setSystemTime(1_000_100)
		result.current("celebration")

		expect(sounds.played).toEqual(["/celebration.wav", "/notification.wav", "/celebration.wav"])
	})

	it("plays nothing while sounds are off", () => {
		const { result } = renderHook(() => useChatSounds({ soundEnabled: false }))

		result.current("notification")

		expect(sounds.played).toEqual([])
	})

	it("plays the user's own file and volume, and half volume by default", () => {
		const { result } = renderHook(() =>
			useChatSounds({ soundEnabled: true, customSoundUris: { progress_loop: "file:///loop.mp3" } }),
		)
		result.current("progress_loop")
		renderHook(() => useChatSounds({ soundEnabled: true, soundVolume: 0.2 }))

		expect(sounds.played).toEqual(["file:///loop.mp3"])
		expect(sounds.options.map((o) => o.volume)).toEqual([0.5, 0.5, 0.5, 0.2, 0.2, 0.2])
	})
})
