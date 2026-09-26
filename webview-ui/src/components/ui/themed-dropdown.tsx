import * as React from "react"

import { cn } from "@/lib/utils"

/** What `ThemedDropdown` passes to `onChange`: `e.target.value` is the chosen option's value. */
export type ThemedDropdownChangeEvent = { target: { value: string } }

export interface ThemedOptionProps {
	value: string
	/** The option's label; its text is also what the closed dropdown shows. */
	children?: React.ReactNode
	/** Classes for the option row in the open list (the call sites set its padding). */
	className?: string
	disabled?: boolean
}

/**
 * One option of a `ThemedDropdown` (replaces the toolkit's `VSCodeOption`).
 * The dropdown reads its props and renders it; on its own it renders nothing.
 */
const ThemedOption = (_props: ThemedOptionProps) => null
ThemedOption.displayName = "ThemedOption"

export interface ThemedDropdownProps
	extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange" | "defaultValue" | "children"> {
	/** The chosen option's value. When no option has it, the first option is shown. */
	value?: string
	/** Fires when the user commits another option; `e.target.value` is its value. */
	onChange?: (event: ThemedDropdownChangeEvent) => void
	disabled?: boolean
	/** `ThemedOption` elements (arrays from `.map` are fine). */
	children?: React.ReactNode
}

/** The text of a node tree, whitespace collapsed like the toolkit's `option.text`. */
const textOf = (node: React.ReactNode): string => {
	const parts: string[] = []
	const walk = (n: React.ReactNode) => {
		if (n === null || n === undefined || typeof n === "boolean") return
		if (typeof n === "string" || typeof n === "number") {
			parts.push(String(n))
		} else if (Array.isArray(n)) {
			n.forEach(walk)
		} else if (React.isValidElement<{ children?: React.ReactNode }>(n)) {
			walk(n.props.children)
		}
	}
	walk(node)
	return parts.join("").replace(/\s+/g, " ").trim()
}

const TYPEAHEAD_TIMEOUT_MS = 1000
const LIST_MAX_HEIGHT = 200

/**
 * A single-choice dropdown with VS Code's look, the replacement for the
 * deprecated toolkit's `VSCodeDropdown` (use with `ThemedOption`). It keeps the
 * toolkit's behaviour:
 *
 * - the list opens below the control, or above it when there is more room
 *   there, over the following content, at most 200px high;
 * - a click on the control opens or closes the list, a click on an option
 *   picks it and closes the list, a click outside closes it;
 * - keyboard: Enter and Space open and close the list, Escape and Tab close
 *   it (Tab keeps the focus here), Arrow Up / Down, Home and End move the
 *   selection, typing selects the first option starting with the typed text;
 * - while the list is open the moves only preview the choice, and `onChange`
 *   fires once when the list closes on another option (also for Escape, as in
 *   the toolkit); on the closed dropdown every move fires `onChange` at once.
 *
 * Unlike the toolkit it always shows `value` once the list is closed: a choice
 * the call site ignores does not stick, and a change of the option list keeps
 * showing the option whose value is `value`.
 *
 * Focus stays on the control (`role="combobox"`); the highlighted option is
 * announced through `aria-activedescendant`. `className`, `style`, `id`,
 * `data-*` and `aria-*` go on the control, where the toolkit's host took them.
 * The look comes from the `.ui-dropdown` rules in `index.css`.
 */
