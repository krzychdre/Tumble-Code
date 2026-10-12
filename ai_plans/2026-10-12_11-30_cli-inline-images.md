# CLI: images in the terminal transcript

Status: done on `feat/cli-inline-images` (first of two stacked branches; `feat/cli-mermaid-diagrams` builds on it).

Related plans: `2026-09-22` cli stream answer into scrollback (the `<Static>` commit model this relies on),
`2026-09-22` cli incremental render ghost rows (`scrollSafeStdout.ts`, which now also expands image markers).

Touched: `apps/cli/src/ui/graphics/*` (new), `ui/components/Markdown.tsx`, `ui/components/TranscriptStatic.tsx`,
`ui/utils/scrollSafeStdout.ts`, `commands/cli/run.ts`, `apps/cli/package.json` (`@resvg/resvg-js`, `sixel`),
`docs/07-cli.md`, `docs/09-environment-variables.md`, `docs/architecture.md`, `apps/cli/README.md`.

## Goal

The owner asked for the CLI to show images and Mermaid diagrams when it runs in a graphical terminal window ("czysta
konsola raczej nie ma szans"). This branch is the image half: detection, encoding, placement in the transcript, and
Markdown images. The Mermaid half is the next branch.

## Findings that shaped it

- The owner's machine has GNOME Terminal 3.58 and Ptyxis 50 on VTE 0.84, and neither can draw images. GNOME Terminal
  still has a hidden per-profile key `enable-sixel`, but in VTE 0.84 (Debian source 0.84.1-1, `src/vtegtk.cc`)
  `vte_terminal_set_enable_sixel` only checks its argument, `vte_terminal_get_enable_sixel` returns `FALSE`, and
  `Terminal::DECSIXEL` in `src/vteseq.cc` is an empty body. Measured with the key set to `true` in a new window: DA1
  `ESC[?61;1;21;22;28c` (no 4), XTSMGRAPHICS `ESC[?1;1S`/`ESC[?2;1S` (error), no reply to `CSI 16 t`. Ptyxis has no
  such key.
- Ink cannot carry an image: `Output` measures and wraps every line to the box width, so a 50 kB escape sequence would
  be cut into rows. Static output, however, is written by ink as one plain string (`ink.js`, `renderInteractiveFrame`:
  `log.clear(); stdout.write(staticOutput); log(output)`), and on a full clear ink writes `fullStaticOutput` again.
- The dynamic tail is repainted on every frame, so an image may only ever be drawn in `<Static>` output.
- xterm ignores `CSI 16 t` unless `allowWindowOps` is set, so the cell size is not always known. Reserving rows on a
  guessed 20 px cell left a 15-row gap under a 700 px image (screenshot, cell was really 18x35).
- Sixel has no partial alpha: light anti-aliased text on a transparent background was quantized to dark pixels
  (verified by decoding the produced sixel back with `sixel`'s decoder).

- xterm cuts off a sixel image larger than its `maxGraphicSize` (1000x1000 by default) instead of scaling it, and
  has 16 colour registers by default (`numColorRegisters`); a 256-colour image then comes out in wrong colours. Found
  with a Mermaid diagram on the next branch: the bottom third (the database node) was missing.

## Design

- `terminalProbe.ts`: before ink starts, write a kitty graphics query, `CSI 16 t` (cell size), `OSC 11 ?`
  (background) and DA1 (`CSI c`) last; read stdin in raw mode until the DA1 reply or 400 ms. kitty reply wins, then
  iTerm2 (by `TERM_PROGRAM`/`LC_TERMINAL`, it has no query), then sixel (DA1 attribute 4). tmux/screen: text only.
  `TUMBLE_IMAGES=off|kitty|iterm|sixel` overrides. XTSMGRAPHICS (`CSI ? 1 ; 1 ; 0 S`, `CSI ? 2 ; 1 ; 0 S`) asks
  for the sixel colour registers and the largest sixel image; `placeImage` scales sixel images into that limit and
  the sixel encoder uses no more colours than there are registers.
- `imageEncoding.ts`: header-only size of PNG/JPEG/GIF/WebP; `placeImage` scales down to the box (never up);
  resvg renders an SVG, or a bitmap wrapped in a one-element SVG, at the placement width; `encodeImage` writes kitty
  (PNG, 4096-byte chunks, `q=2` so no replies reach stdin), iTerm2 (`width=Npx`), or sixel (256 colours, after
  `flattenOnto` the terminal background).
- `inlineImages.ts`: registry id -> `{ sequence, rows? }` keyed by protocol, box and source, kept for the session
  (ink may reprint all static output). Ink prints `<id>`; `expandImageMarkers` (called from
  `scrollSafeStdout`) replaces it with: `rows-1` line feeds and back up (so the rows exist and nothing scrolls while
  drawing), save cursor, image, restore, down to the last image row. With an unknown cell size: the image alone, and
  the terminal moves the cursor.
- `GraphicsContext` carries the probe result and the workspace (`baseDir`) from `run.ts`; `ScrollbackContext` is
  `true` only inside `TranscriptStatic`. `InlineImage` renders the marker there and its text fallback everywhere else.
- `Markdown.tsx`: a line that is only `![alt](src)` becomes `MarkdownImage`. Remote URLs are not fetched (fallback).

## Tests

- `graphics/__tests__/terminalProbe.test.ts`: reply parsing (split reads, 2/4-digit colours, DA1 `64` is not `4`),
  protocol order, override, non-TTY and tmux ask nothing, timeout, terminal mode restored.
  The probe never rejects: `run.test.ts` ("tells the App to open the resume picker") caught the first version
  throwing `stdin.setRawMode is not a function` on a TTY-flagged fake stdin, which aborted the TUI start. It now
  checks for `setRawMode`, and a write that throws restores raw mode and listeners before falling back to text.
  That test also stopped reading the App at a fixed depth of the element tree, since the provider adds a level.
- `imageEncoding.test.ts`: placement, headers of all four formats, bitmap through resvg, kitty chunking and `C=1`,
  iTerm2 pixel size, sixel framing, alpha flattening.
- `inlineImages.test.ts`: key reuse, reserve/restore sequence, column from the text before the marker (ANSI ignored),
  unknown-rows mode, unknown marker dropped.
- `InlineImage.test.tsx`: Markdown in scrollback with kitty prints a marker that expands to a 3-row image; tail, text
  terminal, missing file, non-image and `data:` URL show the fallback.
- Manual: xterm `-ti vt340` with and without `allowWindowOps` (harness through `TranscriptStatic` +
  `createScrollSafeStdout`), then the built CLI with `-m Qwen3.8-27B --ephemeral --mode ask` answering with
  `![diagram](diagram.png)`: drawn between the two sentences, footer and input intact (screenshots in the session).

## Caveats

- Not verified by hand in kitty, Ghostty, foot or iTerm2 (only xterm sixel); GNOME Terminal and Ptyxis cannot draw
  images at all (see Findings); the unit tests pin the
  sequences.
- `ClineMessage.images` (images the user attaches) are still not shown; the CLI never mapped them into `TUIMessage`.
- Remote image URLs are not fetched.
- A terminal resize after printing does not redraw images (nothing in `<Static>` is redrawn).
