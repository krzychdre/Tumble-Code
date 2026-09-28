/**
 * P1 perf harness + characterization test (roadmap step ③, "measured before
 * and after with the React profiler").
 *
 * Mounts the real ExtensionStateContextProvider with three probes and drives
 * 200 simulated streamed-token updates (the streaming message's partial text
 * grows, exactly what messageUpdated does) through the real window message
 * bus. A React <Profiler> records per-commit actualDuration.
 *
 * Determinism: fixed seed data, no fake timers, no network; the vscode module
 * is mocked. Run on main BEFORE the refactor and on the branch AFTER; the
 * numbers go into ai_plans/2026-09-28_p1-extension-state-selector.md.
 *
 * The settings probe uses useExtensionSelector when available (the AFTER
 * build) and falls back to useExtensionState on main (the BEFORE build), so
 * the same file measures both sides. The legacy probe is always the
 * full-context consumer, which is what every component does on main and what
 * useExtensionState() keeps doing after the refactor.
 */
import React, { Profiler } from "react"
import { render, act } from "@/utils/test-utils"

import type { ClineMessage, ExtensionMessage, ExtensionState } from "@roo-code/types"

import { vscode } from "@src/utils/vscode"

import * as ContextModule from "../ExtensionStateContext"

const { ExtensionStateContextProvider, useExtensionState } = ContextModule

/**
 * Feature detection: the selector hook does not exist on main (the BEFORE
 * run). The module namespace has a stable, string-keyed shape, so this cast is
 * safe on both sides of the refactor.
 */
const selectorModule = ContextModule as typeof ContextModule & {
	useExtensionSelector?: <T>(selector: (state: never) => T) => T
}
const useExtensionSelector = selectorModule.useExtensionSelector
const hasSelector = typeof useExtensionSelector === "function"

vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage: vi.fn() } }))

// ---------------------------------------------------------------------------
// Deterministic seed data
// ---------------------------------------------------------------------------

const TASK_TS = 1_000
const N_SEED_MESSAGES = 30
const N_TOKEN_UPDATES = 200

/** A realistic task history: one task message, mixed tool/say messages, one streaming partial at the end. */
const seedMessages = (): ClineMessage[] => {
	const messages: ClineMessage[] = [
		{ type: "say", say: "text", ts: TASK_TS, text: "Refactor the state context", partial: false },
	]
	for (let i = 1; i < N_SEED_MESSAGES; i++) {
		messages.push({
			type: "say",
			say: i % 3 === 0 ? "tool" : "text",
			ts: TASK_TS + i,
			text: `message ${i} ${"x".repeat(40)}`,
			partial: false,
		})
	}
	// The streaming answer the tokens extend.
	messages.push({ type: "say", say: "text", ts: TASK_TS + N_SEED_MESSAGES, text: "", partial: true })
	return messages
}

const seedState = (): Partial<ExtensionState> => ({
	apiConfiguration: { apiProvider: "anthropic", apiModelId: "claude-3-opus" },
	clineMessages: seedMessages(),
	currentTaskId: "task-1",
	currentTaskItem: {
		id: "task-1",
		number: 1,
		ts: TASK_TS,
		task: "Refactor the state context",
		tokensIn: 0,
		tokensOut: 0,
		totalCost: 0,
		size: 4096,
	},
	cwd: "/home/user/project",
	currentApiConfigName: "default",
	listApiConfigMeta: [{ id: "default", name: "default" }],
	mode: "code",
	customModes: [],
	taskHistory: [],
	mcpServers: [],
	alwaysAllowReadOnly: true,
	soundEnabled: true,
	language: "en",
})

const dispatch = (message: ExtensionMessage) => {
	act(() => {
		window.dispatchEvent(new MessageEvent("message", { data: message }))
	})
}

// ---------------------------------------------------------------------------
// Probes: the components whose re-render counts we compare before/after.
// ---------------------------------------------------------------------------

let legacyRenders = 0
/** Full-context consumer — what every useExtensionState() component is today (ChatView scale). */
const LegacyProbe = () => {
	legacyRenders++
	useExtensionState()
	return null
}

let settingsRenders = 0
/**
 * Settings-only consumer — reads values that never change while tokens stream
 * (what SettingsView/ModeSelector/TranslationProvider are). On the AFTER build
 * this selects a narrow slice; on main it consumes the full context (today's
 * reality) so the BEFORE number shows the cost being fixed.
 */
