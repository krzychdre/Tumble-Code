# Level 2: the CLI

`apps/cli` (`@tumble-code/cli`) is a terminal client. It does not reimplement the agent: it loads the same
`src/dist/extension.js` the VS Code extension uses, inside its own Node process, with `packages/vscode-shim`
standing in for the `vscode` module.

## Boot

```mermaid
sequenceDiagram
  participant M as index.ts / main.ts (commander)
  participant R as commands/cli/run.ts
  participant EH as ExtensionHost (agent/extension-host.ts)
  participant SH as vscode-shim
  participant X as extension.js

  M->>R: run (default command)
  R->>EH: new ExtensionHost(options)
  EH->>EH: set CLI_RUNTIME_ENV variables, quiet console
  EH->>SH: createVSCodeAPI(...)
  EH->>EH: setCliRuntimeGlobals({ vscode, extensionHost })
  EH->>EH: patch require so "vscode" resolves to the shim
  EH->>X: require(extension.js), then activate(context)
  EH->>EH: wait until ready (10 s limit)
  EH->>X: updateSettings, cliModeProviderSettings, webviewDidLaunch (in this order)
  R->>R: TUI (Ink) if stdin and stdout are TTYs and --print is not set, else print mode (text, json or stream-json)
```

The runtime contract (six environment variables and two `globalThis` slots) is defined once in
`packages/types/src/cli-runtime.ts`. See [architecture.md](architecture.md).

## Message flow

The shim's webview object is an event emitter. The CLI plays the part of the chat panel: what the user types (or
the prompt given on the command line) goes in as a `webviewMessage`, and every message the extension posts comes
out as an `extensionWebviewMessage` that two readers inside `ExtensionClient` (`agent/extension-client.ts`) take in:

```mermaid
flowchart LR
  IN[TUI input or the --print prompt] -- "emit webviewMessage" --> SHIM[shim webview]
  SHIM --> WMH[webviewMessageHandler in extension.js]
  EXT[extension postMessage] -- "emit extensionWebviewMessage" --> TR[TranscriptReader<br/>reduceExtensionMessage]
  EXT --> MP[MessageProcessor<br/>DeliveryReader]
  TR -- TUI --> SINK[useTranscriptSink] --> STORE[zustand ui/store.ts] --> INK[Ink components]
  TR -- "print, text" --> PRN[TranscriptPrinter] --> OUT[OutputManager<br/>writes only]
  MP -- "delivery events" --> JSON[JsonEventEmitter<br/>json and stream-json]
  MP -- "waitingForInput" --> ASK[AskDispatcher<br/>print, text]
```

- **Rows.** `TranscriptReader` (`agent/transcript-reader.ts`) runs the transcript reducer on every message and sends
  the resulting row changes to the one sink attached to it: the TUI's `useTranscriptSink`, which applies them to
  the zustand store, or in print mode `TranscriptPrinter` (`agent/transcript-printer.ts`), which writes the rows'
  text through `OutputManager`. `OutputManager` decides nothing; it only writes lines. With no sink attached (JSON
  output) the reader does nothing.
- **Deliveries.** `MessageProcessor` passes every state push and `messageUpdated` to the `DeliveryReader`
  (`agent/transcript-deliveries.ts`), which keeps the client's copy of the task's messages and hands out only the
  news: a message the first time it arrives, again only when it changed, with a resumed task's history marked. The
  client publishes them as `delivery` events, and derives the agent loop state (`agent/agent-state.ts`) from the
  same copy for its `stateChange`, `waitingForInput` and `taskCompleted` events. `JsonEventEmitter` builds the JSON
  output from the `delivery` events (the message `ts` is the event id); `AskDispatcher` answers or prompts for the
  asks of a text print run (in the TUI the components answer them, a JSON run relies on auto-approval).

## Rendering in the terminal

Ink redraws its dynamic area on every change, which flickers and gets slow with long output. The CLI therefore
splits the screen:

- Finished rows go to Ink's `<Static>` (`TranscriptStatic`), printed once and never redrawn.
- A streaming answer is committed line by line (`ui/streamCommit.ts`): complete lines move into `<Static>`, an
  unclosed code fence is held back until it closes.
- The live tail (`TailViewport.tsx`) is capped to the terminal height, anchored to the bottom.

This pipeline, including the `useInsertionEffect` ordering in `TailViewport`, is on the "do not touch" list.

### Images

In a terminal that can draw images, Markdown images on a line of their own (`![alt](path)`, relative to the
workspace, or a `data:` URL) are drawn in the printed transcript (`ui/graphics/`):

- `terminalProbe.ts` asks the terminal before Ink starts which protocol it speaks (kitty, iTerm2 or sixel), its cell
  size and its background colour. `TUMBLE_IMAGES` turns images off or forces a protocol. tmux and screen are text only
  unless a protocol is forced.
- `InlineImage.tsx` decodes and scales the image with resvg, encodes it (`imageEncoding.ts`) and registers it
  (`inlineImages.ts`). Ink only ever prints a short private-use marker in its place.
- `utils/scrollSafeStdout.ts` swaps the marker for the image on its way to the terminal, with the cursor moves that
  reserve the rows the image covers. When the terminal does not report its cell size (xterm by default), the
  terminal moves the cursor past the image itself.

Only `<Static>` output may carry a marker (`ScrollbackContext`): the live tail is repainted on every frame and shows
the text fallback `[image: alt] path` instead.

A closed ` ```mermaid ` fence becomes `MermaidBlock` (`ui/graphics/mermaid.ts`, using `beautiful-mermaid`): an SVG
drawn through `InlineImage` where images are possible, the diagram in box-drawing characters elsewhere, the code when
the diagram kind is unsupported or the text form is wider than the terminal. resvg understands neither CSS custom
properties nor `color-mix()`, so `resolveSvgColors` evaluates them into plain colours first.

The model has to know about both: the TUI passes the probe's verdict to the extension as `ROO_CLI_DISPLAY` (`images`
or `text`), and the system prompt adds a TERMINAL DISPLAY section with the image syntax and the rule never to claim an
image is shown without it (`src/core/prompts/sections/terminal-display.ts`). Print and JSON runs leave it out.

## Build

`apps/cli/tsup.config.ts` bundles the CLI to ESM for Node 22, with the workspace packages inlined.
`apps/cli/scripts/build.sh` builds the extension bundle, then the CLI, then packs both into one tarball.
