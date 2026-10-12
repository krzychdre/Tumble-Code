/**
 * What the terminal can draw besides text (plan: 2026-10-12 cli inline images).
 *
 * Three image protocols are in use today, and a terminal supports any subset:
 *
 * - kitty: kitty, Ghostty, WezTerm, Konsole. PNG in, full colour, alpha.
 * - iterm: iTerm2, WezTerm, the VS Code terminal. Any image file in.
 * - sixel: xterm, foot, the VS Code terminal. A palette bitmap the program
 *   encodes itself.
 *
 * GNOME Terminal and Ptyxis draw no images: VTE 0.84 stubbed its sixel code
 * out, and GNOME Terminal's `enable-sixel` profile key does nothing.
 *
 * Most of this is asked of the terminal, not guessed from the environment:
 * the probe writes a few queries and reads the answers from stdin before ink
 * takes the terminal over. Every terminal answers the last query (Primary
 * Device Attributes, DA1), so its answer marks the end of the replies; a
 * terminal that ignores a query simply never answers it.
 */

export type ImageProtocol = "kitty" | "iterm" | "sixel"

export interface TerminalGraphics {
	/** How images are drawn, or null when only text is possible. */
	protocol: ImageProtocol | null
	/** Size of one character cell in pixels. */
	cellWidth: number
	cellHeight: number
	/**
	 * The terminal reported the cell size; without it the cell size is a
	 * guess, and the rows an image covers are not known in advance. xterm, for
	 * one, keeps the query switched off (its `allowWindowOps` resource).
	 */
	cellSizeKnown: boolean
	/** Background colour as `#rrggbb`, when the terminal reported it. */
	background?: string
	/**
	 * Sixel only: the largest image the terminal accepts, in pixels. Larger
	 * images are cut off, not scaled (xterm: 1000x1000 by default).
	 */
	maxImage?: { width: number; height: number }
	/** Sixel only: the colour registers, i.e. the most colours one image may use. */
	colors?: number
}

/** Assumed cell size when the terminal does not report one. */
export const DEFAULT_CELL = { width: 10, height: 20 }

/** Graphics off: what every non-interactive run and every unknown terminal gets. */
export const TEXT_ONLY: TerminalGraphics = {
	protocol: null,
	cellWidth: DEFAULT_CELL.width,
	cellHeight: DEFAULT_CELL.height,
	cellSizeKnown: false,
}

/** The id the kitty query uses; the reply echoes it. */
const KITTY_QUERY_ID = 31

/**
 * The queries, in the order written. DA1 must stay last: its reply is the
 * signal that the terminal has answered everything it is going to answer.
 *
 * - kitty graphics query: a one-pixel image the terminal checks but does not
 *   store (`a=q`); kitty-protocol terminals reply `OK`.
 * - `CSI 16 t`: the cell size in pixels, replied as `CSI 6 ; h ; w t`.
 * - `OSC 11 ?`: the background colour, replied as `OSC 11 ; rgb:rrrr/gggg/bbbb`.
 * - XTSMGRAPHICS `CSI ? 1 ; 1 ; 0 S` and `CSI ? 2 ; 1 ; 0 S`: the sixel colour
 *   registers and the largest sixel image, replied as `CSI ? 1 ; 0 ; n S` and
 *   `CSI ? 2 ; 0 ; w ; h S`.
 * - `CSI c` (DA1): `CSI ? 62 ; 4 ; ... c`, where attribute 4 means sixel.
 */
export const PROBE_QUERIES =
	`\x1b_Gi=${KITTY_QUERY_ID},s=1,v=1,a=q,t=d,f=24;AAAA\x1b\\` +
	"\x1b[16t" +
	"\x1b]11;?\x1b\\" +
	"\x1b[?1;1;0S" +
	"\x1b[?2;1;0S" +
	"\x1b[c"

export interface ProbeReplies {
	/** The DA1 reply arrived, so nothing more will. */
	complete: boolean
	kitty: boolean
	sixel: boolean
	cellWidth?: number
	cellHeight?: number
	background?: string
	maxImage?: { width: number; height: number }
	colors?: number
}