const ThemedDropdown = React.forwardRef<HTMLDivElement, ThemedDropdownProps>(
	({ value, onChange, disabled, className, children, onClick, onKeyDown, onBlur, ...props }, ref) => {
		const baseId = React.useId()
		const listboxId = `${baseId}-listbox`
		const [open, setOpen] = React.useState(false)
		const [position, setPosition] = React.useState<"above" | "below">("below")
		// While the list is open: the previewed option and the one it opened on.
		const [activeIndex, setActiveIndex] = React.useState(-1)
		const [openedIndex, setOpenedIndex] = React.useState(-1)
		const listboxRef = React.useRef<HTMLDivElement>(null)
		const typeahead = React.useRef({ buffer: "", expired: true, timer: 0 })

		const options = React.Children.toArray(children)
			.filter((child): child is React.ReactElement<ThemedOptionProps> => React.isValidElement(child))
			.filter((child) => child.type === ThemedOption)
			.map((child) => ({ ...child.props, text: textOf(child.props.children) }))

		const valueIndex = options.findIndex((option) => option.value === value)
		const shownIndex = open ? activeIndex : valueIndex === -1 ? (options.length > 0 ? 0 : -1) : valueIndex
		const optionId = (index: number) => `${baseId}-option-${index}`

		// Keep the previewed option visible while moving through a long list.
		React.useEffect(() => {
			if (!open || activeIndex < 0) return
			listboxRef.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView?.({ block: "nearest" })
		}, [open, activeIndex])

		const commit = (index: number, from: number) => {
			if (index !== from && index >= 0 && index < options.length) {
				onChange?.({ target: { value: options[index].value } })
			}
		}

		const openList = (element: HTMLElement) => {
			const box = element.getBoundingClientRect()
			setPosition(box.top > window.innerHeight - box.bottom ? "above" : "below")
			setActiveIndex(shownIndex)
			setOpenedIndex(shownIndex)
			setOpen(true)
		}

		const closeList = (index: number) => {
			setOpen(false)
			commit(index, openedIndex)
		}

		/** The next enabled option from `from` in `step` direction, or `from` when there is none. */
		const enabledFrom = (from: number, step: 1 | -1) => {
			for (let i = from + step; i >= 0 && i < options.length; i += step) {
				if (!options[i].disabled) return i
			}
			return from
		}

		const move = (index: number) => {
			if (index === shownIndex || index < 0) return
			if (open) {
				setActiveIndex(index)
			} else {
				commit(index, shownIndex)
			}
		}

		const typeAhead = (key: string) => {
			const state = typeahead.current
			window.clearTimeout(state.timer)
			state.timer = window.setTimeout(() => {
				state.expired = true
			}, TYPEAHEAD_TIMEOUT_MS)
			state.buffer = `${state.expired ? "" : state.buffer}${key}`
			state.expired = false
			const prefix = state.buffer.toLowerCase()
			const match = options.findIndex((option) => option.text.toLowerCase().startsWith(prefix))
			if (match !== -1) move(match)
		}

		const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
			onKeyDown?.(event)
			if (disabled || event.defaultPrevented) return
			const { key } = event
			switch (key) {
				case "ArrowDown":
				case "ArrowUp":
					if (event.shiftKey) return
					event.preventDefault()
					move(enabledFrom(shownIndex, key === "ArrowDown" ? 1 : -1))
					return
				case "Home":
				case "End": {
					event.preventDefault()
					const first = key === "Home" ? enabledFrom(-1, 1) : enabledFrom(options.length, -1)
					if (first >= 0 && first < options.length) move(first)
					return
				}
				case "Enter":
					event.preventDefault()
					if (open) closeList(activeIndex)
					else openList(event.currentTarget)
					return
				case "Escape":
				case "Tab":
					if (open) {
						event.preventDefault()
						closeList(activeIndex)
					}
					return
				case " ":
					if (typeahead.current.expired) {
						event.preventDefault()
						if (open) closeList(activeIndex)
						else openList(event.currentTarget)
						return
					}
					typeAhead(key)
					return
				default:
					if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) typeAhead(key)
			}
		}

		const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
			onClick?.(event)
			if (disabled || event.defaultPrevented) return
			if (!open) {
				openList(event.currentTarget)
				return
			}
			const target = (event.target as HTMLElement).closest<HTMLElement>("[data-index]")
			if (target && event.currentTarget.contains(target)) {
				const index = Number(target.dataset.index)
				if (options[index]?.disabled) return
				closeList(index)
				return
			}
			closeList(activeIndex)
		}

		const handleBlur = (event: React.FocusEvent<HTMLDivElement>) => {
			onBlur?.(event)
			if (open && !event.currentTarget.contains(event.relatedTarget as Node | null)) {
				closeList(activeIndex)
			}
		}

		const shown = shownIndex >= 0 ? options[shownIndex] : undefined

		return (
			<div
				ref={ref}
				role="combobox"
				tabIndex={disabled ? undefined : 0}
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-controls={open ? listboxId : undefined}
				aria-activedescendant={shownIndex >= 0 ? optionId(shownIndex) : undefined}
				aria-disabled={disabled ? "true" : "false"}
				data-open={open ? "" : undefined}
				data-position={open ? position : undefined}
				data-disabled={disabled ? "" : undefined}
				className={cn("ui-dropdown", className)}
				onClick={handleClick}
				onKeyDown={handleKeyDown}
				onBlur={handleBlur}
				{...props}>
				<div className="ui-dropdown-control">
					<div className="ui-dropdown-selected-value">{shown?.text ?? ""}</div>
					<div className="ui-dropdown-indicator" aria-hidden="true">
						<svg
							width="16"
							height="16"
							viewBox="0 0 16 16"
							xmlns="http://www.w3.org/2000/svg"
							fill="currentColor">
							<path
								fillRule="evenodd"
								clipRule="evenodd"
								d="M7.976 10.072l4.357-4.357.62.618L8.284 11h-.618L3 6.333l.619-.618 4.357 4.357z"
							/>
						</svg>
					</div>
				</div>
				<div
					ref={listboxRef}
					id={listboxId}
					role="listbox"
					className="ui-dropdown-listbox"
					style={{ maxHeight: LIST_MAX_HEIGHT }}
					hidden={!open}>
					{options.map((option, index) => (
						<div
							key={`${index}-${option.value}`}
							id={optionId(index)}
							role="option"
							data-index={index}
							data-value={option.value}
							aria-selected={index === shownIndex}
							aria-disabled={option.disabled ? "true" : undefined}
							aria-posinset={index + 1}
							aria-setsize={options.length}
							className={cn("ui-dropdown-option", option.className)}>
							<span className="ui-dropdown-option-content">{option.children}</span>
						</div>
					))}
				</div>
			</div>
		)
	},
)
ThemedDropdown.displayName = "ThemedDropdown"

export { ThemedDropdown, ThemedOption }
