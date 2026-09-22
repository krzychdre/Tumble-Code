# Spinner: noises instead of a thesaurus

(The file keeps its original name because the first commit on this branch cites
it. The list it describes is no longer verbs, so `spinnerVerbs.ts` became
`spinnerSounds.ts` and `pickVerb` became `pickSound`.)

## Why

The spinner's word list came from the Claude-Code-style redesign
(`ai_plans/2026-08-05_cli-claude-code-style-ui-redesign.md`, "~40 gerunds in
Claude's whimsical register"). Half of it reads like a status report from a
consultancy: `Combobulating`, `Actualizing`, `Interpolating`, `Extrapolating`,
`Reconciling`, `Calibrating`, `Synthesizing`, `Orchestrating`. The other half is
the generic kitchen metaphor every agent CLI uses: `Brewing`, `Percolating`,
`Marinating`, `Simmering`, `Fermenting`.

None of it says anything about this tool, and none of it makes a sound.

## The idea, in two steps

**Step one, the theme.** A rock tumbler: the barrel machine that turns sharp
gravel into smooth stones by rolling it for days with water and abrasive grit.
It is the product's own name taken literally, it is a machine that visibly
_works_ while you wait, and it is loud, which gives the list onomatopoeia for
free. It is also an honest picture of what the agent is doing while the spinner
spins: the same material goes around and around and comes out smoother.

**Step two, dropping the `-ing`.** The first pass kept gerunds (`Rumbling`,
`Kerplunking`) out of habit. But the spinner renders

```text
◍ Kerplunk… (esc to interrupt · 12s · ↓ 1.2K tokens)
```

and that suffix already states that something is running, in words. The gerund
was therefore paying for nothing but grammar, while costing the joke: `Boinging`
_reports_ a noise, `Boing` _is_ one. Bare nouns are also shorter, which keeps the
dim suffix in the same place on the line more often.

A second decision followed from the first. The list is no longer confined to the
barrel, because forty variations on one machine are duller than forty noises: it
keeps the tumbler as its home key and then wanders into slurry, comic-book
springs and small robot beeps.

## The list, forty single words

- **The barrel.** Tumble, Rumble, Clunk, Clank, Clack, Whirr, Thrum, Kerchunk,
  Thunk, Whump.
- **What is inside it.** Kerplunk, Kerplop, Sploosh, Slosh, Glug, Glorp, Gloop,
  Squelch, Crunch, Scritch.
- **Comic-book physics.** Boing, Sproing, Plop, Plink, Plonk, Flump, Fwoosh,
  Shloop, Swish, Thwack.
- **Small noises, half of them electronics.** Blip, Blorp, Beep, Boop, Meep,
  Pop, Fizz, Ting, Clink, Vroom.

`Tumble` is the single entry that is not a noise. It holds index zero as the
brand's own word and as the fallback inside `pickSound`.

## Words that were deliberately left out

- Anything that reads as a **crash**: Bang, Boom, Crash, Snap, Kersplat. A
  status line is exactly where a user looks for bad news.
- Anything that reads as a **fault in the machine**: Grind, Squeak, Sputter,
  Hiss (a leak), Judder, Knock (an engine knocking is a broken engine), Clang.
- Anything that implies **destruction while the agent is editing files**: Zap,
  Kapow, Pow. `Fizzle` for the same reason, since it means to fail.
- `Tick` and `Tock`, which put a clock on someone who is already waiting.
- `Ding`, which is the noise of something finishing, on a line that means the
  opposite.
- Slang traps and near-slurs, checked one by one: `Bonk`, `Boink`, `Doink`,
  `Chink`, `Toot`, `Parp`. Also `Yoink`, which means to take something that is
  not yours, a poor joke from an agent that is reading your files.
- Doubled forms (`Clickety-clack`, `Ka-chunk ka-chunk`), which were the obvious
  way to make a point-in-time noise sound continuous. They lost to the single
  word: the trailing `…` and the ticking `12s` already supply the continuity,
  and the doubles crowd the line.

## Scope

`spinnerSounds.ts` (renamed from `spinnerVerbs.ts`) plus the prop rename in
`Spinner.tsx`, where `verb` became `sound`. Nothing else imports the list, and
the sole call site in `App.tsx` never passed a word of its own, so no other
register can leak onto the line.

The picking logic is untouched: still `abs(seed) % length` from the
loading-start timestamp, so the word stays stable for one turn, and the list is
still forty entries long so the distribution does not shift.

Every word is ASCII, which matters more than it looks: the spinner line is
rebuilt on every frame next to a glyph column, and a word containing a
double-width character would make the gap to the frame jitter, which is the bug
`figures.ts` documents for the old spinner frames.

## Tests

`spinnerSounds.test.ts`: `pickSound` is stable for one seed and wraps the list,
negative and zero seeds return a real word, and the list itself has no
duplicates.

The old "is all gerunds" assertion is replaced by two stricter ones, since
without it nothing would have guarded the format:

- `/^[A-Z][a-z]+$/`, which encodes three rules at once: a single word (no space,
  no hyphen, no doubled form), ASCII only, and a leading capital.
- A ten-character cap, so nobody later pastes a word long enough to shove the
  elapsed/token suffix across the line. The longest current entries,
  `Kerplunk` and `Kerchunk`, are eight.

No assertion pins the list at exactly forty entries. It would fire on every
future word added or removed while protecting nothing: the length affects only
which word a given timestamp lands on, and that mapping is not a contract.
