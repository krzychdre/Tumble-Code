import { useEffect, useState } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { useDebounce } from "react-use"

import { Slider, LabeledCheckbox } from "@/components/ui"
import { SettingsNested, checkboxDescription, settingDescription } from "./SettingsCard"

interface TemperatureControlProps {
	value: number | undefined | null
	onChange: (value: number | undefined | null) => void
	maxValue?: number // Some providers like OpenAI use 0-2 range.
	defaultValue?: number // Default temperature from model configuration
}

export const TemperatureControl = ({ value, onChange, maxValue = 1, defaultValue }: TemperatureControlProps) => {
	const { t } = useAppTranslation()
	const [isCustomTemperature, setIsCustomTemperature] = useState(value !== undefined)
	const [inputValue, setInputValue] = useState(value)

	useDebounce(() => onChange(inputValue), 50, [onChange, inputValue])

	// Sync internal state with prop changes when switching profiles.
	useEffect(() => {
		const hasCustomTemperature = value !== undefined && value !== null
		setIsCustomTemperature(hasCustomTemperature)
		setInputValue(value)
	}, [value])

	return (
		<>
			<div>
				<LabeledCheckbox
					checked={isCustomTemperature}
					onChange={(e: any) => {
						const isChecked = e.target.checked
						setIsCustomTemperature(isChecked)

						if (!isChecked) {
							setInputValue(null) // Unset the temperature, note that undefined is unserializable.
						} else {
							// Use the value from apiConfiguration, or fallback to model's defaultTemperature, or finally to 0
							setInputValue(value ?? defaultValue ?? 0)
						}
					}}>
					<label className="font-medium">{t("settings:temperature.useCustom")}</label>
				</LabeledCheckbox>
				<div className={checkboxDescription}>
					{t("settings:temperature.description")}
				</div>
			</div>

			{isCustomTemperature && (
				<SettingsNested>
					<div>
						<div className="flex items-center gap-2">
							<Slider
								min={0}
								max={maxValue}
								step={0.01}
								value={[inputValue ?? 0]}
								onValueChange={([value]) => setInputValue(value)}
							/>
							<span className="w-10">{inputValue}</span>
						</div>
						<div className={settingDescription}>{t("settings:temperature.rangeDescription")}</div>
					</div>
				</SettingsNested>
			)}
		</>
	)
}
