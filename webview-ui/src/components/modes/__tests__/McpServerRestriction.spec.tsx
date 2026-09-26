import { act, fireEvent, render, screen } from "@/utils/test-utils"

import type { McpServer } from "@roo-code/types"

import { McpServerRestrictionImpl as McpServerRestriction } from "../McpServerRestriction"

const servers = [{ name: "a" }, { name: "b" }] as McpServer[]

type Props = { slug?: string; value: string[] | undefined; onChange: (next: string[] | undefined) => void }

const view = ({ slug = "code", value, onChange }: Props) => (
	<McpServerRestriction slug={slug} value={value} mcpServers={servers} onChange={onChange} />
)

const toggle = () => screen.getByTestId("restrict-mcp-servers-toggle") as HTMLInputElement
const server = (name: string) => screen.getByTestId(`mcp-server-checkbox-${name}`) as HTMLInputElement

describe("McpServerRestriction", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it("does not persist anything on mount", () => {
		const onChange = vi.fn()
		render(view({ value: ["a"], onChange }))
		act(() => vi.advanceTimersByTime(1000))
		expect(onChange).not.toHaveBeenCalled()
		expect(server("a").checked).toBe(true)
	})

	it("persists a local edit 150 ms after the last change, once", () => {
		const onChange = vi.fn()
		render(view({ value: [], onChange }))

		fireEvent.click(server("a"))
		act(() => vi.advanceTimersByTime(100))
		fireEvent.click(server("b"))
		act(() => vi.advanceTimersByTime(149))
		expect(onChange).not.toHaveBeenCalled()
		act(() => vi.advanceTimersByTime(1))
		expect(onChange).toHaveBeenCalledTimes(1)
		expect(onChange).toHaveBeenCalledWith(["a", "b"])
	})

	it("calls the latest onChange when the debounce fires", () => {
		const first = vi.fn()
		const latest = vi.fn()
		const { rerender } = render(view({ value: undefined, onChange: first }))

		fireEvent.click(toggle())
		rerender(view({ value: undefined, onChange: latest }))
		act(() => vi.advanceTimersByTime(150))
		expect(first).not.toHaveBeenCalled()
		expect(latest).toHaveBeenCalledWith([])
	})

	it("keeps a second edit made before the host echoed the first flush (no snap-back)", () => {
		const onChange = vi.fn()
		render(view({ value: [], onChange }))

		fireEvent.click(server("a"))
		act(() => vi.advanceTimersByTime(150))
		expect(onChange).toHaveBeenLastCalledWith(["a"])

		// The host has not sent the new value back yet; the prop is still [].
		fireEvent.click(server("b"))
		expect(server("a").checked).toBe(true)
		expect(server("b").checked).toBe(true)
		act(() => vi.advanceTimersByTime(150))
		expect(onChange).toHaveBeenLastCalledWith(["a", "b"])
		expect(onChange).toHaveBeenCalledTimes(2)
	})

	it("does not persist again when the host echoes the flushed value", () => {
		const onChange = vi.fn()
		const { rerender } = render(view({ value: [], onChange }))

		fireEvent.click(server("a"))
		act(() => vi.advanceTimersByTime(150))
		rerender(view({ value: ["a"], onChange }))
		act(() => vi.advanceTimersByTime(1000))
		expect(onChange).toHaveBeenCalledTimes(1)
		expect(server("a").checked).toBe(true)
	})

	it("takes an external edit of the value and does not write it back", () => {
		const onChange = vi.fn()
		const { rerender } = render(view({ value: ["a"], onChange }))

		rerender(view({ value: ["b"], onChange }))
		expect(server("a").checked).toBe(false)
		expect(server("b").checked).toBe(true)
		act(() => vi.advanceTimersByTime(1000))
		expect(onChange).not.toHaveBeenCalled()
	})

	it("an external edit arriving while a local edit is pending wins and cancels the flush", () => {
		const onChange = vi.fn()
		const { rerender } = render(view({ value: [], onChange }))

		fireEvent.click(server("a"))
		act(() => vi.advanceTimersByTime(100))
		rerender(view({ value: ["b"], onChange }))
		act(() => vi.advanceTimersByTime(1000))
		expect(onChange).not.toHaveBeenCalled()
		expect(server("a").checked).toBe(false)
		expect(server("b").checked).toBe(true)
	})

	it("reseeds from the props on a mode switch without persisting", () => {
		const onChange = vi.fn()
		const { rerender } = render(view({ slug: "code", value: ["a"], onChange }))

		rerender(view({ slug: "architect", value: undefined, onChange }))
		expect(toggle().checked).toBe(false)
		act(() => vi.advanceTimersByTime(1000))
		expect(onChange).not.toHaveBeenCalled()
	})
})
