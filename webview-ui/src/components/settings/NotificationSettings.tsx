import { HTMLAttributes, useEffect, useState } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"

import type { AudioType } from "@roo-code/types"

import { vscode } from "@src/utils/vscode"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { Button } from "@/components/ui"

import { SetCachedStateField } from "./types"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { SearchableSetting } from "./SearchableSetting"
import { Slider } from "../ui"

const MAX_CUSTOM_SOUND_DURATION_SECONDS = 10

const CUSTOM_SOUND_SLOTS: { id: AudioType; labelKey: string; descriptionKey: string }[] = [
	{
		id: "celebration",
		labelKey: "settings:notifications.sound.custom.celebration.label",
		descriptionKey: "settings:notifications.sound.custom.celebration.description",
	},
	{
		id: "progress_loop",
		labelKey: "settings:notifications.sound.custom.progressLoop.label",
		descriptionKey: "settings:notifications.sound.custom.progressLoop.description",
	},
	{
		id: "notification",
		labelKey: "settings:notifications.sound.custom.notification.label",
		descriptionKey: "settings:notifications.sound.custom.notification.description",
	},
]

type NotificationSettingsProps = HTMLAttributes<HTMLDivElement> & {
	soundEnabled?: boolean
	soundVolume?: number
	setCachedStateField: SetCachedStateField<"soundEnabled" | "soundVolume">
}

type CustomSoundRowProps = {
	audioType: AudioType
	label: string
	description: string
	basename: string | null | undefined
	uri: string | undefined
}

const CustomSoundRow = ({ audioType, label, description, basename, uri }: CustomSoundRowProps) => {
	const { t } = useAppTranslation()
	const [error, setError] = useState<string | null>(null)

	// When a custom file is set, verify its duration. If it exceeds the max,
	// auto-reset the slot and surface an inline message.
	useEffect(() => {
		setError(null)
		if (!uri) return
		const audio = new Audio()
		audio.preload = "metadata"
		const onLoaded = () => {
			if (Number.isFinite(audio.duration) && audio.duration > MAX_CUSTOM_SOUND_DURATION_SECONDS) {
				setError(
					t("settings:notifications.sound.custom.tooLong", {
						max: MAX_CUSTOM_SOUND_DURATION_SECONDS,
					}),
				)
				vscode.postMessage({ type: "resetCustomSound", audioType })
			}
		}
		audio.addEventListener("loadedmetadata", onLoaded)
		audio.src = uri
		return () => {
			audio.removeEventListener("loadedmetadata", onLoaded)
			audio.src = ""
		}
	}, [uri, audioType, t])

	const choose = () => vscode.postMessage({ type: "selectCustomSound", audioType })
	const reset = () => vscode.postMessage({ type: "resetCustomSound", audioType })
	const preview = () => {
		if (!uri) return
		const audio = new Audio(uri)
		audio.play().catch(() => {
			/* ignore — user can re-trigger */
		})
	}

	return (
		<SearchableSetting settingId={`notifications-sound-custom-${audioType}`} section="notifications" label={label}>
			<div className="font-medium">{label}</div>
			<div className="text-vscode-descriptionForeground text-sm mt-1">{description}</div>
			{basename && (
				<div className="text-xs mt-2 text-vscode-descriptionForeground">
					{t("settings:notifications.sound.custom.current")}: <code>{basename}</code>
				</div>
			)}
			<div className="flex items-center gap-2 mt-2">
				<Button variant="secondary" size="sm" onClick={choose} data-testid={`custom-sound-choose-${audioType}`}>
					{t("settings:notifications.sound.custom.choose")}
				</Button>
				{basename && (
					<>
						<Button
							variant="secondary"
							size="sm"
							onClick={preview}
							data-testid={`custom-sound-preview-${audioType}`}>
							{t("settings:notifications.sound.custom.preview")}
						</Button>
						<Button
							variant="ghost"
							size="sm"
							onClick={reset}
							data-testid={`custom-sound-reset-${audioType}`}>
							{t("settings:notifications.sound.custom.reset")}
						</Button>
					</>
				)}
			</div>
			{error && <div className="text-vscode-errorForeground text-xs mt-2">{error}</div>}
		</SearchableSetting>
	)
}

export const NotificationSettings = ({
	soundEnabled,
	soundVolume,
	setCachedStateField,
	...props
}: NotificationSettingsProps) => {
	const { t } = useAppTranslation()
	// Custom sound fields are managed by their own message round-trip
	// (selectCustomSound / resetCustomSound) and are not part of the
	// Save-on-Done settings cache. Reading them from live extension state
	// ensures the UI updates the moment the extension finishes copying the file.
	const {
		customSoundCelebration,
		customSoundCelebrationOriginal,
		customSoundProgressLoop,
		customSoundProgressLoopOriginal,
		customSoundNotification,
		customSoundNotificationOriginal,
		customSoundUris,
	} = useExtensionState()
	// `basename` drives row state — when set, the row is in "custom" mode.
	// `displayName` is what the user sees: their original filename when
	// available, falling back to the storage basename for settings saved
	// before the *Original fields existed.
	const displayNameFor = (audioType: AudioType): string | null | undefined => {
		switch (audioType) {
			case "celebration":
				return customSoundCelebrationOriginal ?? customSoundCelebration
			case "progress_loop":
				return customSoundProgressLoopOriginal ?? customSoundProgressLoop
			case "notification":
				return customSoundNotificationOriginal ?? customSoundNotification
		}
	}
	return (
		<div {...props}>
			<SectionHeader>{t("settings:sections.notifications")}</SectionHeader>

			<Section>
				<SearchableSetting
					settingId="notifications-sound"
					section="notifications"
					label={t("settings:notifications.sound.label")}>
					<VSCodeCheckbox
						checked={soundEnabled}
						onChange={(e: any) => setCachedStateField("soundEnabled", e.target.checked)}
						data-testid="sound-enabled-checkbox">
						<span className="font-medium">{t("settings:notifications.sound.label")}</span>
					</VSCodeCheckbox>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:notifications.sound.description")}
					</div>
				</SearchableSetting>

				{soundEnabled && (
					<div className="flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background">
						<SearchableSetting
							settingId="notifications-sound-volume"
							section="notifications"
							label={t("settings:notifications.sound.volumeLabel")}>
							<label className="block font-medium mb-1">
								{t("settings:notifications.sound.volumeLabel")}
							</label>
							<div className="flex items-center gap-2">
								<Slider
									min={0}
									max={1}
									step={0.01}
									value={[soundVolume ?? 0.5]}
									onValueChange={([value]) => setCachedStateField("soundVolume", value)}
									data-testid="sound-volume-slider"
								/>
								<span className="w-10">{((soundVolume ?? 0.5) * 100).toFixed(0)}%</span>
							</div>
						</SearchableSetting>

						<div className="font-medium mt-1">{t("settings:notifications.sound.custom.sectionLabel")}</div>
						<div className="text-vscode-descriptionForeground text-sm">
							{t("settings:notifications.sound.custom.sectionDescription", {
								max: MAX_CUSTOM_SOUND_DURATION_SECONDS,
							})}
						</div>
						{CUSTOM_SOUND_SLOTS.map((slot) => (
							<CustomSoundRow
								key={slot.id}
								audioType={slot.id}
								label={t(slot.labelKey)}
								description={t(slot.descriptionKey)}
								basename={displayNameFor(slot.id)}
								uri={customSoundUris?.[slot.id]}
							/>
						))}
					</div>
				)}
			</Section>
		</div>
	)
}