// Two components, picked once per build — no conditional hooks.
const SettingsProbeSelector = () => {
	settingsRenders++
	const soundEnabled = useExtensionSelector!((s: { soundEnabled?: boolean }) => s.soundEnabled ?? false)
	return <span data-testid="settings-probe">{String(soundEnabled)}</span>
}
const SettingsProbeLegacy = () => {
	settingsRenders++
	useExtensionState()
	return <span data-testid="settings-probe" />
}
const SettingsProbe = hasSelector ? SettingsProbeSelector : SettingsProbeLegacy

let messagesRenders = 0
/** Messages consumer — must keep re-rendering per token (ChatView's real need). */
const MessagesProbeSelector = () => {
	messagesRenders++
	const messages = useExtensionSelector!((s: { clineMessages?: ClineMessage[] }) => s.clineMessages)
	return <span data-testid="messages-probe">{messages?.length ?? 0}</span>
}
const MessagesProbeLegacy = () => {
	messagesRenders++
	const messages = useExtensionState().clineMessages
	return <span data-testid="messages-probe">{messages?.length ?? 0}</span>
}
const MessagesProbe = hasSelector ? MessagesProbeSelector : MessagesProbeLegacy

// ---------------------------------------------------------------------------
// Profiler bookkeeping
// ---------------------------------------------------------------------------

const commits: number[] = []
const onRender = (_id: string, _phase: string, actualDuration: number) => {
	commits.push(actualDuration)
}

describe("ExtensionStateContext streaming perf harness", () => {
	beforeEach(() => {
		legacyRenders = 0
		settingsRenders = 0
		messagesRenders = 0
		commits.length = 0
		vi.mocked(vscode.postMessage).mockClear()
	})

	it("drives 200 token updates and records per-probe render counts", () => {
		render(
			<Profiler id="harness" onRender={onRender}>
				<ExtensionStateContextProvider>
					<LegacyProbe />
					<SettingsProbe />
					<MessagesProbe />
				</ExtensionStateContextProvider>
			</Profiler>,
		)

		dispatch({ type: "state", state: seedState() })

		const baseMessages = seedMessages()
		for (let i = 1; i <= N_TOKEN_UPDATES; i++) {
			// One streamed token: the partial text of the last message grows.
			const messages = baseMessages.map((message, index) =>
				index === baseMessages.length - 1
					? { ...message, text: `answer ${"t".repeat(i)}`, partial: true }
					: message,
			)
			dispatch({ type: "state", state: { clineMessages: messages, clineMessagesSeq: i } })
		}

		const totalDuration = commits.reduce((sum, duration) => sum + duration, 0)
		const mean = totalDuration / Math.max(commits.length, 1)

		// Report (console.warn survives the silent reporter).
		const report = [
			`selector hook present: ${hasSelector}`,
			`commits: ${commits.length}`,
			`legacy-probe renders: ${legacyRenders}`,
			`settings-probe renders: ${settingsRenders}`,
			`messages-probe renders: ${messagesRenders}`,
			`total actualDuration: ${totalDuration.toFixed(2)} ms`,
			`mean per-commit: ${mean.toFixed(3)} ms`,
		].join("\n")
		console.warn(`[perf-harness]\n${report}`)

		// --- Characterization invariants (hold BEFORE and AFTER) ---
		expect(commits.length).toBeGreaterThan(0)
		// The messages consumer must observe every token.
		expect(messagesRenders).toBeGreaterThanOrEqual(N_TOKEN_UPDATES)
		// The full-context consumer still sees every store change (backwards
		// compatibility: useExtensionState semantics are unchanged).
		expect(legacyRenders).toBeGreaterThanOrEqual(N_TOKEN_UPDATES)
		if (!hasSelector) {
			// BEFORE: the settings consumer re-renders on every token too —
			// exactly the defect P1 fixes.
			expect(settingsRenders).toBeGreaterThanOrEqual(N_TOKEN_UPDATES)
		}

		// --- The P1 assertion (only meaningful on the AFTER build) ---
		if (hasSelector) {
			// A settings-only consumer must NOT re-render on token updates:
			// only its mount (+ the initial state hydration) commits.
			expect(settingsRenders).toBeLessThanOrEqual(3)
		}

		expect(report).toContain("commits")
	})
})
