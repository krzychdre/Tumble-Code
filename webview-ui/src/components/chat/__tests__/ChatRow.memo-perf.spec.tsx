/**
 * P2 perf harness + characterization test (roadmap step ③, P2: ChatRow memo
 * comparator).
 *
 * Mounts a realistic chat list (20 rows, varied message types) through the
 * REAL ChatRow — the memo'd component with its real comparator — and drives
 * 100 simulated streamed-token updates (the last message's partial text
 * grows, exactly what messageUpdated does) through the real window message
 * bus. Each row sits in its own <Profiler>, which fires only when the row's
 * subtree actually commits — a memo bail-out is invisible to it — so the
 * per-row commit counts show what the memo comparator decides.
 * fast-deep-equal is wrapped in a counting spy: on main (BEFORE) that is
 * ChatRow's comparator, so the spy counts real per-token comparator calls;
 * after P2 ChatRow stops using it and the count is zero.
 *
 * Determinism: fixed seed data, no fake timers, no network; vscode/use-sound
 * are mocked. Run on main BEFORE the comparator change and on the branch
 * AFTER; the numbers go into ai_plans/2026-09-28_p2-chatrow-targeted-comparator.md.
 *
 * The targeted comparator probe is feature-detected via dynamic import: the
 * P2 module does not exist on main (the BEFORE run), so the same file
 * measures both sides; the comparator microbenchmark falls back to
 * fast-deep-equal on main.
 */
import React, { Profiler, useCallback } from "react"
import { render, act, waitFor } from "@/utils/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useSize } from "react-use"

import type { ClineMessage, ExtensionState } from "@roo-code/types"

import { vscode } from "@src/utils/vscode"

import { ExtensionStateContextProvider, useExtensionSelector } from "@src/context/ExtensionStateContext"
import ChatRow from "../ChatRow"

import deepEqual from "fast-deep-equal"

// Counting spy around fast-deep-equal. On main this IS ChatRow's memo
// comparator, so callCount measures the per-token deep-compare work; after
// P2 ChatRow no longer imports it, so the count stays 0.
vi.mock("fast-deep-equal", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>()
	return { default: vi.fn(actual.default as (a: never, b: never) => boolean) }
})
const deepEqualSpy = vi.mocked(deepEqual)

// Render counter: useSize runs in ChatRow's own body on every render and is
// skipped entirely when the memo bails out, so counting its calls counts
// ChatRow renders. It is the only react-use import in ChatRow; useEvent
// (useScrollLifecycle) passes through untouched.
vi.mock("react-use", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>()
	return {
		...actual,
		useSize: vi.fn((element: React.ReactNode) => [element, { height: 42 }]),
	}
})
const useSizeSpy = vi.mocked(useSize as unknown as (element: React.ReactNode) => [React.ReactNode, { height: number }])

vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage: vi.fn() } }))
vi.mock("use-sound", () => ({ default: vi.fn().mockImplementation(() => [vi.fn()]) }))

type Comparator = (a: unknown, b: unknown) => boolean

// Feature detection: the targeted comparator module only exists on the AFTER
// build. The dynamic import throws (catchable) when the file is absent, so
// the same spec measures both sides of the change.
const loadTargeted = async (): Promise<Comparator | undefined> => {
	try {
		// The module path only exists on the AFTER build; the dynamic
		// specifier keeps the TS compiler from resolving it statically.
		const specifier = "../chatRowPropsEqual"
		const mod = (await import(/* @vite-ignore */ specifier)) as {
			chatRowPropsEqual?: Comparator
		}
		return mod.chatRowPropsEqual
	} catch {
		return undefined
	}
}

// ---------------------------------------------------------------------------
// Deterministic seed data
// ---------------------------------------------------------------------------

const TASK_TS = 1_000
const N_ROWS = 20
const N_TOKEN_UPDATES = 100

/** A realistic 20-row history: varied tool/say/checkpoint rows, one streaming partial at the end. */
const seedMessages = (): ClineMessage[] => {
	const messages: ClineMessage[] = [
		{ type: "say", say: "text", ts: TASK_TS, text: "Refactor the chat row memo", partial: false },
	]
	for (let i = 1; i < N_ROWS - 1; i++) {
		const kind = i % 4
		if (kind === 0) {
			messages.push({
				type: "say",
				say: "tool",
				ts: TASK_TS + i,
				text: JSON.stringify({ tool: "readFile", path: `/src/file${i}.ts`, content: "x".repeat(120) }),
				partial: false,
			})
		} else if (kind === 1) {
			messages.push({
				type: "say",
				say: "text",
				ts: TASK_TS + i,
				text: `answer ${i} ${"y".repeat(60)}`,
				partial: false,
			})
		} else if (kind === 2) {
			messages.push({ type: "say", say: "checkpoint_saved", ts: TASK_TS + i, text: `hash${i}` })
		} else {
			messages.push({
				type: "say",
				say: "user_feedback",
				ts: TASK_TS + i,
				text: `feedback ${i}`,
				partial: false,
			})
		}
	}
	// The streaming answer the tokens extend.
	messages.push({ type: "say", say: "text", ts: TASK_TS + N_ROWS, text: "", partial: true })
	return messages
}

