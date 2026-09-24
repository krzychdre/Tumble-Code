---
"tumble-code": patch
---

Security: command auto-approval now sees every command bash will run. The allow and deny lists were checked against a split made by regular expressions that ignored escapes and quoting context, so a denied command could be auto-approved next to an allowed one, for example `echo \' && rm -rf x \'`, `echo "$(rm -rf x)"`, a substitution in an unquoted heredoc body, `(rm -rf x)`, `then rm -rf x` or a quoted command name such as `'r'm`. A new scanner follows bash's quoting rules character by character, lists the commands nested in substitutions, groups and heredoc bodies, and matches the deny list also after quote removal. A command whose name is only known after expansion (`$CMD`, `$'\x72m'`, a glob) is no longer auto-approved, and syntax the scanner cannot split with certainty (for example a `case` statement) asks instead of approving.
