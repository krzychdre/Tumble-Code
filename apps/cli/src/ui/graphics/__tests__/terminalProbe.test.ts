import { EventEmitter } from "events"

import {
	chooseProtocol,
	imagesOverride,
	parseProbeReplies,
	probeTerminalGraphics,
	PROBE_QUERIES,
	TEXT_ONLY,
} from "../terminalProbe.js"

const DA1_SIXEL = "\x1b[?62;4;22c"
const DA1_PLAIN = "\x1b[?65;1;9c"

describe("parseProbeReplies", () => {
	it("is incomplete until the DA1 reply arrives", () => {
		expect(parseProbeReplies("\x1b[6;20;10t").complete).toBe(false)
		expect(parseProbeReplies(`\x1b[6;20;10t${DA1_PLAIN}`).complete).toBe(true)
	})

	it("reads sixel support from DA1 attribute 4 only", () => {
		expect(parseProbeReplies(DA1_SIXEL).sixel).toBe(true)
		// 4 as part of another number (64) is not attribute 4.
		expect(parseProbeReplies("\x1b[?64;1c").sixel).toBe(false)
		expect(parseProbeReplies(DA1_PLAIN).sixel).toBe(false)
	})

	it("recognizes the kitty graphics reply", () => {
		expect(parseProbeReplies(`\x1b_Gi=31;OK\x1b\\${DA1_PLAIN}`).kitty).toBe(true)
		expect(parseProbeReplies(`\x1b_Gi=31;ENOTSUPPORTED\x1b\\${DA1_PLAIN}`).kitty).toBe(false)
	})

	it("reads the cell size as height then width", () => {
		const replies = parseProbeReplies(`\x1b[6;19;9t${DA1_PLAIN}`)
		expect(replies).toMatchObject({ cellWidth: 9, cellHeight: 19 })
	})

	it("reads the background colour with 4 or 2 hex digits per component", () => {
		expect(parseProbeReplies("\x1b]11;rgb:1e1e/1e1e/2020\x1b\\").background).toBe("#1e1e20")
		expect(parseProbeReplies("\x1b]11;rgb:ff/80/00\x07").background).toBe("#ff8000")
	})
})

describe("chooseProtocol", () => {
	const replies = { complete: true, kitty: false, sixel: false }

	it("prefers kitty, then iTerm2, then sixel", () => {
		expect(chooseProtocol({ ...replies, kitty: true, sixel: true }, { TERM_PROGRAM: "WezTerm" })).toBe("kitty")
		expect(chooseProtocol({ ...replies, sixel: true }, { TERM_PROGRAM: "iTerm.app" })).toBe("iterm")
		expect(chooseProtocol({ ...replies, sixel: true }, {})).toBe("sixel")
		expect(chooseProtocol(replies, {})).toBeNull()
	})
})

describe("imagesOverride", () => {
	it("accepts off and the protocol names, in any case", () => {
		expect(imagesOverride({ TUMBLE_IMAGES: "OFF" })).toBe("off")
		expect(imagesOverride({ TUMBLE_IMAGES: " sixel " })).toBe("sixel")
		expect(imagesOverride({ TUMBLE_IMAGES: "auto" })).toBeUndefined()
		expect(imagesOverride({})).toBeUndefined()
	})
})

class FakeStdin extends EventEmitter {
	isTTY = true
	isRaw = false
	setRawMode(raw: boolean) {
		this.isRaw = raw
		return this
	}
	resume() {
		return this
	}
	pause() {
		return this
	}
}

class FakeStdout {
	isTTY = true
	written: string[] = []
	constructor(private readonly reply: (stdin: FakeStdin) => void = () => {}) {}
	stdin?: FakeStdin
	write(data: string) {
		this.written.push(data)
		if (this.stdin) {
			this.reply(this.stdin)
		}
		return true
	}
}

function streams(reply?: (stdin: FakeStdin) => void) {
	const stdin = new FakeStdin()
	const stdout = new FakeStdout(reply)
	stdout.stdin = stdin
	return {
		stdin,
		stdout,
		io: { stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream },
	}
}

describe("probeTerminalGraphics", () => {
	it("asks nothing when stdout is not a terminal", async () => {
		const { stdout, io } = streams()
		stdout.isTTY = false
		await expect(probeTerminalGraphics(io, {})).resolves.toEqual(TEXT_ONLY)
		expect(stdout.written).toEqual([])
	})

	it("asks nothing inside tmux unless a protocol is forced", async () => {
		const { stdout, io } = streams()
		await expect(probeTerminalGraphics(io, { TMUX: "/tmp/tmux-1000/default,1,0" })).resolves.toEqual(TEXT_ONLY)
		expect(stdout.written).toEqual([])
	})

	it("collects the replies and restores the terminal mode", async () => {
		const { stdin, stdout, io } = streams((input) => {
			// Replies may arrive split across reads.
			input.emit("data", Buffer.from("\x1b[6;18;"))
			input.emit("data", Buffer.from(`8t\x1b]11;rgb:0000/0000/0000\x1b\\${DA1_SIXEL}`))
		})

		const graphics = await probeTerminalGraphics(io, {})

		expect(stdout.written).toEqual([PROBE_QUERIES])
		expect(graphics).toEqual({
			protocol: "sixel",
			cellWidth: 8,
			cellHeight: 18,
			cellSizeKnown: true,
			background: "#000000",
		})
		expect(stdin.isRaw).toBe(false)
		expect(stdin.listenerCount("data")).toBe(0)
	})

	it("is text only when stdin cannot switch to raw mode or the probe throws", async () => {
		const noRaw = streams()
		Object.assign(noRaw.stdin, { setRawMode: undefined })
		await expect(probeTerminalGraphics(noRaw.io, {})).resolves.toEqual(TEXT_ONLY)
		expect(noRaw.stdout.written).toEqual([])

		const broken = streams()
		broken.stdout.write = () => {
			throw new Error("EPIPE")
		}
		await expect(probeTerminalGraphics(broken.io, {})).resolves.toEqual(TEXT_ONLY)
		expect(broken.stdin.isRaw).toBe(false)
		expect(broken.stdin.listenerCount("data")).toBe(0)
	})

	it("gives up after the timeout when the terminal does not answer", async () => {
		const { io } = streams()
		await expect(probeTerminalGraphics(io, {}, 10)).resolves.toEqual({ ...TEXT_ONLY, background: undefined })
	})

	it("lets TUMBLE_IMAGES force a protocol the terminal does not report", async () => {
		const { io } = streams((input) => input.emit("data", DA1_PLAIN))
		await expect(probeTerminalGraphics(io, { TUMBLE_IMAGES: "kitty" })).resolves.toMatchObject({
			protocol: "kitty",
		})
	})
})
