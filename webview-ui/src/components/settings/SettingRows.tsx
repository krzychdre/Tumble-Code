// One searchable settings row each: a checkbox, a slider with its value, or a whole-number field.
// Label, description and test id go where every settings tab puts them.

import { Input, LabeledCheckbox, Slider } from "@/components/ui"
import { cn } from "@/lib/utils"

import type { SectionName } from "./SettingsView"
import { SearchableSetting } from "./SearchableSetting"
import { checkboxDescription, settingDescription } from "./SettingsCard"

const numberInputClass =
	"text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"

type RowProps = {
	section: SectionName
	settingId: string
	label: string
	description?: string
	testId?: string
}

export const CheckboxRow = ({
	section,
	settingId,
	label,
	description,
	testId,
	checked,
	onChange,
}: RowProps & { checked: boolean | undefined; onChange: (checked: boolean) => void }) => (
	<SearchableSetting settingId={settingId} section={section} label={label}>
		<LabeledCheckbox checked={checked} onCheckedChange={onChange} data-testid={testId}>
			<span className="font-medium">{label}</span>
		</LabeledCheckbox>
		{description && <div className={checkboxDescription}>{description}</div>}
	</SearchableSetting>
)

export const SliderRow = ({
	section,
	settingId,
	label,
	description,
	testId,
	min,
	max,
	step,
	value,
	onChange,
	valueText,
}: RowProps & {
	min: number
	max: number
	step: number
	value: number
	onChange: (value: number) => void
	/** Shown right of the slider instead of the bare value (in a wider column). */
	valueText?: string
}) => (
	<SearchableSetting settingId={settingId} section={section} label={label}>
		<span className="block font-medium mb-1">{label}</span>
		<div className="flex items-center gap-2">
			<Slider
				min={min}
				max={max}
				step={step}
				value={[value]}
				onValueChange={([next]) => onChange(next)}
				data-testid={testId}
			/>
			<span className={valueText === undefined ? "w-10" : "w-20"}>{valueText ?? value}</span>
		</div>
		<div className={settingDescription}>{description}</div>
	</SearchableSetting>
)

/** A whole-number field that ignores input outside [min, max]. */
export const NumberRow = ({
	section,
	settingId,
	label,
	description,
	testId,
	unit,
	min,
	max,
	value,
	onChange,
	inputWidth = "w-24",
}: RowProps & {
	unit: string
	min: number
	max: number
	value: number
	onChange: (value: number) => void
	inputWidth?: string
}) => (
	<SearchableSetting settingId={settingId} section={section} label={label}>
		<div className="flex flex-col gap-2">
			<span className="font-medium">{label}</span>
			<div className="flex items-center gap-4">
				<Input
					type="number"
					pattern="[0-9]*"
					className={cn(inputWidth, numberInputClass)}
					value={value}
					min={min}
					max={max}
					onChange={(e) => {
						const next = parseInt(e.target.value, 10)
						if (next >= min && next <= max) {
							onChange(next)
						}
					}}
					onClick={(e) => e.currentTarget.select()}
					data-testid={testId}
				/>
				<span>{unit}</span>
			</div>
		</div>
		<div className={settingDescription}>{description}</div>
	</SearchableSetting>
)
