# A command that asks for a password freezes the whole CLI

## The report

The user ran a task in the CLI. The agent executed, in `/home/krzych/sig-modbus`:

```
git clone --depth 1 https://github.com/pseud0nym/sigenergy2mqtt.git 2>&1 | tail -1 && grep -rn ...
```

`Username for 'https://github.com':` appeared under the input box, outside
anything the CLI had drawn, and then everything stopped: no keystroke reached
the UI, esc and ctrl+c did nothing, and no further request went to the model.
The session recovered on its own after five minutes.

## What was actually happening

Captured from the live processes while the session was frozen, before any fix
was attempted:

```
zsh (1349921, session leader on pts/3)
└─ node tumble (2985179)          pgid 2985179  Sl+ pts/3
   └─ /bin/sh -c cd ... && git clone ...        S+  pts/3   pgid 2985179
      └─ git clone (3040620)                    S+  pts/3   pgid 2985179
         └─ git remote-https (3040623)
            └─ git-remote-https (3040624)
                 fd 0 → pipe
                 fd 6 → /dev/tty      (read)
                 fd 7 → /dev/tty      (write)
                 wchan: wait_woken    (asleep, waiting for a line)
```

Two independent defects stack up here.

**`stdin: "ignore"` does not make a command non-interactive.**
`ExecaTerminalProcess.run` sets `stdin: "ignore"`, and the comment next to it
claims this "ensures non-interactive mode and prevents hanging". The capture
above shows `git clone` with `fd 0 → /dev/null`, exactly as configured, and the
prompt still happened: git's `terminal_prompt` opens `/dev/tty` by path, which
is a direct handle to the controlling terminal and ignores every redirection
applied to fd 0. ssh, sudo and most credential helpers do the same.

**The child shares the keyboard with ink.** The child ran in the same session
and the same foreground process group as the CLI (identical PGID above). ink
holds the terminal in raw mode, where ctrl+c is no longer turned into SIGINT by
the line discipline but delivered as the byte `0x03` to whichever process reads
first. With two readers on one terminal, every keystroke went to one of them
essentially at random, which is why nothing the user pressed worked.

The five-minute recovery is `commandExecutionTimeout: 300`, set for the CLI in
`apps/cli/src/agent/extension-host.ts`. Verified by observation: the git tree
was killed at exactly 300 s and the CLI survived.

## Evidence for the fix

Four probes, each run against a real pty (`script -qec ...` with stdin held
open so the terminal stays alive, which is what makes probe A reproduce):

| Probe | Setup                                                           | Result                                                                                            |
| ----- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| A     | today's behaviour: `stdin: "ignore"`, inherited terminal        | prompt leaked onto the terminal, hung until killed                                                |
| B     | same, plus `detached: true` (setsid)                            | `fatal: could not read Username ... ENXIO`, exit 128 after 0.4 s, nothing printed to the terminal |
| C     | no terminal at all, `GIT_ASKPASS` set to a helper script        | git called the helper for username, then for password, and used both answers                      |
| E     | no terminal at all, `SSH_ASKPASS` + `SSH_ASKPASS_REQUIRE=force` | ssh called the helper for the key passphrase and decrypted the key                                |

(Probe D, ssh password auth against github.com, proves nothing: github.com only
accepts publickey, so ssh never reaches the prompt. Replaced by probe E.)

B says the freeze is curable by putting the command in its own session. C and E
say the cure does not have to cost interactivity: git and ssh will happily ask a
program of our choosing instead of the terminal.

## The requirement

The user's words, when offered a purely defensive fix: _"chciałbym używać
komend przez ssh z CLI, chodzi o to, iż nie mogłem wpisać żadnej informacji -
wszystko zawisło"_. So the goal is not "never prompt", it is "prompt inside the
CLI, where I can answer". That splits into two branches.

## Stage 1 (this branch) - the command can no longer take the keyboard

`fix/cli-interactive-command-prompts`

1. `detached: true` on POSIX in `ExecaTerminalProcess.run`, so the shell and
   everything under it get a fresh session with no controlling terminal and
   `/dev/tty` cannot be opened. Not on Windows, where `detached` means "new
   console window" and would pop one up.
2. Non-interactive environment for the cases where a clear error beats an ENXIO
   message: `GIT_TERMINAL_PROMPT=0`, `SSH_ASKPASS_REQUIRE=never` (without it,
   ssh may reach for an X11 askpass dialog on the desktop when `DISPLAY` is
   set, which blocks the command behind a window the user may never see), and
   `PAGER`/`GIT_PAGER=cat` so a pager cannot block on a terminal that is gone.
3. Kill by process group. `detached` makes the shell a group leader, so
   `process.kill(-pid, ...)` reaches every descendant in one call. The existing
   `psTree` walk stays as the fallback, and the group id is captured before the
   `psTree` code overwrites `this.pid` with the first child.
4. An exit handler that group-kills anything still running. This closes a
   regression the change would otherwise introduce: children of a detached
   session no longer receive SIGHUP when the user's terminal closes, so without
   it a runaway `npm run dev` would outlive the CLI.

After stage 1 a credential prompt costs 0.4 s and a legible error in the
transcript instead of five frozen minutes.

## Stage 2 (stacked branch) - answering the prompt from the TUI

`feat/cli-askpass-bridge`, stacked on stage 1 because it edits the same file.

1. A helper executable shipped with the CLI. git/ssh/sudo run it with the
   prompt text as `argv[1]`; it connects to a unix socket named in its
   environment, sends the prompt, and prints the answer it gets back on stdout.
   No socket, or a refusal, means exit 1, which makes the command fail fast
   exactly as in stage 1.
2. A listener in the core, one socket per task in a `0700` directory with a
   random name plus a one-time token in the child's environment, so another
   local process cannot make the CLI pop a password box.
3. `GIT_ASKPASS`, `SSH_ASKPASS` with `SSH_ASKPASS_REQUIRE=force`, and
   `SUDO_ASKPASS` all point at the helper.
4. A masked input in the TUI. **The answer must never enter the conversation.**
   It travels on its own IPC event back to the socket and is never written to
   `task.say`, never stored in `ui_messages.json`, and never reaches the model.
   In the VS Code extension the same request opens
   `vscode.window.showInputBox({ password: true })`.

## Out of scope

Feeding plain stdin of a running command (a script that calls `input()`) is a
third, separate thing: it needs `stdin: "pipe"` and a "send this line to the
running command" affordance in the UI. Nothing here blocks it later.
