import { render } from "ink-testing-library"

import type { CliModelSettings } from "@/types/types.js"

import { figures } from "../../figures.js"
import ModelPicker, { type ModelPickerProps } from "../ModelPicker.js"

const { bullet } = figures

/** Longer than ink's 20 ms wait before it reports a lone ESC byte as Escape. */
function settle(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 60))
}

/** Wait until `assertion` holds; a selection change re-renders in a task React schedules. */
function until(assertion: () => void): Promise<void> {
	return vi.waitFor(assertion, { timeout: 10_000, interval: 5 })
}

const DOWN = "\x1b[B"
const UP = "\x1b[A"
const ENTER = "\r"

const MODELS: Record<string, CliModelSettings> = {
	"GLM-5.3-NVFP4": { reasoningEffort: "max", contextWindow: 262_144 },
	"Qwen3.8-27B": { contextWindow: 262_144 },
	"Qwen3.8-4B": { modelSize: "compact" },
}

function renderPicker(overrides: Partial<ModelPickerProps> = {}) {
	const calls = { selected: [] as string[], closed: 0 }
	const view = render(
		<ModelPicker
			mode="code"
			currentModel="Qwen3.8-27B"
			models={MODELS}
			onSelect={(model) => calls.selected.push(model)}
			onClose={() => calls.closed++}
			{...overrides}
		/>,
	)
	return { ...view, calls }
}

/** The row of `model` in the frame. */
function rowOf(frame: string, model: string): string {
	return frame.split("\n").find((row) => row.includes(`${model} `) || row.includes(`${model}│`)) ?? ""
}

describe("ModelPicker", () => {
	it("names the mode and shows every model with its details, the current one marked and highlighted", () => {
		const frame = renderPicker().lastFrame() ?? ""

		expect(frame).toContain("Model for code mode")
		expect(rowOf(frame, "GLM-5.3-NVFP4")).toContain("GLM-5.3-NVFP4 (reasoning max, 262,144 tokens)")
		expect(rowOf(frame, "Qwen3.8-4B")).toContain("Qwen3.8-4B (compact)")

		const current = rowOf(frame, "Qwen3.8-27B")
		expect(current).toContain(`❯ ${bullet} Qwen3.8-27B (262,144 tokens)`)
		expect(rowOf(frame, "GLM-5.3-NVFP4")).not.toContain(bullet)
		expect(frame).toContain("enter switch · esc close")
	})

	it("lists a current model that has no entry", () => {
		const frame = renderPicker({ currentModel: "gpt-oss-120b" }).lastFrame() ?? ""

		expect(rowOf(frame, "gpt-oss-120b")).toContain(`❯ ${bullet} gpt-oss-120b (no entry in models)`)
	})

	it("moves with the arrows and picks the highlighted model with Enter", async () => {
		const { stdin, lastFrame, calls } = renderPicker()

		stdin.write(DOWN)
		await until(() => expect(rowOf(lastFrame() ?? "", "Qwen3.8-4B")).toContain("❯"))

		stdin.write(UP)
		stdin.write(UP)
		await until(() => expect(rowOf(lastFrame() ?? "", "GLM-5.3-NVFP4")).toContain("❯"))

		stdin.write(ENTER)
		await until(() => expect(calls.selected).toEqual(["GLM-5.3-NVFP4"]))
		expect(calls.closed).toBe(0)
	})

	it("hands the current model back on Enter right away; the caller decides that means no change", async () => {
		const { stdin, calls } = renderPicker()

		stdin.write(ENTER)
		await until(() => expect(calls.selected).toEqual(["Qwen3.8-27B"]))
	})

	it("closes on Esc without picking", async () => {
		const { stdin, calls } = renderPicker()

		stdin.write("\x1b")
		await until(() => expect(calls.closed).toBe(1))
		expect(calls.selected).toEqual([])
	})

	it("ignores every key while inactive (a dialog came up over it)", async () => {
		const { stdin, calls } = renderPicker({ isActive: false })

		stdin.write(DOWN)
		stdin.write(ENTER)
		stdin.write("\x1b")
		await settle()

		expect(calls).toEqual({ selected: [], closed: 0 })
	})
})
