import type { AutoApprovalMode } from "@roo-code/types"
import { ShieldCheck, ShieldAlert, Zap } from "lucide-react"

import { cn } from "@/lib/utils"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { Button, StandardTooltip } from "@/components/ui"

interface AutoApproveModeSelectorProps {
	mode: AutoApprovalMode
	onChange: (mode: AutoApprovalMode) => void
	disabled?: boolean
	className?: string
}

const MODE_CONFIG: Array<{
	value: AutoApprovalMode
	labelKey: string
	descriptionKey: string
	icon: typeof ShieldCheck
	/** Tailwind classes applied when this mode is the active selection. */
	activeClassName: string
}> = [
	{
		value: "default",
		labelKey: "chat:autoApprove.mode.default.label",
		descriptionKey: "chat:autoApprove.mode.default.description",
		icon: ShieldCheck,
		activeClassName: "!bg-vscode-button-background !text-vscode-button-foreground",
	},
	{
		value: "bypass",
		labelKey: "chat:autoApprove.mode.bypass.label",
		descriptionKey: "chat:autoApprove.mode.bypass.description",
		icon: ShieldAlert,
		activeClassName: "!bg-orange-600 hover:!bg-orange-600 !text-white !border-orange-600",
	},
	{
		value: "autonomous",
		labelKey: "chat:autoApprove.mode.autonomous.label",
		descriptionKey: "chat:autoApprove.mode.autonomous.description",
		icon: Zap,
		activeClassName: "!bg-orange-600 hover:!bg-orange-600 !text-white !border-orange-600",
	},
]

export const AutoApproveModeSelector = ({ mode, onChange, disabled, className }: AutoApproveModeSelectorProps) => {
	const { t } = useAppTranslation()

	return (
		<div
			className={cn("flex flex-row gap-1", className)}
			role="radiogroup"
			aria-label={t("chat:autoApprove.mode.label")}>
			{MODE_CONFIG.map(({ value, labelKey, descriptionKey, icon: Icon, activeClassName }) => {
				const isActive = mode === value
				return (
					<StandardTooltip key={value} content={t(descriptionKey)}>
						<Button
							variant={isActive ? "primary" : "secondary"}
							size="sm"
							role="radio"
							aria-checked={isActive}
							disabled={disabled}
							onClick={() => onChange(value)}
							data-testid={`auto-approve-mode-${value}`}
							className={cn(
								"flex-1 gap-1.5 text-xs whitespace-nowrap justify-center",
								isActive ? activeClassName : "opacity-70 hover:opacity-100",
								disabled && "opacity-50 cursor-not-allowed",
							)}>
							<Icon className="size-3.5 flex-shrink-0" />
							<span>{t(labelKey)}</span>
						</Button>
					</StandardTooltip>
				)
			})}
		</div>
	)
}
