# Shell writes to protected files through `~`, `$HOME`, variables and inline code

**Status:** fixed on `fix/protected-home-and-code`
**Related:** security audit 2026-10-28, section 9 (residual after 6f3b9b6ba)
**Touched:** `src/core/protect/RooProtectedController.ts`, `src/core/auto-approval/commandWrappers.ts`,
`src/core/protect/__tests__/RooProtectedController.spec.ts`

## Symptom

With `alwaysAllowExecute` and an allowlisted writer, `cat > ~/.roo/mcp.json <<X ... X`, `echo x > "$HOME/.roo/mcp.json"`
or a `tee` into the global `mcp_settings.json` under `~/.config/Code/User/globalStorage` was auto-approved: the agent
could add an MCP server to the user's global config, which starts without consent. So were `cp x "$DEST"`,
`cd "$DIR" && cat > mcp.json` and `python3 -c "open('.roo/mcp.json', 'w')..."`.

## What was happening

`isCommandWriteProtected` resolved every target with `path.resolve(directory, target)`, so `~/.roo/mcp.json` became
`<cwd>/~/.roo/mcp.json` and `$HOME/...` became `<cwd>/$HOME/...`, neither under a protected root. Interpreter code is
one argument such as `open('.roo/mcp.json','w')`, which matches no pattern as a path.

## Fix

- `expandedPath` (`commandWrappers.ts`, shared with the `.rooignore` check): the path a word names after the shell
  expands a leading `~`, `~/`, `$HOME` or `${HOME}`; null when another expansion remains (`$OUT`, `$(...)`, `~user`).
- `isCommandWriteProtected` expands every redirect target, writer argument and `cd` target with it. A null target, or a
  relative target after a `cd` to an unknown place, may be protected (the auto-approved command asks).
- Interpreter code (`UnwrappedCommand.code` from §24: `python3 -c`, `node -e`, `perl -e`, an awk program that can open a
  file, ...) may write a protected file when its text names a protected location: a protected pattern without its
  globs (`.roo`, `.vscode`, `AGENTS.md`, ...), `mcp_settings.json`, or a protected directory (absolute or relative to
  home, e.g. `.config/Code/User`); code only known after expansion counts too. Other interpreter calls are unchanged.
- `echo`, `printf`, `test` and `[` join the read-only commands, so `echo $PATH` does not ask.

## Tests

`RooProtectedController.spec.ts`, one parametrized table of 12 protected forms (`~`, `$HOME`, `${HOME}`, global MCP
settings, `cd ~/.roo`, `> "$OUT"`, `$(...)`, `cd "$DIR"`, python, node naming the VS Code User path, awk, awk program
from a variable) and 7 unprotected forms (`echo $PATH`, `[ -f "$F" ]`, reading `~/.roo/mcp.json`, `> ~/notes.txt`,
plain python/node code).

Mutation checks, each red then restored: no `~` expansion (1), code check off (4), unknown targets allowed (3), no
home-relative directory marker (1), `echo` not read-only (1), null code allowed (1), unknown `cd` ignored (1).

## Not fixed

- Global MCP servers start without a consent prompt (`McpHub.startable`): the global file is the user's own config, and
  agent writes to it through the shell now ask, like the write tools already did.
- A relative target after a `cd` to an unknown place asks even when the command writes nothing protected
  (`cd "$(git rev-parse --show-toplevel)" && npm test > out.log`), and so does a writer argument built from a
  substitution (`git commit -m "$(cat msg)"`); the path is not known before the command runs.
- Code that builds a protected path from pieces (`'.r' + 'oo'`) is not recognised.
