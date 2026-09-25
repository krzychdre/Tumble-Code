import { ApiKeyField, type ProviderFormProps } from "./shared"

type DeepSeekProps = ProviderFormProps & {
	simplifySettings?: boolean
}

export const DeepSeek = ({ apiConfiguration, setApiConfigurationField }: DeepSeekProps) => (
	<ApiKeyField
		apiConfiguration={apiConfiguration}
		setApiConfigurationField={setApiConfigurationField}
		field="deepSeekApiKey"
		labelKey="settings:providers.deepSeekApiKey"
		getKeyUrl="https://platform.deepseek.com/"
		getKeyLabelKey="settings:providers.getDeepSeekApiKey"
	/>
)
