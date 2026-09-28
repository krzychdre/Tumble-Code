import type { ReactElement } from "react"

import { render } from "@/utils/test-utils"

import type { BufferedKey, CachedSettings } from "../schema"
import { SettingsDraftProvider } from "../SettingsDraftContext"
import { createSettingsDraftStore } from "../settingsDraftStore"

/**
 * Renders a settings section over a real Save buffer seeded with `initial`,
 * the way SettingsView provides it. `setField` spies on the buffer writes
 * (it still writes, so the section re-renders with the new value);
 * `onSetField` sees the same writes.
 */
export function renderWithSettingsDraft(
	ui: ReactElement,
	initial: Partial<CachedSettings> = {},
	{ onSetField }: { onSetField?: (key: BufferedKey, value: unknown) => void } = {},
) {
	const store = createSettingsDraftStore(initial as CachedSettings)
	if (onSetField) {
		const write = store.setField
		store.setField = (key, value) => {
			onSetField(key, value)
			write(key, value)
		}
	}
	const setField = vi.spyOn(store, "setField")
	const wrap = (node: ReactElement) => <SettingsDraftProvider value={store}>{node}</SettingsDraftProvider>
	const result = render(wrap(ui))
	return {
		...result,
		store,
		setField,
		rerender: (next: ReactElement) => result.rerender(wrap(next)),
	}
}
