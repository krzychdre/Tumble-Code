# CLI: tell the model what the terminal shows

Status: done on `feat/cli-display-prompt` (local only, stacked on `feat/cli-mermaid-diagrams` <- `feat/cli-inline-images`,
not pushed).

Related plans: `2026-10-12_11-30_cli-inline-images.md`, `2026-10-12_12-40_cli-mermaid-diagrams.md`.

Touched: `packages/types/src/cli-runtime.ts` (`ROO_CLI_DISPLAY`, `CliDisplay`, `parseCliDisplay`),
`src/core/prompts/sections/terminal-display.ts` (new), `system.ts`, `types.ts`, `system-prompt-input.ts`,
`sections/index.ts`, `apps/cli/src/agent/extension-host.ts` (`display` option), `apps/cli/src/commands/cli/run.ts`,
`docs/architecture.md`, `docs/09-environment-variables.md`, `docs/07-cli.md`.

## Symptom

The owner, in the CLI in Ghostty (kitty protocol detected), asked Qwen3.8-27B: "ściągnij ładny obrazek z internetu i
wyświetl go tutaj". The model downloaded `nice-pic-downloaded.jpg`, wrote it as a link
(`[nice-pic-downloaded.jpg](nice-pic-downloaded.jpg)`), so nothing was drawn, then said the picture was "wyświetlony
wyżej" (shown above). Told "masz go wyświetlić w konsoli!", it went looking for `chafa`, `img2sixel` and PIL.

## Cause

Nothing in the system prompt said that the CLI draws Markdown images; MARKDOWN RULES even asks for every filename as a
clickable link. The prompt had no CLI-specific text at all, and the extension could not know whether the terminal
draws images: the probe runs in the CLI process and its result stayed in the TUI's React context.

## Fix

- Contract: `ROO_CLI_DISPLAY` (`images` | `text`), set by `ExtensionHost` from its new `display` option. `run.ts` fills
  it in the TUI from the probe (`protocol ? "images" : "text"`); print and JSON runs leave it unset, since they draw
  nothing.
- `buildSystemPromptInput` reads it into `SystemPromptSettings.cliDisplay` (one place for the live request and the
  "copy system prompt" preview).
- `terminalDisplaySection` adds TERMINAL DISPLAY after MARKDOWN RULES (full profile) and after RULES (compact profile):
    - `images`: the exact syntax with an example, that it is an exception to the link rule, that the file must exist
      first, mermaid blocks become diagrams, and "Never say that an image is shown otherwise."
    - `text`: mermaid blocks become character diagrams; images cannot be shown, give the path instead.
    - unset: empty, and `joinSections` drops it, so VS Code and print runs get byte-identical prompts.
- KV-cache contract: the value is fixed for the life of the process, so the section sits in the stable head and every
  mode shares it.

## Tests

- `packages/types/src/__tests__/cli-runtime.spec.ts`: the new name, parsing (`images`/`text` only).
- `sections/__tests__/terminal-display.spec.ts`: empty outside the TUI, the syntax and rules in both variants.
- `__tests__/prefix-stability.spec.ts`: absent by default; with `cliDisplay` it follows MARKDOWN RULES and lies inside
  the prefix all five modes share; in the compact head after RULES.
- `__tests__/system-prompt-input.spec.ts`: env to `settings.cliDisplay`.
- `apps/cli` `extension-host.test.ts` (set only when given), `run.test.ts` (TUI passes `display: "text"` when the
  terminal answers nothing).
- The golden snapshots (`compact-off-golden`, `compact-profile`, `system-prompt`, parity) pass unchanged: their runs
  have no `ROO_CLI_DISPLAY`.
- Manual: rebuilt `src/dist` and the CLI; in Ghostty, `-m Qwen3.8-27B --mode code`, the owner's exact request. The
  model downloaded a picture and replied with `![...](obrazek_z_internetu.jpg)`; the picture was drawn. A follow-up
  "jeszcze jeden" drew a second one.

## Notes

- In that run a `● …` row (an assistant message with empty text) appeared above the second picture. Not investigated;
  likely an empty model turn rather than the image path.
- Remote image URLs are still not fetched by the renderer; the model downloads the file first, as the prompt says.
