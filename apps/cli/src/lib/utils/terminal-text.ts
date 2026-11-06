/**
 * Text from the model, a command or an MCP server, made safe to print.
 *
 * Such text can carry escape sequences that act on the terminal instead of
 * showing: OSC 52 overwrites the clipboard, OSC 8 hides a link target behind
 * harmless text, CSI cursor and erase moves rewrite what is on screen (an
 * approval prompt included), ESC c resets the terminal. Only SGR (colours and
 * text styles) is kept, so coloured command output still shows in colour.
 *
 * Ink already drops most of these from what it renders, but it keeps OSC
 * strings, and print mode writes to stdout without ink.
 */

// One alternative per kind, in this order: CSI (7-bit and C1 form); OSC, DCS,
// SOS, PM and APC strings up to BEL or ST (or the end of the text when the
// terminator has not arrived yet); any other two-byte escape; a lone C0 or
// C1 control other than tab and line feed.
const TERMINAL_CONTROL =
	// eslint-disable-next-line no-control-regex
	/(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]|(?:\x1b[\]PX^_]|[\x90\x98\x9d-\x9f])[^\x07\x1b\x9c]*(?:\x07|\x1b\\|\x9c)?|\x1b[ -/]*[0-~]|[\x00-\x08\x0b-\x1f\x7f-\x9f]/g

// eslint-disable-next-line no-control-regex
const SGR = /^\x1b\[[0-9;:]*m$/

/** `text` without terminal control sequences and control characters, SGR, tab and line feed kept. */
export function stripTerminalControls(text: string): string {
	return text.replace(TERMINAL_CONTROL, (match) => (SGR.test(match) ? match : ""))
}
