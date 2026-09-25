import { ApiKeyField, type ProviderFormProps } from "./shared"

export const XAI = ({ apiConfiguration, setApiConfigurationField }: ProviderFormProps) => (
	<ApiKeyField
		apiConfiguration={apiConfiguration}
		setApiConfigurationField={setApiConfigurationField}
		field="xaiApiKey"
		labelKey="settings:providers.xaiApiKey"
		getKeyUrl="https://api.x.ai/docs"
		getKeyLabelKey="settings:providers.getXaiApiKey"
	/>
)
