import { useState, useEffect } from "react"
import { LabeledCheckbox } from "@src/components/ui/labeled-checkbox"

import {
	type ModelInfo,
	type BedrockServiceTier,
	BEDROCK_REGIONS,
	BEDROCK_1M_CONTEXT_MODEL_IDS,
	BEDROCK_GLOBAL_INFERENCE_MODEL_IDS,
	BEDROCK_SERVICE_TIER_MODEL_IDS,
} from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	StandardTooltip,
	Input,
} from "@src/components/ui"

import { noTransform } from "../transforms"
import { type ProviderFormProps, useProviderField } from "./shared"

type BedrockProps = ProviderFormProps & {
	selectedModelInfo?: ModelInfo
	simplifySettings?: boolean
}

export const Bedrock = ({ apiConfiguration, setApiConfigurationField, selectedModelInfo }: BedrockProps) => {
	const { t } = useAppTranslation()
	const [awsEndpointSelected, setAwsEndpointSelected] = useState(!!apiConfiguration?.awsBedrockEndpointEnabled)

	// Check if the selected model takes the 1M context beta (Claude Sonnet 4 and 4.5)
	const supports1MContextBeta =
		!!apiConfiguration?.apiModelId && BEDROCK_1M_CONTEXT_MODEL_IDS.includes(apiConfiguration.apiModelId)

	// Check if the selected model supports Global Inference profile routing
	const supportsGlobalInference =
		!!apiConfiguration?.apiModelId &&
		BEDROCK_GLOBAL_INFERENCE_MODEL_IDS.includes(apiConfiguration.apiModelId as any)

	// Check if the selected model supports service tiers
	const supportsServiceTiers =
		!!apiConfiguration?.apiModelId && BEDROCK_SERVICE_TIER_MODEL_IDS.includes(apiConfiguration.apiModelId as any)

	// Update the endpoint enabled state when the configuration changes
	useEffect(() => {
		setAwsEndpointSelected(!!apiConfiguration?.awsBedrockEndpointEnabled)
	}, [apiConfiguration?.awsBedrockEndpointEnabled])

	const handleInputChange = useProviderField(setApiConfigurationField)

	return (
		<>
			<div>
				<label className="block font-medium mb-1">{t("settings:providers.awsAuthMethod")}</label>
				<Select
					value={
						apiConfiguration?.awsUseApiKey
							? "apikey"
							: apiConfiguration?.awsUseProfile
								? "profile"
								: "credentials"
					}
					onValueChange={(value) => {
						if (value === "apikey") {
							setApiConfigurationField("awsUseApiKey", true)
							setApiConfigurationField("awsUseProfile", false)
						} else if (value === "profile") {
							setApiConfigurationField("awsUseApiKey", false)
							setApiConfigurationField("awsUseProfile", true)
						} else {
							setApiConfigurationField("awsUseApiKey", false)
							setApiConfigurationField("awsUseProfile", false)
						}
					}}>
					<SelectTrigger className="w-full">
						<SelectValue placeholder={t("settings:common.select")} />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="credentials">{t("settings:providers.awsCredentials")}</SelectItem>
						<SelectItem value="profile">{t("settings:providers.awsProfile")}</SelectItem>
						<SelectItem value="apikey">{t("settings:providers.awsApiKey")}</SelectItem>
					</SelectContent>
				</Select>
			</div>
			<div className="text-sm text-vscode-descriptionForeground -mt-3">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>
			{apiConfiguration?.awsUseApiKey ? (
				<label className="block w-full leading-[normal]">
					<span className="block font-medium mb-1">{t("settings:providers.awsApiKey")}</span>
					<Input
						value={apiConfiguration?.awsApiKey || ""}
						type="password"
						onChange={handleInputChange("awsApiKey")}
						placeholder={t("settings:placeholders.apiKey")}
					/>
				</label>
			) : apiConfiguration?.awsUseProfile ? (
				<label className="block w-full leading-[normal]">
					<span className="block font-medium mb-1">{t("settings:providers.awsProfileName")}</span>
					<Input
						value={apiConfiguration?.awsProfile || ""}
						onChange={handleInputChange("awsProfile")}
						placeholder={t("settings:placeholders.profileName")}
					/>
				</label>
			) : (
				<>
					<label className="block w-full leading-[normal]">
						<span className="block font-medium mb-1">{t("settings:providers.awsAccessKey")}</span>
						<Input
							value={apiConfiguration?.awsAccessKey || ""}
							type="password"
							onChange={handleInputChange("awsAccessKey")}
							placeholder={t("settings:placeholders.accessKey")}
						/>
					</label>
					<label className="block w-full leading-[normal]">
						<span className="block font-medium mb-1">{t("settings:providers.awsSecretKey")}</span>
						<Input
							value={apiConfiguration?.awsSecretKey || ""}
							type="password"
							onChange={handleInputChange("awsSecretKey")}
							placeholder={t("settings:placeholders.secretKey")}
						/>
					</label>
					<label className="block w-full leading-[normal]">
						<span className="block font-medium mb-1">{t("settings:providers.awsSessionToken")}</span>
						<Input
							value={apiConfiguration?.awsSessionToken || ""}
							type="password"
							onChange={handleInputChange("awsSessionToken")}
							placeholder={t("settings:placeholders.sessionToken")}
						/>
					</label>
				</>
			)}
			<div>
				<label className="block font-medium mb-1">{t("settings:providers.awsRegion")}</label>
				<Select
					value={apiConfiguration?.awsRegion || ""}
					onValueChange={(value) => setApiConfigurationField("awsRegion", value)}>
					<SelectTrigger className="w-full">
						<SelectValue placeholder={t("settings:common.select")} />
					</SelectTrigger>
					<SelectContent>
						{BEDROCK_REGIONS.map(({ value, label }) => (
							<SelectItem key={value} value={value}>
								{label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			{supportsServiceTiers && (
				<div>
					<label className="block font-medium mb-1">{t("settings:providers.awsServiceTier")}</label>
					<Select
						value={apiConfiguration?.awsBedrockServiceTier || "STANDARD"}
						onValueChange={(value) =>
							setApiConfigurationField("awsBedrockServiceTier", value as BedrockServiceTier)
						}>
						<SelectTrigger className="w-full">
							<SelectValue placeholder={t("settings:common.select")} />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="STANDARD">{t("settings:providers.awsServiceTierStandard")}</SelectItem>
							<SelectItem value="FLEX">{t("settings:providers.awsServiceTierFlex")}</SelectItem>
							<SelectItem value="PRIORITY">{t("settings:providers.awsServiceTierPriority")}</SelectItem>
						</SelectContent>
					</Select>
					<div className="text-sm text-vscode-descriptionForeground mt-1">
						{t("settings:providers.awsServiceTierNote")}
					</div>
				</div>
			)}
			{supportsGlobalInference && (
				<LabeledCheckbox
					checked={apiConfiguration?.awsUseGlobalInference || false}
					onCheckedChange={(checked: boolean) => {
						// Global Inference takes priority over cross-region when both are enabled
						setApiConfigurationField("awsUseGlobalInference", checked)
					}}>
					{t("settings:providers.awsGlobalInference")}
				</LabeledCheckbox>
			)}
			<LabeledCheckbox
				checked={apiConfiguration?.awsUseCrossRegionInference || false}
				onCheckedChange={(checked: boolean) => {
					setApiConfigurationField("awsUseCrossRegionInference", checked)
				}}>
				{t("settings:providers.awsCrossRegion")}
			</LabeledCheckbox>
			{selectedModelInfo?.supportsPromptCache && (
				<>
					<LabeledCheckbox
						checked={apiConfiguration?.awsUsePromptCache ?? true}
						onCheckedChange={handleInputChange("awsUsePromptCache", noTransform)}>
						<div className="flex items-center gap-1">
							<span>{t("settings:providers.enablePromptCaching")}</span>
							<StandardTooltip content={t("settings:providers.enablePromptCachingTitle")}>
								<i
									className="codicon codicon-info text-vscode-descriptionForeground text-xs"
									aria-hidden="true"
								/>
							</StandardTooltip>
						</div>
					</LabeledCheckbox>
					<div className="text-sm text-vscode-descriptionForeground ml-6 mt-1">
						{t("settings:providers.cacheUsageNote")}
					</div>
				</>
			)}
			{supports1MContextBeta && (
				<div>
					<LabeledCheckbox
						checked={apiConfiguration?.awsBedrock1MContext ?? false}
						onCheckedChange={(checked: boolean) => {
							setApiConfigurationField("awsBedrock1MContext", checked)
						}}>
						{t("settings:providers.awsBedrock1MContextBetaLabel")}
					</LabeledCheckbox>
					<div className="text-sm text-vscode-descriptionForeground mt-1 ml-6">
						{t("settings:providers.awsBedrock1MContextBetaDescription")}
					</div>
				</div>
			)}
			<LabeledCheckbox
				checked={awsEndpointSelected}
				onCheckedChange={(isChecked) => {
					setAwsEndpointSelected(isChecked)
					setApiConfigurationField("awsBedrockEndpointEnabled", isChecked)
				}}>
				{t("settings:providers.awsBedrockVpc.useCustomVpcEndpoint")}
			</LabeledCheckbox>
			{awsEndpointSelected && (
				<>
					<Input
						value={apiConfiguration?.awsBedrockEndpoint || ""}
						style={{ width: "100%", marginTop: 3, marginBottom: 5 }}
						type="url"
						onChange={handleInputChange("awsBedrockEndpoint")}
						placeholder={t("settings:providers.awsBedrockVpc.vpcEndpointUrlPlaceholder")}
						data-testid="vpc-endpoint-input"
					/>
					<div className="text-sm text-vscode-descriptionForeground ml-6 mt-1 mb-3">
						{t("settings:providers.awsBedrockVpc.examples")}
						<div className="ml-2">• https://vpce-xxx.bedrock.region.vpce.amazonaws.com/</div>
						<div className="ml-2">• https://gateway.my-company.com/route/app/bedrock</div>
					</div>
				</>
			)}
		</>
	)
}
