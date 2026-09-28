import { useState } from "react"

import {
	type DescriptorFormProviderId,
	type ProviderOptionalUrlFieldDescriptor,
	type ProviderSelectFieldDescriptor,
	PROVIDER_DESCRIPTORS,
	providerApiKeyFields,
	resolveProviderGetKeyUrl,
} from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { ThemedDropdown, ThemedOption, ThemedTextField } from "@src/components/ui"
import { VSCRUICheckbox as Checkbox } from "@src/components/ui/vscrui-checkbox"

import { ApiKeyField, type ProviderFormProps, useProviderField } from "./shared"

/**
 * The settings form of every provider whose `PROVIDER_DESCRIPTORS` row lists its fields
 * (packages/types/src/provider-descriptors.ts). A provider that needs more than an API key,
 * an endpoint choice and an optional base URL keeps a hand-written component next to this one.
 */
export const ProviderDescriptorForm = ({
	provider,
	apiConfiguration,
	setApiConfigurationField,
}: ProviderFormProps & { provider: DescriptorFormProviderId }) => (
	<>
		{PROVIDER_DESCRIPTORS[provider].form.fields.map((field, index) => {
			switch (field.kind) {
				case "apiKey":
					return (
						<ApiKeyField
							key={field.kind}
							apiConfiguration={apiConfiguration}
							setApiConfigurationField={setApiConfigurationField}
							field={providerApiKeyFields[provider]}
							labelKey={field.labelKey}
							getKeyUrl={resolveProviderGetKeyUrl(field.getKeyUrl, apiConfiguration)}
							getKeyLabelKey={field.getKeyLabelKey}
							// Below another field the trio sits in its own group (see ApiKeyField).
							grouped={index > 0}
						/>
					)
				case "select":
					return (
						<SelectField
							key={field.key}
							field={field}
							apiConfiguration={apiConfiguration}
							setApiConfigurationField={setApiConfigurationField}
						/>
					)
				case "optionalUrl":
					return (
						<OptionalUrlField
							key={field.key}
							field={field}
							apiConfiguration={apiConfiguration}
							setApiConfigurationField={setApiConfigurationField}
						/>
					)
			}
		})}
	</>
)

const SelectField = ({
	field,
	apiConfiguration,
	setApiConfigurationField,
}: ProviderFormProps & { field: ProviderSelectFieldDescriptor }) => {
	const { t } = useAppTranslation()
	const handleInputChange = useProviderField(setApiConfigurationField)

	return (
		<div>
			<label className="block font-medium mb-1">{t(field.labelKey)}</label>
			<ThemedDropdown
				value={apiConfiguration[field.key] || field.defaultValue}
				onChange={handleInputChange(field.key)}
				className="w-full">
				{field.options.map((option) => (
					<ThemedOption key={option.value} value={option.value} className="p-2">
						{option.label}
					</ThemedOption>
				))}
			</ThemedDropdown>
			{field.descriptionKey && (
				<div className="text-xs text-vscode-descriptionForeground mt-1">{t(field.descriptionKey)}</div>
			)}
		</div>
	)
}

const OptionalUrlField = ({
	field,
	apiConfiguration,
	setApiConfigurationField,
}: ProviderFormProps & { field: ProviderOptionalUrlFieldDescriptor }) => {
	const { t } = useAppTranslation()
	const handleInputChange = useProviderField(setApiConfigurationField)
	const [selected, setSelected] = useState(!!apiConfiguration[field.key])

	return (
		<div>
			<Checkbox
				data-testid="checkbox-custom-base-url"
				checked={selected}
				onChange={(checked: boolean) => {
					setSelected(checked)
					if (!checked) {
						setApiConfigurationField(field.key, "")
					}
				}}>
				{t(field.toggleLabelKey)}
			</Checkbox>
			{selected && (
				<ThemedTextField
					value={apiConfiguration[field.key] || ""}
					type="url"
					onInput={handleInputChange(field.key)}
					placeholder={t(field.placeholderKey)}
					className="w-full mt-1"
				/>
			)}
		</div>
	)
}
