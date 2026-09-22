# CLI: skills are never offered in the slash picker (startup race on skill discovery)

**Date:** 2026-09-21
**Branch:** `fix/cli-skills-missing-in-slash-picker` (forked from `main` = `de6495c04`)
**Status:** implemented

Writing and coding rule for every implementer of this plan: never use an em dash
or an en dash anywhere (code, comments, tests, commit messages, UI strings). Use a
hyphen, a comma, a colon or parentheses. Existing files still contain em dashes in
old comments; do not add new ones and do not rewrite old ones outside the lines
you touch.

## Problem

The user reports that skills cannot be used from the CLI. In the TUI, typing `/`
lists only `/new`, `/permissions` and the file-backed commands. No skill ever
appears, so a user has no way to discover or invoke one, and the natural reading
is "the CLI does not support skills at all".

The CLI does in fact carry the whole skills stack: it loads the real extension
bundle through the vscode shim, so `ClineProvider` builds a `SkillsManager`, the
`skill` tool is in the toolset, `getSkillsSection` adds an AVAILABLE SKILLS block
to the system prompt, and `parseMentions` expands `/<skill-name>` into the skill
body. Nothing of that is missing. What is broken is _when_ the skill list is
read.

## Root cause (proven, not inferred)

### Evidence

Three observations from the installed build (`tumble` 0.2.0-local.88f5e3e38),
with seven skills on disk (3 global in `~/.roo/skills`, 4 project-level in
`.roo/skills`):

1. `tumble list commands` returns all seven skills. Those entries can only come
   from `getDiscoveredCommands`, which reads `provider.getSkillsManager()`, so in
   the CLI process the manager exists, initializes, and scans the disk correctly.
2. In the TUI, pressing `/` after 15 seconds of idle time lists `/new`,
   `/permissions`, `/init` (built-in) and `/commitmsg` (a global _command_ file).
   Not one skill. Waiting longer changes nothing.
3. In the same session, running `/new` and then pressing `/` again lists
   `/summarize-discord-channel` and `/log-redmine-time-from-sheet`. The skills
   were there all along.

Observation 3 rules out discovery itself and points at the moment the list is
requested.

### The race

`ClineProvider` starts skill discovery without awaiting it
(`src/core/webview/ClineProvider.ts:343-346`):

```ts
this.skillsManager = new SkillsManager(this)
this.skillsManager.initialize().catch((error) => { ... })
```

`getSkillsManager()` therefore returns a live object immediately, but its
`skills` map stays empty until the filesystem scan finishes.

The TUI asks for its slash-command list in the same tick as activation
(`apps/cli/src/ui/hooks/useExtensionHost.ts:186-188`):

```ts
await host.activate()
host.sendToExtension({ type: "requestCommands" })
```

`getDiscoveredCommands` (`src/core/webview/webviewMessageHandler.ts:135-172`)
then mixes two sources with very different timing:

- `getCommands(cwd)` reads the command markdown files from disk _at request
  time_, so `/init` and `/commitmsg` always make it;
- `skillsManager.getSkillsForMode(currentMode)` is a synchronous read of the
  in-memory map, which at that moment is still empty.

The CLI stores the answer in `allSlashCommands` and never re-requests it, so the
empty skill list is cached for the whole session. `/new` happens to re-issue
`requestCommands` (`apps/cli/src/ui/hooks/useTaskSubmit.ts:90`), which is why it
looks like a fix.

`tumble list commands` escapes the race only by accident: it waits on
`pWaitFor(host.client.isInitialized(), 2000)` before sending the request
(`apps/cli/src/commands/cli/list.ts:132-136`), which gives the scan time to
finish.

### Same defect, other surfaces

Every consumer that reads the skills map can lose the same race. Two of them
matter in practice:

- `getSkillsSection` (`src/core/prompts/sections/skills.ts`) builds the
  AVAILABLE SKILLS block of the system prompt. In a one-shot run
  (`tumble -p "..."`) the first API request is built moments after activation.
- `getSkillContent`, reached from `parseMentions` through
  `resolveSkillContentForMode`, expands `/<skill-name>` typed by the user. In a
  one-shot run the expansion silently degrades to plain text.

The VS Code Skills view (`handleRequestSkills`) has the same shape, though its
webview normally loads late enough to hide it.

## Fix

Give `SkillsManager` an explicit readiness signal and await it at every entry
point that reads the map:

1. `discoverSkills()` records the in-flight scan in `discoveryPromise`, and a new
   `whenReady()` awaits it. When discovery was never started (unit tests that
   call `discoverSkills()` directly), `whenReady()` resolves immediately.
2. A discovery pass builds a fresh `Map` and swaps it in at the end instead of
   clearing the live map up front. Without the swap, `whenReady()` would still
   let a reader observe a half-filled map during a rescan triggered by
   create/delete/move.
3. `getSkillContent()` awaits readiness itself, which covers the `skill` tool,
   `run_slash_command` and the `/<skill-name>` mention expansion in one place.
4. `getDiscoveredCommands`, `getSkillsSection` and `handleRequestSkills` await
   `whenReady()` before reading. `getSkillsForMode()` stays synchronous: all three
   callers are already async, and making it async would ripple through the
   prompt-section types for no gain.

## Scope boundary (deliberately not fixed here)

The vscode shim's `createFileSystemWatcher`
(`packages/vscode-shim/src/api/WorkspaceAPI.ts:304-317`) returns an emitter that
nothing ever fires. In the CLI, skills are therefore discovered exactly once per
process: a skill created or edited during a long TUI session stays invisible
until restart. That is a separate feature (a real watcher in the shim, or a
re-request when the picker opens) and is not part of this fix.

## Tests

- `SkillsManager.spec.ts`: calling `initialize()` without awaiting it and then
  awaiting `whenReady()` must expose the discovered skills; `getSkillContent()`
  called in the same tick as an unawaited `initialize()` must return the skill
  rather than `null` (this is the regression test for the reported bug); a rescan
  must never expose an empty map to a concurrent reader.
- `sections/__tests__/skills.spec.ts`: the section waits for readiness before
  listing.
