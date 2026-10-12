import type { CliDisplay } from "@tumble-code/types"

/**
 * What the CLI's terminal UI shows of a reply (`ROO_CLI_DISPLAY`, set by the
 * CLI for its terminal UI only), or nothing outside it.
 *
 * Without it a model in the CLI had no way to know that a Markdown image is
 * drawn: asked to show a downloaded picture, Qwen3.8-27B linked the file the
 * way MARKDOWN RULES ask for filenames, nothing was drawn, and it then claimed
 * the picture was "shown above" (plan: 2026-10-12 cli display prompt).
 *
 * The value is fixed for the life of the process, so the section belongs in
 * the stable head: it never changes between modes (KV-cache contract).
 */
export function terminalDisplaySection(display: CliDisplay | undefined): string {
	if (display === "images") {
		return `====

TERMINAL DISPLAY

The user reads your replies in a terminal that draws images and diagrams.
- To show the user an image file (PNG, JPEG, GIF or WebP), put it on a line of its own as ![short description](path/to/image.png), with the path relative to the workspace. Example: ![Sales chart](out/sales.png). This line is an exception to the link rule in MARKDOWN RULES. The file must exist first: download or create it before you show it.
- A \`\`\`mermaid code block is drawn as a diagram (flowchart, sequence, state, class, ER diagram or xychart).
- The user sees an image only when your reply contains such a line. Never say that an image is shown otherwise.`
	}
	if (display === "text") {
		return `====

TERMINAL DISPLAY

The user reads your replies in a terminal that shows text only.
- A \`\`\`mermaid code block is drawn as a diagram made of characters (flowchart, sequence, state, class, ER diagram or xychart).
- This terminal cannot show images. Never say that an image is shown; give the path of the image file instead.`
	}
	return ""
}
