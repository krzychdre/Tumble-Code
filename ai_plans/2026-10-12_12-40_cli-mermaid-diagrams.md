# CLI: Mermaid diagrams in the terminal transcript

Status: done, merged as #857 (2026-10-12).

Related plans: `2026-10-12_11-30_cli-inline-images.md` (the image pipeline this draws through).

Touched: `apps/cli/src/ui/graphics/mermaid.ts`, `MermaidBlock.tsx` (new), `ui/components/Markdown.tsx`,
`apps/cli/package.json` (`beautiful-mermaid`), `docs/07-cli.md`, `apps/cli/README.md`.

## Goal

The second half of the owner's request: Mermaid diagrams in the CLI when it runs in a graphical terminal. A plain
console was not expected to manage; it gets the diagram in box-drawing characters anyway.

## Choice of renderer

- `@mermaid-js/mermaid-cli` needs Puppeteer and a Chromium download (hundreds of MB): rejected.
- `beautiful-mermaid` 1.1.3 (MIT, deps `elkjs` and `entities`): lays diagrams out without a DOM and returns an SVG or
  the same diagram in box-drawing characters. Flowchart, state, sequence, class, ER, XY chart; `pie` and other kinds
  throw (the code stays). Import about 125 ms, first diagram about 140 ms (ELK warm-up), then about 10 ms; the
  text form about 2 ms. Imported statically: lazy loading would have to be awaited before a resumed task prints its
  history anyway.

## Findings

- The SVG keeps its palette in CSS custom properties built with `color-mix()` (for live theme switching in a
  browser). resvg supports neither: the first trial drew black boxes with no text or arrows.
  `resolveSvgColors` reads the definitions (root `style` and `<style>` blocks) and evaluates every `var(--x, fallback)`
  and `color-mix(in srgb, A p%, B q%)` (one or two percentages; the XY chart uses two) into hex, with a depth cap
  against cycles, and drops the font `@import`.
- At 1x the diagram text is about half the height of terminal text on a HiDPI screen (35-pixel rows). The natural size
  is scaled by `cellHeight / 18`.
- A tall diagram in xterm lost its bottom third: xterm cuts sixel images at `maxGraphicSize`. Fixed on the images
  branch (XTSMGRAPHICS limits), part of #856.

## Design

- `Markdown.tsx`: a ` ```mermaid ` fence that is closed renders `MermaidBlock` with the code block as its fallback.
  An open fence (still streaming) keeps the code: laying out half a diagram on every chunk is wasted work, and
  `streamCommit.ts` holds open fences in the tail anyway.
- `MermaidBlock`: in the scrollback of an image terminal, `InlineImage` with an SVG source (id = sha1 of background
  and source, so reprints reuse the encoding) and the text diagram as the fallback; elsewhere the text diagram
  (`wrap="truncate-end"`, only when it fits `columns - 4`), else the code.
- Colours: transparent background, text `theme.text` on a dark terminal background and `#27272A` on a light one.
  kitty and iTerm2 show the terminal background through; sixel flattens onto it.

## Tests

- `mermaid.test.ts`: `var()` chains and fallbacks, `color-mix()` with one and two percentages, unresolvable
  reference left alone, cycle terminates, `@import` dropped; all six diagram kinds render with no `var(`/`color-mix(`
  left; dark/light text colour; `pie` is undefined; text form trimmed, undefined when too wide or unparsable.
- `MermaidBlock.test.tsx` (through `Markdown`): image marker in sixel scrollback, characters in the tail and in a
  text-only terminal, code for `pie`, code for an open fence.
- Manual: the built CLI, `-m Qwen3.8-27B --ephemeral --mode ask`, asked for a load-balancer flowchart in xterm
  `-ti vt340` with `allowWindowOps` and default colour registers: the full diagram (browser, balancer, two app
  servers, database) drawn between the answer and the prompt.

## Caveats

- Not verified by hand in kitty, iTerm2, GNOME Terminal or Ptyxis.
- Diagram kinds beyond the six above show the code.
- The text form is skipped when wider than the terminal; it is not scaled down.
