import { Box, Text } from "ink"

import { OnboardingProviderChoice } from "@/types/index.js"

import { figures } from "../../figures.js"
import * as theme from "../../theme.js"
import SelectList from "../primitives/SelectList.js"

export interface OnboardingScreenProps {
	onSelect: (choice: OnboardingProviderChoice) => void
}

export function OnboardingScreen({ onSelect }: OnboardingScreenProps) {
	return (
		<Box flexDirection="column" gap={1}>
			<Text color={theme.brand}>{figures.welcome} Welcome to Tumble Code</Text>
			<Text dimColor>How would you like to connect to an LLM provider?</Text>
			<SelectList
				items={[{ label: "Bring your own API key", value: OnboardingProviderChoice.Byok }]}
				onSelect={(v) => onSelect(v as OnboardingProviderChoice)}
			/>
		</Box>
	)
}