const seedState = (clineMessages: ClineMessage[], seq: number): Partial<ExtensionState> => ({
	apiConfiguration: { apiProvider: "anthropic", apiModelId: "claude-3-5-sonnet-20241022" },
	clineMessages,
	clineMessagesSeq: seq,
	currentTaskId: "task-1",
	currentTaskItem: {
		id: "task-1",
		number: 1,
		ts: TASK_TS,
		task: "Refactor the chat row memo",
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

const dispatchState = (state: Partial<ExtensionState>) => {
	act(() => {
		window.dispatchEvent(new MessageEvent("message", { data: { type: "state", state } }))
	})
}

// ---------------------------------------------------------------------------
// The list: every row is the REAL ChatRow (its memo and its real comparator
// stay intact) inside its own <Profiler>. onRender does not fire for a memo
// bail-out, so per-row commit counts are what the comparator decided.
// ---------------------------------------------------------------------------

/** Whole-harness commit durations. */
const commits: number[] = []
const onListRender = (_id: string, _phase: string, actualDuration: number) => {
	commits.push(actualDuration)
}

const StoreBackedList = () => {
	const messages = useExtensionSelector((s: { clineMessages?: ClineMessage[] }) => s.clineMessages)
	// Stable identities, exactly like ChatView's itemContent: if these were
	// inline arrows the deep-equal memo would never hold and the measurement
	// would show a defect the real ChatView does not have.
	const onToggleExpand = useCallback(() => {}, [])
	const onHeightChange = useCallback(() => {}, [])
	const onSuggestionClick = useCallback(() => {}, [])
	const onBatchFileResponse = useCallback(() => {}, [])
	const onFollowUpUnmount = useCallback(() => {}, [])
	const lastTs = messages?.at(-1)?.ts
	return (
		<Profiler id="list" onRender={onListRender}>
			<div>
				{messages?.map((message, index) => (
					<ChatRow
						key={message.ts}
						message={message}
						isExpanded={false}
						onToggleExpand={onToggleExpand}
						lastModifiedMessage={index === (messages.length ?? 0) - 1 ? messages.at(-1) : undefined}
						isLast={message.ts === lastTs}
						onHeightChange={onHeightChange}
						isStreaming={true}
						onSuggestionClick={onSuggestionClick}
						onBatchFileResponse={onBatchFileResponse}
						onFollowUpUnmount={onFollowUpUnmount}
					/>
				))}
			</div>
		</Profiler>
	)
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const queryClient = new QueryClient({
	defaultOptions: { queries: { retry: false } },
})

describe("ChatRow memo perf harness", () => {
	beforeEach(() => {
		useSizeSpy.mockClear()
		commits.length = 0
		deepEqualSpy.mockClear()
		vi.mocked(vscode.postMessage).mockClear()
	})

	it("drives 100 token updates and counts non-streaming row commits", async () => {
		const targetedEqual = await loadTargeted()
		const hasTargeted = targetedEqual !== undefined

		render(
			<ExtensionStateContextProvider>
				<QueryClientProvider client={queryClient}>
					<StoreBackedList />
				</QueryClientProvider>
			</ExtensionStateContextProvider>,
		)

		const seed = seedMessages()
		const hydrationCommits = commits.length
		dispatchState(seedState(seed, 1))

		await waitFor(() => {
			// Every row rendered once for the hydrated history.
			expect(useSizeSpy.mock.calls.length).toBe(N_ROWS)
		})

		// Baseline after hydration: counters now reflect the token phase only.
		useSizeSpy.mockClear()
		commits.length = 0
		deepEqualSpy.mockClear()

		for (let i = 1; i <= N_TOKEN_UPDATES; i++) {
			// One streamed token: the partial text of the last message grows.
			const messages = seed.map((message, index) =>
				index === seed.length - 1 ? { ...message, text: `answer ${"t".repeat(i)}`, partial: true } : message,
			)
			dispatchState({ clineMessages: messages, clineMessagesSeq: i + 1 })
		}

		// useSize is called once per ChatRow render. The streaming (last) row
		// re-renders per token; the others only if their memo fails.
		const streamedTs = seed[seed.length - 1]!.ts
		const streamedRenders = useSizeSpy.mock.calls.filter((call) => {
			// useSize receives the wrapper div; its child is ChatRowContent,
			// which carries the row's own message prop.
			const wrapper = call[0] as React.ReactElement<{ children?: React.ReactElement<{ message: ClineMessage }> }>
			return wrapper.props.children?.props.message.ts === streamedTs
		}).length
		const nonStreamedRenders = useSizeSpy.mock.calls.length - streamedRenders

		const totalDuration = commits.reduce((sum, duration) => sum + duration, 0)
		const mean = totalDuration / Math.max(commits.length, 1)

		const report = [
			`targeted comparator present: ${hasTargeted}`,
			`rows: ${N_ROWS}, token updates: ${N_TOKEN_UPDATES}`,
			`non-streaming row renders during tokens: ${nonStreamedRenders}`,
			`streaming row renders during tokens: ${streamedRenders}`,
			`fast-deep-equal comparator calls during tokens: ${deepEqualSpy.mock.calls.length}`,
			`hydration commits (excluded): ${hydrationCommits + 1}`,
			`token-phase commits: ${commits.length}`,
			`token-phase total actualDuration: ${totalDuration.toFixed(2)} ms`,
			`mean per-commit: ${mean.toFixed(3)} ms`,
		].join("\n")
		console.warn(`[chatrow-perf-harness]\n${report}`)

		// --- Characterization invariants (hold BEFORE and AFTER) ---
		// The streaming row must observe every token.
		expect(streamedRenders).toBeGreaterThanOrEqual(N_TOKEN_UPDATES)
		// Non-streaming rows must never re-render on a token update — the
		// height contract depends on rows not re-rendering for other rows'
		// tokens.
		expect(nonStreamedRenders).toBe(0)

		if (!hasTargeted) {
			// BEFORE: every visible row deep-compares per token. 19 rows x 100
			// tokens, each call walking the whole props tree.
			expect(deepEqualSpy.mock.calls.length).toBeGreaterThanOrEqual((N_ROWS - 1) * N_TOKEN_UPDATES)
		} else {
			// AFTER: ChatRow no longer deep-compares anything.
			expect(deepEqualSpy.mock.calls.length).toBe(0)
		}
		expect(report).toContain("non-streaming")
	})

	// -------------------------------------------------------------------------
	// Comparator cost microbenchmark: 10k equal-props comparisons on a
	// typical row props object. This is the per-row per-token CPU cost the
	// comparator itself charges, independent of React scheduling noise.
	// -------------------------------------------------------------------------
	it("microbenchmark: 10k equal-props comparisons, deep-equal vs targeted", async () => {
		const targetedEqual = await loadTargeted()
		const hasTargeted = targetedEqual !== undefined

		const message: ClineMessage = {
			type: "say",
			say: "tool",
			ts: TASK_TS + 4,
			text: JSON.stringify({
				tool: "readFile",
				path: "/src/components/chat/ChatView.tsx",
				content: "x".repeat(1150),
			}),
			partial: false,
		}
		const meta = {
			nextTs: TASK_TS + 5,
			previousTodos: [{ id: "a", content: "Todo alpha", status: "pending" }],
			newTaskIndex: undefined,
			followedBySubtaskResult: false,
		}
		// Shared stable callback references, exactly like ChatView's
		// useStableCallback/useCallback props: fast-deep-equal (and any
		// sane comparator) treats two distinct closures as unequal.
		const onToggleExpand = () => {}
		const onHeightChange = () => {}
		const makeProps = () => ({
			message,
			isExpanded: false,
			isLast: false,
			isStreaming: true,
			supportsImages: true,
			onToggleExpand,
			onHeightChange,
			meta,
		})

		// Two equal-but-distinct props objects (the real memo input situation:
		// rebuilt per commit, equal in value).
		const a = makeProps()
		const b = makeProps()

		const N = 10_000
		const time = (fn: Comparator) => {
			const start = performance.now()
			for (let i = 0; i < N; i++) {
				if (!fn(a, b)) {
					throw new Error("comparator reported unequal for equal props")
				}
			}
			return performance.now() - start
		}

		// One timing pass is at the mercy of a GC pause or a busy CI runner,
		// which only ever adds time. Interleave several rounds and keep each
		// side's best, so both comparators are measured under the same load.
		const ROUNDS = 7
		const deepComparator: Comparator = (x, y) => deepEqualSpy.getMockImplementation()!(x, y)
		let deepMs = Number.POSITIVE_INFINITY
		let targetedMs = targetedEqual ? Number.POSITIVE_INFINITY : Number.NaN
		for (let round = 0; round < ROUNDS; round++) {
			deepMs = Math.min(deepMs, time(deepComparator))
			if (targetedEqual) {
				targetedMs = Math.min(targetedMs, time(targetedEqual))
			}
		}

		const report = [
			`targeted comparator present: ${hasTargeted}`,
			`${N} comparisons (best of ${ROUNDS}), deep-equal: ${deepMs.toFixed(2)} ms (${(deepMs / N).toFixed(4)} ms/call)`,
			targetedEqual
				? `${N} comparisons, targeted:   ${targetedMs.toFixed(2)} ms (${(targetedMs / N).toFixed(4)} ms/call)`
				: `${N} comparisons, targeted:   n/a (module absent on main)`,
			targetedEqual ? `ratio deep/targeted: ${(deepMs / Math.max(targetedMs, 1e-6)).toFixed(1)}x` : "",
		]
			.filter(Boolean)
			.join("\n")
		console.warn(`[chatrow-comparator-bench]\n${report}`)

		// On the AFTER build the targeted comparator must not be slower than
		// deep-equal on equal props (the case that runs per token per row).
		if (targetedEqual) {
			expect(targetedMs).toBeLessThanOrEqual(deepMs)
		}
		expect(report).toContain("deep-equal")
	})
})
