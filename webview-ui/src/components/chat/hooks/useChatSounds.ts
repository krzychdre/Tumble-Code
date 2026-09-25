import { useCallback, useRef, useState } from "react"
import useSound from "use-sound"

import type { AudioType } from "@roo-code/types"

interface ChatSoundSettings {
	soundEnabled?: boolean
	soundVolume?: number
	customSoundUris?: Partial<Record<AudioType, string>>
}

/**
 * The chat's three sounds (notification, celebration, progress loop), with a
 * custom file per sound when the user picked one. `playSound` does nothing
 * while sounds are off and skips a sound played less than 100 ms ago.
 */
export function useChatSounds({ soundEnabled, soundVolume, customSoundUris }: ChatSoundSettings) {
	const [audioBaseUri] = useState(() => {
		return (window as unknown as { AUDIO_BASE_URI?: string }).AUDIO_BASE_URI || ""
	})

	const volume = typeof soundVolume === "number" ? soundVolume : 0.5
	const notificationSrc = customSoundUris?.notification ?? `${audioBaseUri}/notification.wav`
	const celebrationSrc = customSoundUris?.celebration ?? `${audioBaseUri}/celebration.wav`
	const progressLoopSrc = customSoundUris?.progress_loop ?? `${audioBaseUri}/progress_loop.wav`
	const [playNotification] = useSound(notificationSrc, { volume, soundEnabled, interrupt: true })
	const [playCelebration] = useSound(celebrationSrc, { volume, soundEnabled, interrupt: true })
	const [playProgressLoop] = useSound(progressLoopSrc, { volume, soundEnabled, interrupt: true })

	const lastPlayedRef = useRef<Record<string, number>>({})

	return useCallback(
		(audioType: AudioType) => {
			if (!soundEnabled) {
				return
			}

			const now = Date.now()
			const lastPlayed = lastPlayedRef.current[audioType] ?? 0
			if (now - lastPlayed < 100) {
				return
			} // debounce: skip if played within 100ms
			lastPlayedRef.current[audioType] = now

			switch (audioType) {
				case "notification":
					playNotification()
					break
				case "celebration":
					playCelebration()
					break
				case "progress_loop":
					playProgressLoop()
					break
				default:
					console.warn(`Unknown audio type: ${audioType}`)
			}
		},
		[soundEnabled, playNotification, playCelebration, playProgressLoop],
	)
}
