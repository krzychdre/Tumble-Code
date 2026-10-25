import { render, act } from "@/utils/test-utils"

import type { ClineMessage, ExtensionState, SubagentSummary } from "@tumble-code/types"

import {
	ExtensionStateContextProvider,
	useExtensionState,
	mergeExtensionState,
	type ExtensionStateContextType,
} from "../ExtensionStateContext"

let latest: ExtensionStateContextType
const record = (state: ExtensionStateContextType) => {
	latest = state
}
const Probe = () => {
	record(useExtensionState())
	return null
}

const renderProvider = () =>
	render(
		<ExtensionStateContextProvider>
			<Probe />
		</ExtensionStateContextProvider>,
	)

const postState = (state: Partial<ExtensionState>) => {
	act(() => {
		window.dispatchEvent(new MessageEvent("message", { data: { type: "state", state } }))
	})
}

describe("ExtensionStateContextProvider", () => {
	it("throws when used outside the provider", () => {
		vi.spyOn(console, "error").mockImplementation(() => {})

		expect(() => render(<Probe />)).toThrow(
			"useExtensionState must be used within an ExtensionStateContextProvider",
		)
	})

	// DEF-C25, owner decisions 4a and 4b: until the host posts its state, the
	// webview must show the same defaults the host uses.
	it("starts with the decided host defaults", () => {
		renderProvider()

		expect({
			terminalShellIntegrationTimeout: latest.terminalShellIntegrationTimeout,
			soundEnabled: latest.soundEnabled,
			enableCheckpoints: latest.enableCheckpoints,
		}).toEqual({ terminalShellIntegrationTimeout: 30_000, soundEnabled: false, enableCheckpoints: true })
	})

	// buildContextValue fills these from SETTINGS_DEFAULTS while the state lacks them.
	it("falls back to the defaults the read model fills in, and takes the pushed values", () => {
		renderProvider()
		expect({
			alwaysAllowFollowupQuestions: latest.alwaysAllowFollowupQuestions,
			enterBehavior: latest.enterBehavior,
			showWorktreesInHomeScreen: latest.showWorktreesInHomeScreen,
			profileThresholds: latest.profileThresholds,
		}).toEqual({
			alwaysAllowFollowupQuestions: false,
			enterBehavior: "send",
			showWorktreesInHomeScreen: true,
			profileThresholds: {},
		})

		postState({
			alwaysAllowFollowupQuestions: true,
			enterBehavior: "newline",
			showWorktreesInHomeScreen: false,
			profileThresholds: { p1: 50 },
		})

		expect(latest.alwaysAllowFollowupQuestions).toBe(true)
		expect(latest.enterBehavior).toBe("newline")
		expect(latest.showWorktreesInHomeScreen).toBe(false)
		expect(latest.profileThresholds).toEqual({ p1: 50 })
	})

	it("keeps a value set through an action when a later push omits it; a push that carries it wins", () => {
		renderProvider()

		act(() => latest.setAlwaysAllowFollowupQuestions(true))
		postState({ includeCurrentTime: false })
		expect(latest.alwaysAllowFollowupQuestions).toBe(true)

		postState({ alwaysAllowFollowupQuestions: false })
		expect(latest.alwaysAllowFollowupQuestions).toBe(false)
	})

	it("setApiConfiguration merges a partial profile into the current one", () => {
		renderProvider()

		act(() => latest.setApiConfiguration({ apiModelId: "new-model", apiProvider: "anthropic" }))
		act(() => latest.setApiConfiguration({ modelTemperature: 0.7 }))

		expect(latest.apiConfiguration).toEqual({
			apiModelId: "new-model",
			apiProvider: "anthropic",
			modelTemperature: 0.7,
		})
	})

	it("togglePinnedApiConfig pins a profile and unpinning removes the key", () => {
		renderProvider()

		act(() => latest.togglePinnedApiConfig("p1"))
		act(() => latest.togglePinnedApiConfig("p2"))
		expect(latest.pinnedApiConfigs).toEqual({ p1: true, p2: true })

		act(() => latest.togglePinnedApiConfig("p1"))
		expect(latest.pinnedApiConfigs).toEqual({ p2: true })
	})

	it("clearSubagents empties the subagent panel", () => {
		renderProvider()
		act(() => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: { type: "subagentsUpdated", subagents: [{ taskId: "c1" } as SubagentSummary] },
				}),
			)
		})
		expect(latest.subagents).toHaveLength(1)

		act(() => latest.clearSubagents())

		expect(latest.subagents).toEqual([])
	})
})