const KITTY_REPLY_RE = new RegExp(`\\x1b_Gi=${KITTY_QUERY_ID};OK`)
// eslint-disable-next-line no-control-regex
const CELL_SIZE_RE = /\x1b\[6;(\d+);(\d+)t/
// eslint-disable-next-line no-control-regex
const BACKGROUND_RE = /\x1b\]11;rgb:([0-9a-fA-F]{1,4})\/([0-9a-fA-F]{1,4})\/([0-9a-fA-F]{1,4})/
// eslint-disable-next-line no-control-regex
const SIXEL_COLORS_RE = /\x1b\[\?1;0;(\d+)S/
// eslint-disable-next-line no-control-regex
const SIXEL_GEOMETRY_RE = /\x1b\[\?2;0;(\d+);(\d+)S/
// eslint-disable-next-line no-control-regex
const DA1_RE = /\x1b\[\?([\d;]*)c/

/** One `rgb:` component (1 to 4 hex digits, scaled to that many) as two hex digits. */
function colorByte(component: string): string {
	const max = 16 ** component.length - 1
	return Math.round((parseInt(component, 16) / max) * 255)
		.toString(16)
		.padStart(2, "0")
}

/** Read whatever replies `data` holds so far. */
export function parseProbeReplies(data: string): ProbeReplies {
	const da1 = data.match(DA1_RE)
	const cell = data.match(CELL_SIZE_RE)
	const bg = data.match(BACKGROUND_RE)

	const replies: ProbeReplies = {
		complete: da1 !== null,
		kitty: KITTY_REPLY_RE.test(data),
		sixel: da1?.[1]?.split(";").includes("4") ?? false,
	}

	const height = Number(cell?.[1])
	const width = Number(cell?.[2])
	if (width > 0 && height > 0) {
		replies.cellWidth = width
		replies.cellHeight = height
	}

	if (bg?.[1] && bg[2] && bg[3]) {
		replies.background = `#${colorByte(bg[1])}${colorByte(bg[2])}${colorByte(bg[3])}`
	}

	const colors = Number(data.match(SIXEL_COLORS_RE)?.[1])
	if (colors > 0) {
		replies.colors = colors
	}

	const geometry = data.match(SIXEL_GEOMETRY_RE)
	const maxWidth = Number(geometry?.[1])
	const maxHeight = Number(geometry?.[2])
	if (maxWidth > 0 && maxHeight > 0) {
		replies.maxImage = { width: maxWidth, height: maxHeight }
	}

	return replies
}

/**
 * `TUMBLE_IMAGES`: `off` turns images off, a protocol name forces it (for a
 * terminal that supports it but does not say so, or one behind a multiplexer
 * that passes it through), anything else means detect.
 */
export function imagesOverride(env: NodeJS.ProcessEnv): ImageProtocol | "off" | undefined {
	const value = env.TUMBLE_IMAGES?.trim().toLowerCase()
	return value === "off" || value === "kitty" || value === "iterm" || value === "sixel" ? value : undefined
}

/**
 * tmux and screen swallow image sequences unless told to pass them through,
 * and their replies describe the multiplexer, not the terminal around it.
 */
function insideMultiplexer(env: NodeJS.ProcessEnv): boolean {
	return Boolean(env.TMUX || env.STY) || /^(screen|tmux)/.test(env.TERM ?? "")
}

/** iTerm2's protocol has no query; the terminals that speak it name themselves. */
function speaksIterm(env: NodeJS.ProcessEnv): boolean {
	return env.TERM_PROGRAM === "iTerm.app" || env.LC_TERMINAL === "iTerm2" || env.TERM_PROGRAM === "WezTerm"
}

/**
 * The protocol to use given the replies. kitty first (true colour and the
 * cheapest to send), then iTerm2, then sixel. The VS Code terminal answers
 * DA1 with sixel only when its `terminal.integrated.enableImages` setting is
 * on, which is also when its iTerm2 support works, so it lands on sixel.
 */
export function chooseProtocol(replies: ProbeReplies, env: NodeJS.ProcessEnv): ImageProtocol | null {
	if (replies.kitty) {
		return "kitty"
	}
	if (speaksIterm(env)) {
		return "iterm"
	}
	return replies.sixel ? "sixel" : null
}

interface ProbeStreams {
	stdin: NodeJS.ReadStream
	stdout: NodeJS.WriteStream
}

/**
 * Ask the terminal what it can draw. Resolves within `timeoutMs` whatever
 * the terminal does; a terminal that does not answer at all is text only.
 * Never rejects: images are an extra, and a failed probe must not keep the
 * TUI from starting.
 */
export async function probeTerminalGraphics(
	{ stdin, stdout }: ProbeStreams,
	env: NodeJS.ProcessEnv = process.env,
	timeoutMs = 400,
): Promise<TerminalGraphics> {
	const override = imagesOverride(env)
	if (override === "off" || !stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== "function") {
		return TEXT_ONLY
	}
	if (insideMultiplexer(env) && !override) {
		return TEXT_ONLY
	}

	let replies: ProbeReplies
	try {
		replies = await readReplies(stdin, stdout, timeoutMs)
	} catch {
		return TEXT_ONLY
	}

	return {
		protocol: override ?? chooseProtocol(replies, env),
		cellWidth: replies.cellWidth ?? DEFAULT_CELL.width,
		cellHeight: replies.cellHeight ?? DEFAULT_CELL.height,
		cellSizeKnown: replies.cellHeight !== undefined,
		background: replies.background,
		maxImage: replies.maxImage,
		colors: replies.colors,
	}
}

function readReplies(stdin: NodeJS.ReadStream, stdout: NodeJS.WriteStream, timeoutMs: number): Promise<ProbeReplies> {
	return new Promise((resolve, reject) => {
		const wasRaw = stdin.isRaw
		let data = ""

		const restore = () => {
			clearTimeout(timer)
			stdin.off("data", onData)
			stdin.setRawMode(wasRaw)
			stdin.pause()
		}

		const finish = () => {
			restore()
			resolve(parseProbeReplies(data))
		}

		const onData = (chunk: Buffer | string) => {
			data += chunk.toString()
			if (parseProbeReplies(data).complete) {
				finish()
			}
		}

		const timer = setTimeout(finish, timeoutMs)

		// Raw mode, so the replies are neither echoed nor held back until Enter.
		stdin.setRawMode(true)
		stdin.on("data", onData)
		stdin.resume()
		try {
			stdout.write(PROBE_QUERIES)
		} catch (error) {
			restore()
			reject(error)
		}
	})
}
