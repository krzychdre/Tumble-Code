# Spinner verbs: a rock tumbler instead of a thesaurus

## Why

The spinner's word list came from the Claude-Code-style redesign
(`ai_plans/2026-08-05_cli-claude-code-style-ui-redesign.md`, "~40 gerunds in
Claude's whimsical register"). Half of it reads like a status report from a
consultancy: `Combobulating`, `Actualizing`, `Interpolating`, `Extrapolating`,
`Reconciling`, `Calibrating`, `Synthesizing`, `Orchestrating`. The other half is
the generic kitchen metaphor every agent CLI uses: `Brewing`, `Percolating`,
`Marinating`, `Simmering`, `Fermenting`.

None of it says anything about this tool, and none of it makes a sound.

## The idea

A rock tumbler: the barrel machine that turns sharp gravel into smooth stones by
rolling it for days with water and abrasive grit. It is the product's own name
taken literally, it is a machine that visibly _works_ while you wait, and it is
loud, which gives the list onomatopoeia for free.

It is also an honest picture of what the agent is doing while the spinner spins:
the same material goes around and around and comes out smoother.

Two halves, twenty words each:

- **The machine running.** Tumbling, Rumbling, Clattering, Whirring, Clunking,
  Rattling, Thrumming, Chugging, Clacking, Ratcheting, Humming, Purring,
  Drumming, Whooshing, Sloshing, Gurgling, Clinking, Trundling, Kerplunking,
  Buzzing.
- **The lapidary work itself.** Churning, Grinding, Gritting, Lapping, Honing,
  Burnishing, Buffing, Polishing, Smoothing, Rounding, Sifting, Cobbling,
  Sluicing, Panning, Grading, Sorting, Settling, Rolling, Faceting, Unearthing.

Several carry the trade's real vocabulary rather than a vague vibe: _lapping_ and
_honing_ are abrasive finishing, _grading_ is sorting stones by size between
stages, _faceting_ is cutting a gem's faces, _sluicing_ and _panning_ are washing
material to keep what is worth keeping, and a _cobble_ is exactly what a tumbler
produces, a stone rounded by tumbling.

## Words that were deliberately left out

- Anything that reads as a fault on a status line: `Grumbling`, `Growling`,
  `Juddering`, `Knocking` (an engine knocking is a broken engine), `Eroding`.
- `Ticking`, which puts a clock on the user while they are already waiting.
- Near-duplicates, one of each pair: `Sieving` next to `Sifting`, `Swooshing`
  next to `Whooshing`.

## Scope

`spinnerVerbs.ts` only. `pickVerb()` and its deterministic seed are untouched:
the verb is still chosen by `abs(seed) % length` from the loading-start
timestamp, so it stays stable for one turn, and the list stays forty words long
so the distribution does not change.

Every word is ASCII, which matters more than it looks: the spinner line is
rebuilt on every frame next to a glyph column, and a word containing a
double-width character would make the gap to the frame jitter, which is the bug
`figures.ts` documents for the old spinner frames.

## Tests

New `spinnerVerbs.test.ts`: `pickVerb` is stable for one seed and wraps the
list, negative and zero seeds return a real word, and the list itself has no
duplicates, is all ASCII, and is all gerunds (the spinner renders
`"{verb}…"`, so a non-gerund would read as broken grammar).
