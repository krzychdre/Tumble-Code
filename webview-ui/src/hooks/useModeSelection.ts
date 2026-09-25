import { useCallback, useMemo, useState } from "react"

import type { ModeConfig } from "@roo-code/types"

import { getAllModes } from "@roo/modes"

/**
 * The skill mode picker shared by CreateSkillDialog and the SkillsSettings mode dialog.
 *
 * "Any mode" and the specific modes are mutually exclusive: checking a specific mode clears
 * "Any mode", checking "Any mode" drops the specific modes, and unchecking the last specific
 * mode falls back to "Any mode". `modeSlugs` is what the extension expects: `undefined` for
 * no restriction, otherwise the selected slugs.
 */
export function useModeSelection(customModes: ModeConfig[] | undefined) {
	const [selectedModes, setSelectedModes] = useState<string[]>([])
	const [isAnyMode, setIsAnyMode] = useState(true)

	// Built-in plus custom modes, for the checkboxes.
	const availableModes = useMemo(
		() => getAllModes(customModes).map((m) => ({ slug: m.slug, name: m.name })),
		[customModes],
	)

	const toggleAnyMode = useCallback((checked: boolean) => {
		setIsAnyMode(checked)
		if (checked) {
			setSelectedModes([])
		}
	}, [])

	const toggleMode = useCallback(
		(modeSlug: string, checked: boolean) => {
			if (checked) {
				setIsAnyMode(false)
				setSelectedModes(selectedModes.includes(modeSlug) ? selectedModes : [...selectedModes, modeSlug])
				return
			}
			const remaining = selectedModes.filter((m) => m !== modeSlug)
			setSelectedModes(remaining)
			if (remaining.length === 0) {
				setIsAnyMode(true)
			}
		},
		[selectedModes],
	)

	/** Start over: from a skill's current modes, or on "Any mode" when it has none. */
	const reset = useCallback((modeSlugs?: string[]) => {
		const hasModes = !!modeSlugs && modeSlugs.length > 0
		setIsAnyMode(!hasModes)
		setSelectedModes(hasModes ? [...modeSlugs] : [])
	}, [])

	const modeSlugs = isAnyMode || selectedModes.length === 0 ? undefined : selectedModes

	return { availableModes, selectedModes, isAnyMode, modeSlugs, toggleAnyMode, toggleMode, reset }
}
