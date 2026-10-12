# CLI: math as text kept `\tau` and `\Omega` when they were styled

Status: done on `fix/cli-math-unicode-coverage`

## Problem

The owner sent a screenshot (2026-10-12) of a CLI answer about a spinning top. The inline formula read
`\tau = L = \Omega_P × L` while `×`, `ω₃` and `Ω_P` elsewhere on the line were translated.

## Root cause

The model wrote `\boldsymbol{\tau} = \dot{\mathbf{L}} = \boldsymbol{\Omega}_P \times \mathbf{L}`.
`texToUnicode` kept one set, `TEXT_COMMANDS`, for prose commands (`\text`) and for math style commands
(`\mathbf`, `\boldsymbol`, `\mathrm`, ...). Both returned the raw `{...}` argument, so a command inside a
style command was never read: `\boldsymbol{\tau}` gave `\tau`. Reproduced exactly with a probe test
(`\tau = L̇ = \Omega_P × L`).

## Fix

- `TEXT_COMMANDS` keeps only prose commands (raw argument). New `STYLE_COMMANDS` read their argument as
  math. `\text{\alpha}` still reads `\alpha`, as LaTeX prints it.
- A probe over ~170 common commands found ~150 more gaps. Added: `\var` capital Greek, relations
  (`\leqslant`, `\prec`, `\models`, ...), long and diagonal arrows, harpoons, binary operators
  (`\odot`, `\dagger`, ...), big operators (`\bigoplus`, ...), misc symbols (`\top`, `\flat`, suits,
  `\Box`, `\S`, ...), `\lbrace`/`\lbrack`; accents `\check \breve \acute \grave \mathring
\overrightarrow \overleftarrow \underline`, and `\overline`/`\underline` over every character;
  argument commands `\overset \stackrel \underset \xrightarrow \xleftarrow \textcolor \hspace \tag
\bra \ket \braket`; dropped with argument `\phantom \hphantom \vphantom \vspace \color \label`.
- Still left as written: commands LaTeX itself does not define (`\Alpha`, `\sgn`, `\Tr`).

## Tests

`texToUnicode.test.ts`: the screenshot formula, style commands, `\text` raw, one row per new group.
