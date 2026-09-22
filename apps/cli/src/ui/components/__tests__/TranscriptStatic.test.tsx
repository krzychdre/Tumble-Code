import { EventEmitter } from "events"
import { Box, Static, render } from "ink"
import stringWidth from "string-width"

import type { StaticItem } from "../../transcript.js"
import type { TUIMessage } from "../../types.js"
import AssistantMessage from "../messages/AssistantMessage.js"
import TranscriptStatic from "../TranscriptStatic.js"

// Two paragraphs of a real GLM-5.3 answer (task 01a0ca1c) that ink printed
// 201 and 202 columns wide into a 200-column terminal.
const ANSWER =
	'Rejestry 30613–30619 znajdują się w sekcji 5.3 dokumentu ([`v29.txt`](Modbus_reference_documentation/v29.txt:1874)), czyli w tabeli **„Hybrid inverter (including DC Charger and ESS) running information"** — są to rejestry wejściowe (input, RO, odczyt funkcją 04), dostępne tylko pod poprawnym adresem Modbus konkretnego falownika (1–246, konfigurowanym w MySigen APP). Do dokumentu trafiły w wersji V2.6 (2025-03-31) jako „power adjustment related registers feedback value" ([`v29.txt`](Modbus_reference_documentation/v29.txt:212)).\n\nRejestr 30279 pochodzi z sekcji 5.1 — **tabeli 5-1 „Plant running information"** ([`v29.txt`](Modbus_reference_documentation/v29.txt:1059)), więc czyta się go wyłącznie przez adres slave 247 („plant address", [`v29.txt`](Modbus_reference_documentation/v29.txt:601)). Dodano go w V2.7 (2025-05-23, [`v29.txt`](Modbus_reference_documentation/v29.txt:227)). „Current control command value" to U16 z gain 100, podawany w **procentach** — raportuje aktualnie aktywną komendę ograniczenia/sterowania wydajnością. Komentarz w dokumentacji mówi wprost: **„Use of Remote Output Control in Japan"**, czyli jest to rejestr powiązany z japońskim schematem zdalnego ograniczania wyjścia (curtailment) zarządzanym przez operatora/agregatora — odczyt mówi, na jaki poziom procentowy system jest obecnie stłumiony. W konwencji scalingu dokumentu wartość surowa 6000 oznacza 60,00%.'

const COLUMNS = 200

class FakeStdout extends EventEmitter {
	columns = COLUMNS
	rows = 50
	isTTY = true
	output = ""
	write(chunk: string) {
		this.output += chunk
		return true
	}
}

// eslint-disable-next-line no-control-regex
const stripAnsi = (text: string) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")

async function printedRowWidths(node: React.ReactElement): Promise<number[]> {
	const stdout = new FakeStdout()
	const instance = render(node, {
		stdout: stdout as unknown as NodeJS.WriteStream,
		patchConsole: false,
	})
	await new Promise((resolve) => setTimeout(resolve, 50))
	instance.unmount()
	return stripAnsi(stdout.output)
		.split("\n")
		.map((row) => stringWidth(row))
}

const message: TUIMessage = { id: "answer", role: "assistant", content: ANSWER }
const items: StaticItem[] = [{ id: "answer", kind: "message", message, expanded: false }]

describe("TranscriptStatic", () => {
	it("control: a bare <Static> prints this answer wider than the terminal", async () => {
		// Guards the fixture: if ink ever bounds <Static> itself, this starts
		// failing and the explicit width in TranscriptStatic can go.
		const widths = await printedRowWidths(
			<Static items={items}>
				{(item) => (
					<Box key={item.id}>
						<AssistantMessage content={ANSWER} />
					</Box>
				)}
			</Static>,
		)

		expect(Math.max(...widths)).toBeGreaterThan(COLUMNS)
	})

	it("never prints a row wider than the terminal", async () => {
		const widths = await printedRowWidths(<TranscriptStatic items={items} columns={COLUMNS} />)

		expect(widths.filter((width) => width > 0).length).toBeGreaterThan(5)
		expect(Math.max(...widths)).toBeLessThanOrEqual(COLUMNS)
	})
})
