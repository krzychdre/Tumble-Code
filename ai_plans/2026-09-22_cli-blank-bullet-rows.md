# Empty bullets in the CLI transcript

## The report

The transcript is littered with rows that hold nothing but a bullet:

```
● Znalazłem: kontener `modbus-sigenergy-…` — mostek Modbus→MQTT …
●
  ∴ Thinking…
```

One of them lands in front of almost every reasoning line, so the pattern reads
like a broken thinking indicator. It is not: the bullet belongs to a message of
its own that renders no text.

## Evidence, not a guess

The session in the screenshot is a CLI session, so its transcript is on disk
under `~/.vscode-mock/global-storage/tasks/<id>/ui_messages.json` (the CLI's
mock global storage, not the VS Code extension's). A throwaway test replayed all
409 persisted messages of that task through the real `useMessageHandlers` hook
and then rendered every resulting store message through the real
`ChatHistoryItem`, printing each row whose only visible line was `●`.

With `nonInteractive: false` there were none. With `nonInteractive: true` (the
mode that session ran in, which is why no approval dialogs appear in it) there
were 36, and every single one was the same thing:

```
BULLET-ONLY: assistant  originalType=command  id=1790088775388
  content: cd …/Modbus_reference_documentation && grep -n -i -E "available|curtail" v29.txt | head -30
  frame:   "\n●"
```

So the empty rows are `ask: command` messages, and their text is a shell
command that the renderer erases. Two independent defects stack up to produce
one blank row.

## Defect 1: the markdown renderer blanks every line that contains a pipe

`apps/cli/src/ui/components/Markdown.tsx` decides whether a line is the
separator row of a table (`|---|:--:|`) like this:

```ts
const isTableBoundary = line.includes("|") && /[-:|]+/.test(line.replace(/[^\w\s-:|]/g, ""))
```

The `replace` keeps word characters, whitespace, `-`, `:` and `|`. The test then
asks whether what survived contains any of `-`, `:` or `|` — and the pipe that
got the line here in the first place always survives, so the test is true for
**every** line containing a pipe. A matching line is replaced by a tab and an
ideographic space, i.e. by nothing visible.

That is not only a shell-command problem. Any answer line that mentions a pipe,
`use `grep foo | head``, a CSV fragment, a table content row, disappears from the
transcript the same way.

The fix is to test for what a separator row actually is: after trimming, the
line must consist of nothing but `|`, `-`, `:` and whitespace, and must contain
at least one `|` and at least one `-`. `----` alone is already handled earlier as
a horizontal rule, and table _content_ rows keep falling through to the inline
tokenizer, which prints them verbatim, as the component's own doc comment
promises.

## Defect 2: an approved command is announced twice

In non-interactive mode `handleAskMessage` routes every ask that is not
`ask: tool` into a catch-all that adds it as an **assistant** message. For
`ask: command` that means the command text is printed as prose, with a bullet,
and then printed again a moment later as the proper `● Bash(cmd)` row that
`CommandTool` builds from the `say: command_output` that follows. Fixing defect 1
alone would therefore not clean the transcript up; it would turn every blank
bullet into a duplicated command.

Interactive mode never had this row: there `ask: command` becomes the approval
dialog, which disappears once answered, and the command survives only in the
`Bash` row. So dropping the message in non-interactive mode is what makes the
two modes agree, and the command stays visible either way.

The pairing is safe in the replayed session: 48 `ask: command` messages, 48
final `say: command_output` messages, so every command still owns a `Bash` row.
The one command that timed out (`git clone`, 300 s) is the exception that proves
the rule, and it behaves exactly as it already does in interactive mode: its row
is replaced by the `Command execution timed out` error.

## What changes

1. `Markdown.tsx`: `isTableBoundary` recognises a real separator row instead of
   any line with a pipe in it.
2. `useMessageHandlers.ts`: in the non-interactive branch, `ask: command` is
   marked as seen and dropped, with the reason in a comment. `pendingCommandRef`
   is still set before that point, so the `Bash` row keeps its command.

## Left alone on purpose, worth its own branch

The same replay showed `Modbus_reference_documentation` rendered as
`Modbusreferencedocumentation`. `tokenizeInline` treats `_…_` as italic markers
and eats underscores out of file paths and identifiers. It is the same class of
bug (a heuristic that destroys plain text), but it is not what was reported here
and it deserves its own branch.
