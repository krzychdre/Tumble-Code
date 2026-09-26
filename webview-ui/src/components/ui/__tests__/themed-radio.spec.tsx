import React from "react"

import { fireEvent, render, screen } from "@/utils/test-utils"

import { ThemedRadio, ThemedRadioGroup } from "../themed-radio"

const Group = ({
	value,
	onChange,
	disabled,
}: {
	value: string
	onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
	disabled?: boolean
}) => (
	<ThemedRadioGroup value={value} onChange={onChange} disabled={disabled}>
		<ThemedRadio value="global">
			Global
			<div>Available everywhere</div>
		</ThemedRadio>
		<ThemedRadio value="project">Project</ThemedRadio>
	</ThemedRadioGroup>
)

describe("ThemedRadioGroup / ThemedRadio", () => {
	it("is a radio group whose options are named by their labels and share one name", () => {
		render(<Group value="global" onChange={() => {}} />)

		expect(screen.getByRole("radiogroup")).toHaveAttribute("data-orientation", "horizontal")
		const global = screen.getByRole("radio", { name: /Global/ }) as HTMLInputElement
		const project = screen.getByRole("radio", { name: "Project" }) as HTMLInputElement
		expect(global.checked).toBe(true)
		expect(project.checked).toBe(false)
		expect(global.name).toBe(project.name)
		expect(global.name).not.toBe("")
	})

	it("reports the chosen value through e.target.value, also for a click on the label text", () => {
		const seen: string[] = []
		render(<Group value="global" onChange={(e) => seen.push(e.target.value)} />)

		fireEvent.click(screen.getByText("Project"))

		expect(seen).toEqual(["project"])
	})

	it("does not call onChange when only the value prop changes", () => {
		const onChange = vi.fn()
		const { rerender } = render(<Group value="global" onChange={onChange} />)

		rerender(<Group value="project" onChange={onChange} />)

		expect(onChange).not.toHaveBeenCalled()
		expect((screen.getByRole("radio", { name: "Project" }) as HTMLInputElement).checked).toBe(true)
	})

	it("keeps showing the value prop when the call site ignores a click", () => {
		render(<Group value="global" onChange={() => {}} />)

		fireEvent.click(screen.getByRole("radio", { name: "Project" }))

		expect((screen.getByRole("radio", { name: /Global/ }) as HTMLInputElement).checked).toBe(true)
	})

	it("a disabled group disables its options and dims them", () => {
		render(<Group value="global" onChange={() => {}} disabled />)

		const project = screen.getByRole("radio", { name: "Project" })
		expect(project).toBeDisabled()
		expect(project.closest("label")).toHaveAttribute("data-disabled")
	})
})
