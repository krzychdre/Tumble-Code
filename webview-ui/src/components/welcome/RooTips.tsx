import { useTranslation } from "react-i18next"
import { Trans } from "react-i18next"

import { ReplaceAll, Users } from "lucide-react"

import { cn } from "@/lib/utils"

const tips = [
	{
		icon: <Users className="size-4 shrink-0 mt-0.5" />,
		titleKey: "rooTips.customizableModes.title",
		descriptionKey: "rooTips.customizableModes.description",
	},
	{
		icon: <ReplaceAll className="size-4 shrink-0 mt-0.5" />,
		titleKey: "rooTips.modelAgnostic.title",
		descriptionKey: "rooTips.modelAgnostic.description",
	},
]

const RooTips = () => {
	const { t } = useTranslation("chat")

	return (
		<div className="flex flex-col gap-2 mb-4 max-w-[500px] text-vscode-descriptionForeground">
			<p className="my-0 pr-2">
				<Trans i18nKey="chat:about" />
			</p>
			{/* One framed card, rows split by hairlines (ai_plans/2026-10-09_ui-frame-language.md). */}
			<div className="mt-2 flex flex-col rounded-control border border-frame bg-surface">
				{tips.map((tip, index) => (
					<div
						key={tip.titleKey}
						className={cn(
							"flex items-start gap-2 px-3 py-2.5 leading-relaxed",
							index > 0 && "border-t border-frame",
						)}>
						{tip.icon}
						<span>
							<span className="font-medium text-vscode-foreground">{t(tip.titleKey)}</span>:{" "}
							{t(tip.descriptionKey)}
						</span>
					</div>
				))}
			</div>
		</div>
	)
}

export default RooTips
