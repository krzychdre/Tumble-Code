import {
	Blocks,
	Bug,
	CircleQuestionMark,
	CodeXml,
	DraftingCompass,
	Eye,
	Languages,
	type LucideIcon,
	ScanEye,
	Workflow,
} from "lucide-react"

import { cn } from "@/lib/utils"

// Outline icons drawn in currentColor, so they follow the theme instead of the colourful emoji the
// mode names carry. Unknown (custom) slugs get the generic fallback.
const MODE_ICONS: Record<string, LucideIcon> = {
	architect: DraftingCompass,
	code: CodeXml,
	ask: CircleQuestionMark,
	debug: Bug,
	orchestrator: Workflow,
	translate: Languages,
	reviewer: ScanEye,
	vision: Eye,
}

// One leading emoji (with variation selectors, ZWJ sequences and skin tones) plus the space after it.
const LEADING_EMOJI =
	/^(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})(?:\uFE0F|\u200D|\p{Emoji_Modifier}|\p{Extended_Pictographic})*\s*/u

/** The mode name without its leading emoji; the whole name if stripping would leave nothing. */
export function modeLabel(name: string): string {
	return name.replace(LEADING_EMOJI, "").trim() || name
}

export function ModeIcon({ slug, className }: { slug: string; className?: string }) {
	const Icon = MODE_ICONS[slug] ?? Blocks
	return <Icon aria-hidden="true" className={cn("size-3.5 flex-shrink-0", className)} />
}
