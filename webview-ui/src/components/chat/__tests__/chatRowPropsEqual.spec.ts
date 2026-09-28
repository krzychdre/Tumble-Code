// pnpm --filter @roo-code/vscode-webview test src/components/chat/__tests__/chatRowPropsEqual.spec.ts

import type { ClineMessage, TodoItem } from "@roo-code/types"

import type { RowMetaEntry } from "../rows/computeRowMeta"
import { chatRowPropsEqual } from "../chatRowPropsEqual"
import type { ChatRowProps } from "../chatRowProps"

const message = (overrides: Partial<ClineMessage> = {}): ClineMessage =>
	({
		type: "say",
		say: "text",
		ts: 1,
		text: "hello",
		partial: false,
		...overrides,
	}) as ClineMessage

// Shared empty todos, exactly like computeRowMeta's NO_TODOS constant: the
// comparator compares previousTodos by reference.
const NO_TODOS: TodoItem[] = []

const meta = (overrides: Partial<RowMetaEntry> = {}): RowMetaEntry => ({
	nextTs: 2,
	previousTodos: NO_TODOS,
	newTaskIndex: undefined,
	followedBySubtaskResult: false,
	...overrides,
})

const todos: TodoItem[] = [{ id: "a", content: "Todo alpha", status: "pending" }]

// Shared stable callbacks, exactly like ChatView's useStableCallback /
// useCallback props: the comparator compares them by reference.
const onToggleExpand = (_ts: number, _expand?: boolean) => {}
const onHeightChange = (_isTaller: boolean) => {}
const onSuggestionClick = () => {}
const onBatchFileResponse = () => {}
const onFollowUpUnmount = () => {}
const onJumpToPreviousCheckpoint = () => {}

const baseProps = (): ChatRowProps => ({
	message: message(),
	lastModifiedMessage: undefined,
	isExpanded: false,
	isLast: false,
	isStreaming: false,
	supportsImages: true,
	onToggleExpand,
	onHeightChange,
	onSuggestionClick,
	onBatchFileResponse,
	onFollowUpUnmount,
	isFollowUpAnswered: false,
	isFollowUpAutoApprovalPaused: false,
	onJumpToPreviousCheckpoint,
	meta: meta(),
})

describe("chatRowPropsEqual", () => {
	it("returns true for the same reference", () => {
		const props = baseProps()
		expect(chatRowPropsEqual(props, props)).toBe(true)
	})

	it("returns true when only untracked object identity changed but tracked fields are equal", () => {
		// The real situation per streamed token: computeRowMeta builds fresh
		// meta entry objects, and the props container is rebuilt, but every
		// tracked field holds.
		const a = baseProps()
		const b = baseProps()
		b.meta = meta() // equal fields, different object
		expect(chatRowPropsEqual(a, b)).toBe(true)
	})

	it("returns true for messages with equal ts/text/partial but different references", () => {
		// consolidateCommands rebuilds command rows per recompute; the memo
		// must hold when the text did not change.
		const a = baseProps()
		const b = baseProps()
		b.message = message({ text: "hello" })
		expect(chatRowPropsEqual(a, b)).toBe(true)
	})

	it("is stable across calls (pure)", () => {
		const a = baseProps()
		const b = baseProps()
		expect(chatRowPropsEqual(a, b)).toBe(true)
		expect(chatRowPropsEqual(a, b)).toBe(true)
		expect(chatRowPropsEqual(b, a)).toBe(true)
	})

	describe("tracked fields flip to unequal", () => {
		it.each([
			["message.ts", (p: ChatRowProps) => (p.message = message({ ts: 99 }))],
			["message.text", (p: ChatRowProps) => (p.message = message({ text: "changed" }))],
			["message.partial", (p: ChatRowProps) => (p.message = message({ partial: true }))],
			["lastModifiedMessage", (p: ChatRowProps) => (p.lastModifiedMessage = message({ ts: 2 }))],
			["isExpanded", (p: ChatRowProps) => (p.isExpanded = true)],
			["isLast", (p: ChatRowProps) => (p.isLast = true)],
			["isStreaming", (p: ChatRowProps) => (p.isStreaming = true)],
			["supportsImages", (p: ChatRowProps) => (p.supportsImages = false)],
			["onToggleExpand", (p: ChatRowProps) => (p.onToggleExpand = () => {})],
			["onHeightChange", (p: ChatRowProps) => (p.onHeightChange = () => {})],
			["onSuggestionClick", (p: ChatRowProps) => (p.onSuggestionClick = () => {})],
			["onBatchFileResponse", (p: ChatRowProps) => (p.onBatchFileResponse = () => {})],
			["onFollowUpUnmount", (p: ChatRowProps) => (p.onFollowUpUnmount = () => {})],
			["isFollowUpAnswered", (p: ChatRowProps) => (p.isFollowUpAnswered = true)],
			["isFollowUpAutoApprovalPaused", (p: ChatRowProps) => (p.isFollowUpAutoApprovalPaused = true)],
			["onJumpToPreviousCheckpoint", (p: ChatRowProps) => (p.onJumpToPreviousCheckpoint = () => {})],
		])("%s", (_name, mutate) => {
			const a = baseProps()
			const b = baseProps()
			mutate(b)
			expect(chatRowPropsEqual(a, b)).toBe(false)
		})
	})

	describe("meta comparison", () => {
		it("treats both-undefined meta as equal", () => {
			const a = baseProps()
			const b = baseProps()
			a.meta = undefined
			b.meta = undefined
			expect(chatRowPropsEqual(a, b)).toBe(true)
		})

		it("treats one-sided undefined meta as unequal", () => {
			const a = baseProps()
			const b = baseProps()
			a.meta = undefined
			expect(chatRowPropsEqual(a, b)).toBe(false)
			expect(chatRowPropsEqual(b, a)).toBe(false)
		})

		it("compares previousTodos by reference: deep-equal content is not enough", () => {
			const a = baseProps()
			const b = baseProps()
			a.meta = meta({ previousTodos: todos })
			b.meta = meta({ previousTodos: [{ id: "a", content: "Todo alpha", status: "pending" }] })
			expect(chatRowPropsEqual(a, b)).toBe(false)
		})

		it("holds when previousTodos is the same reference in a rebuilt meta entry", () => {
			// parseToolCached returns the cached todos array, so a recompute
			// hands the row a fresh meta entry with the same todos reference.
			const a = baseProps()
			const b = baseProps()
			a.meta = meta({ previousTodos: todos })
			b.meta = meta({ previousTodos: todos })
			expect(chatRowPropsEqual(a, b)).toBe(true)
		})

		it.each([
			["nextTs", (m: RowMetaEntry) => ((m.nextTs = 42), m)],
			["newTaskIndex", (m: RowMetaEntry) => ((m.newTaskIndex = 3), m)],
			["followedBySubtaskResult", (m: RowMetaEntry) => ((m.followedBySubtaskResult = true), m)],
		])("goes unequal when %s changes", (_name, mutate) => {
			const a = baseProps()
			const b = baseProps()
			b.meta = mutate(meta())
			expect(chatRowPropsEqual(a, b)).toBe(false)
		})
	})
})
