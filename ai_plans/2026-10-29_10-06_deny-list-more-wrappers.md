# More wrappers carried a denied program past the deny list

**Status:** fixed on `fix/deny-list-more-wrappers`
**Related:** security audit 2026-10-28, section 24 (residual after f65e1b095)
**Touched:** `src/core/auto-approval/commandWrappers.ts`, `src/core/auto-approval/commands.ts`,
`src/core/auto-approval/__tests__/commandWrappers.spec.ts`

## Symptom

With allow `["*"]` and deny `["rm"]` these were `auto_approve`: `su -c 'rm x'`, `su user -c ...`, `script -c 'rm x'`,
`busybox rm`, `strace rm`, `ltrace rm`, `chrt 10 rm`, `cpulimit -- rm`, `cpulimit -l 50 rm`, `fakeroot rm`,
`firejail rm`, `systemd-run rm`, `parallel rm ::: a b`, `ssh localhost rm`, `gdb -ex 'shell rm x'`, `vim -c '!rm x'`,
inline interpreter code (`python3 -c`, `node -e`, `perl -e`, `ruby -e`, `awk 'BEGIN{system("rm x")}'`) and
`find . -delete`.

## What was happening

`unwrapCommand` (`commandWrappers.ts`) only knew the wrappers listed in f65e1b095. Any other program was a plain
command: with `*` allowed and its own name not denied, it was approved whatever it ran. Code in another language was
never looked at, and `find -delete` deletes without naming `rm`.

## Fix

- New table entries, each deciding the inner command like a top-level one: `busybox`, `firejail`, `fakeroot`,
  `strace`, `ltrace`, `cpulimit`, `systemd-run` (simple wrappers), `chrt` (shares `afterOneValue` with `taskset`),
  `su` and `script` (`commandOption`: `-c`, `-qc`, `--command[=]`), `parallel` (command before `:::`, or each
  argument after `:::` when no command is given, stdin is opaque), `ssh` (the remote command; `-F` and an `-o ...Command`
  option are opaque; not exact, so the tails catch a misparsed option), `gdb --args`.
- `find ... -delete` adds the inner command `rm`.
- `UnwrappedCommand.code`: the program text of interpreters (`CODE_OPTIONS` table: python, node, perl, ruby, php, lua,
  Rscript, osascript, gdb `-ex`, vi/vim/nvim/ex/view `-c`/`--cmd`/`+CMD`) and of an awk program that can run a program
  or open a file (`system`, `getline`, `|`, `>`). `getAnalyzedCommandDecision` asks for such a command while the deny
  list is non-empty; with an empty deny list nothing changes.

## Tests

`commandWrappers.spec.ts`, rows added to the existing parametrized tables: 23 denied wrapper forms, 14 "never
approved automatically" forms (interpreters, gdb/vim, ssh `-o ProxyCommand` / `-F` / misparsed options, parallel from
stdin), 10 still-approved forms (`awk '{print $1}'`, `vim +10`, `ssh host git status`, `chrt -p`, `su -`...), and a new
table for interpreters approved with an empty deny list.

Mutation checks, each red then restored: `-delete` not recognised (1 red), the code check disabled (10), the code
check without the deny-list condition (3), awk code always counted (1), ssh never opaque (2), ssh exact again (1),
`+10` counted as code (1), the `-qc` cluster not recognised (4), parallel inputs dropped (1).

## Not fixed

- GNU `sed`'s `e` command and `s///e` flag run shell commands; sed is not treated as an interpreter (no audit repro,
  and every `sed` call would ask). A follow-up can add it to `CODE_OPTIONS`-like handling.
- A script file (`bash x.sh`, `python3 x.py`, `gdb -x cmds`) is a program like any other: what it runs is not read.
