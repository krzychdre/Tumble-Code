# Tumble Code Marketplace

The Marketplace tab in Tumble Code reads its items straight from this folder on the `main` branch of this repository. Anything merged here shows up for every user within a few minutes (the extension caches the list for 5 minutes).

```
marketplace/
  modes/<id>.yaml   one custom mode per file
  mcps/<id>.yaml    one MCP server per file
```

Only `.yaml` and `.yml` files are read. A file that does not parse or does not match the format below is skipped (the extension logs a warning naming the file), so one broken item never hides the others.

## Mode file format

Each file in `modes/` describes one marketplace item. The fields are validated by `modeMarketplaceItemSchema` in `packages/types/src/marketplace.ts`.

| Field           | Required | Meaning                                                              |
| --------------- | -------- | -------------------------------------------------------------------- |
| `id`            | yes      | Unique id, use the file name without `.yaml`                         |
| `name`          | yes      | Name shown in the Marketplace (no emoji, the UI draws its own icons) |
| `description`   | yes      | One or two sentences shown on the card                               |
| `author`        | no       | Your name or handle                                                  |
| `authorUrl`     | no       | A valid URL, for example your GitHub profile                         |
| `tags`          | no       | List of short tags used by the tag filter                            |
| `prerequisites` | no       | List of things the user needs before installing                      |
| `content`       | yes      | The mode itself, as a YAML string (see below)                        |

`content` is a single custom mode entry, the same shape as one item under `customModes:` in `.roomodes` or `custom_modes.yaml`. It is validated by `modeConfigSchema` in `packages/types/src/mode.ts` when the user installs it:

- `slug`: letters, numbers and dashes only; keep it equal to `id`
- `name`, `roleDefinition`: required
- `whenToUse`, `description`, `customInstructions`: optional
- `groups`: tool groups the mode may use (`read`, `edit`, `command`, `mcp`, `modes`, `web`). A group can be restricted with a tuple, for example `["edit", { fileRegex: "\\.md$", description: "Markdown files only" }]`.

See [`modes/docs-writer.yaml`](modes/docs-writer.yaml) for a complete example.

## Contributing a mode

1. Copy `modes/docs-writer.yaml` to `modes/<your-id>.yaml` and edit it.
2. Try the mode locally first: paste the `content` block as an entry under `customModes:` in your project's `.roomodes` and use it on a real task.
3. Run `cd src && npx vitest run services/marketplace/__tests__/marketplace-files.spec.ts`. It validates every file in this folder, both the item fields and the mode inside `content`.
4. Open a pull request against `main`. Describe what the mode is for and what you tested it on.
