import type { SectionName } from "./SettingsView"

/** Matches the `t` exposed by TranslationContext / useAppTranslation. */
type TranslateFn = (key: string, options?: Record<string, any>) => string

/**
 * A statically declared search-index entry.
 *
 * `labelKey` is resolved with the SAME i18n keys the rendered components use,
 * so a static entry can never drift from the label a `SearchableSetting` would
 * register at runtime (a key change breaks the type-checked key literal, not
 * just the search text).
 *
 * Optional `options` are forwarded to `t` (e.g. the {{primaryMod}}
 * interpolation in the "ui-enter-behavior" label).
 */
export interface StaticSearchEntry {
	settingId: string
	section: SectionName
	labelKey: string
	options?: Record<string, string>
}

/**
 * Settings whose searchability does NOT depend on their section being mounted.
 *
 * - Every settings tab title (`tab-*`), so all tabs are searchable immediately
 *   (previously registered after a full cycle-render of every tab).
 * - Modes and MCP top-level headings: these two tabs are React.lazy chunks
 *   that are no longer force-mounted for indexing (they use headings from
 *   their real sources — ModesView uses `prompts:modes.*` / McpView uses
 *   `mcp:*` keys).
 * - The EXPERIMENTAL-* entries (ExperimentalSettings derives them from
 *   `experimentConfigsMap` at runtime; their keys are stable, so declaring
 *   them here keeps the Experimental tab searchable without mounting it).
 *
 * Eager tabs keep runtime `SearchableSetting` registration — a static entry
 * here would only duplicate them.
 */
export const STATIC_SEARCH_INDEX: StaticSearchEntry[] = [
	// Tab titles — every settings tab is searchable without being mounted.
	{ settingId: "tab-providers", section: "providers", labelKey: "settings:sections.providers" },
	{ settingId: "tab-modes", section: "modes", labelKey: "settings:sections.modes" },
	{ settingId: "tab-skills", section: "skills", labelKey: "settings:sections.skills" },
	{ settingId: "tab-autoApprove", section: "autoApprove", labelKey: "settings:sections.autoApprove" },
	{ settingId: "tab-mcp", section: "mcp", labelKey: "settings:sections.mcp" },
	{ settingId: "tab-checkpoints", section: "checkpoints", labelKey: "settings:sections.checkpoints" },
	{ settingId: "tab-memory", section: "memory", labelKey: "settings:sections.memory" },
	{ settingId: "tab-web", section: "web", labelKey: "settings:sections.web" },
	{
		settingId: "tab-notifications",
		section: "notifications",
		labelKey: "settings:sections.notifications",
	},
	{
		settingId: "tab-contextManagement",
		section: "contextManagement",
		labelKey: "settings:sections.contextManagement",
	},
	{ settingId: "tab-terminal", section: "terminal", labelKey: "settings:sections.terminal" },
	{ settingId: "tab-prompts", section: "prompts", labelKey: "settings:sections.prompts" },
	{ settingId: "tab-worktrees", section: "worktrees", labelKey: "settings:sections.worktrees" },
	{ settingId: "tab-subagents", section: "subagents", labelKey: "settings:sections.subagents" },
	{ settingId: "tab-ui", section: "ui", labelKey: "settings:sections.ui" },
	{ settingId: "tab-experimental", section: "experimental", labelKey: "settings:sections.experimental" },
	{ settingId: "tab-language", section: "language", labelKey: "settings:sections.language" },
	{ settingId: "tab-about", section: "about", labelKey: "settings:sections.about" },

	// Modes tab (lazy chunk — headings from ModesView's own i18n keys).
	{ settingId: "modes-create", section: "modes", labelKey: "prompts:modes.createNewMode" },
	{ settingId: "modes-import", section: "modes", labelKey: "prompts:modes.importMode" },
	{ settingId: "modes-edit-modes-config", section: "modes", labelKey: "prompts:modes.editModesConfig" },
	{ settingId: "modes-edit-global-modes", section: "modes", labelKey: "prompts:modes.editGlobalModes" },
	{ settingId: "modes-edit-project-modes", section: "modes", labelKey: "prompts:modes.editProjectModes" },
	{ settingId: "modes-api-configuration", section: "modes", labelKey: "prompts:apiConfiguration.title" },
	{ settingId: "modes-available-tools", section: "modes", labelKey: "prompts:tools.title" },
	{ settingId: "modes-role-definition", section: "modes", labelKey: "prompts:roleDefinition.title" },
	{ settingId: "modes-when-to-use", section: "modes", labelKey: "prompts:whenToUse.title" },
	{
		settingId: "modes-custom-instructions",
		section: "modes",
		labelKey: "prompts:customInstructions.title",
	},
	{ settingId: "modes-export-mode", section: "modes", labelKey: "prompts:exportMode.title" },
	{
		settingId: "modes-global-custom-instructions",
		section: "modes",
		labelKey: "prompts:globalCustomInstructions.title",
	},
	{
		settingId: "modes-system-prompt-preview",
		section: "modes",
		labelKey: "prompts:systemPrompt.preview",
	},

	// MCP tab (lazy chunk — headings from McpView's own i18n keys).
	{ settingId: "mcp-enable", section: "mcp", labelKey: "mcp:enableToggle.title" },
	{ settingId: "mcp-edit-global", section: "mcp", labelKey: "mcp:editGlobalMCP" },
	{ settingId: "mcp-edit-project", section: "mcp", labelKey: "mcp:editProjectMCP" },
	{ settingId: "mcp-refresh", section: "mcp", labelKey: "mcp:refreshMCP" },
	{ settingId: "mcp-marketplace", section: "mcp", labelKey: "mcp:marketplace" },
	{ settingId: "mcp-network-timeout", section: "mcp", labelKey: "mcp:networkTimeout.label" },
	{
		settingId: "mcp-learn-more-editing-settings",
		section: "mcp",
		labelKey: "mcp:learnMoreEditingSettings",
	},

	// Experimental tab: ExperimentalSettings maps these dynamically at runtime;
	// the ids are stable (ExperimentKey), so declare them statically.
	{
		settingId: "experimental-prevent_focus_disruption",
		section: "experimental",
		labelKey: "settings:experimental.PREVENT_FOCUS_DISRUPTION.name",
	},
	{
		settingId: "experimental-custom_tools",
		section: "experimental",
		labelKey: "settings:experimental.CUSTOM_TOOLS.name",
	},
	{
		settingId: "experimental-deferred_tools",
		section: "experimental",
		labelKey: "settings:experimental.DEFERRED_TOOLS.name",
	},
]

/**
 * Resolves the static index into the runtime search-index shape.
 * Kept as a pure function so it is cheaply recomputed when the language
 * changes and trivially unit-testable.
 */
export function resolveStaticSearchIndex(
	t: TranslateFn,
	getSectionLabel: (section: SectionName) => string,
): { settingId: string; section: SectionName; label: string; sectionLabel: string }[] {
	return STATIC_SEARCH_INDEX.map((entry) => ({
		settingId: entry.settingId,
		section: entry.section,
		label: t(entry.labelKey, entry.options),
		sectionLabel: getSectionLabel(entry.section),
	}))
}
