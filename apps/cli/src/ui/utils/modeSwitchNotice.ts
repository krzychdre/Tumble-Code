/**
 * The toast shown when the user switches modes (Shift+Tab, the `!` picker).
 * A mode can run its own model (per-mode entries in cli-settings.json, /model),
 * so the toast names the model the new mode runs with: the switch changes it
 * along with the mode, and the user should not have to read the footer to
 * notice. Without a known model it names the mode only.
 */
export function modeSwitchNotice(modeName: string, model: string | undefined): string {
	return model ? `Switched to ${modeName} (${model})` : `Switched to ${modeName}`
}