describe("mergeExtensionState", () => {
	const merge = (prev: Partial<ExtensionState>, next: Partial<ExtensionState>) =>
		mergeExtensionState(prev as ExtensionState, next)

	// Decision 18: the host posts "" for a cleared profile or memory directory,
	// and the merge must take it (a missing key would keep the old value).
	it("takes an empty string from a state push over the previous value", () => {
		const result = merge(
			{ autoCondenseContextApiConfigId: "p-condense", memoryWriterApiConfigId: "p", autoMemoryDirectory: "/m" },
			{ autoCondenseContextApiConfigId: "", memoryWriterApiConfigId: "", autoMemoryDirectory: "" },
		)

		expect(result.autoCondenseContextApiConfigId).toBe("")
		expect(result.memoryWriterApiConfigId).toBe("")
		expect(result.autoMemoryDirectory).toBe("")
	})

	it("replaces the profile and support prompts, merges experiments and mode prompts", () => {
		const result = merge(
			{
				apiConfiguration: { modelMaxTokens: 1234, modelMaxThinkingTokens: 123 },
				customSupportPrompts: { ENHANCE: "old", CONDENSE: "old" },
				experiments: { preventFocusDisruption: true } as never,
				customModePrompts: { code: { roleDefinition: "kept" } },
			},
			{
				apiConfiguration: { modelMaxThinkingTokens: 456 },
				customSupportPrompts: { ENHANCE: "new" },
				experiments: { customTools: true } as never,
				customModePrompts: { ask: { roleDefinition: "added" } },
			},
		)

		expect(result.apiConfiguration).toEqual({ modelMaxThinkingTokens: 456 })
		expect(result.customSupportPrompts).toEqual({ ENHANCE: "new" })
		expect(result.experiments).toEqual({ preventFocusDisruption: true, customTools: true })
		expect(result.customModePrompts).toEqual({
			code: { roleDefinition: "kept" },
			ask: { roleDefinition: "added" },
		})
	})

	it("keeps the profile and prompts when the push omits them", () => {
		const prev = { apiConfiguration: { apiModelId: "m" }, customSupportPrompts: { ENHANCE: "e" } }

		const result = merge(prev, { cwd: "/w" })

		expect(result.apiConfiguration).toBe(prev.apiConfiguration)
		expect(result.customSupportPrompts).toBe(prev.customSupportPrompts)
	})

	// Concurrent pushes (cloud auth, settings, streaming) can arrive out of
	// order: chat messages apply only with a strictly newer sequence number.
	const older = [{ ts: 1, type: "say", say: "text", text: "a" }] as ClineMessage[]
	const newer = [...older, { ts: 2, type: "say", say: "text", text: "b" }] as ClineMessage[]

	it.each([
		{ name: "an older seq keeps the current messages", prevSeq: 5, push: { seq: 3 }, kept: true },
		{ name: "an equal seq keeps the current messages", prevSeq: 5, push: { seq: 5 }, kept: true },
		{ name: "a strictly newer seq applies", prevSeq: 3, push: { seq: 4 }, kept: false },
		{ name: "without any seq the push applies", prevSeq: undefined, push: { seq: undefined }, kept: false },
		{ name: "the first seq applies", prevSeq: undefined, push: { seq: 1 }, kept: false },
	])("clineMessages: $name", ({ prevSeq, push, kept }) => {
		const result = merge(
			{ clineMessages: newer, clineMessagesSeq: prevSeq },
			{ clineMessages: older, clineMessagesSeq: push.seq },
		)

		expect(result.clineMessages).toBe(kept ? newer : older)
		expect(result.clineMessagesSeq).toBe(kept ? prevSeq : push.seq)
	})

	it("clineMessages: a push without messages (cloud event) keeps them and their seq", () => {
		const result = merge({ clineMessages: newer, clineMessagesSeq: 5 }, { cloudIsAuthenticated: true })

		expect(result.clineMessages).toBe(newer)
		expect(result.clineMessagesSeq).toBe(5)
	})
})
