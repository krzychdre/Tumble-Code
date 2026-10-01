# Red specs on main after the first round-2 batch

**Status:** done
**Touched:** two src specs (+ one snapshot), two webview golden files, `queryCount_many` in five webview locales

The full src and webview suites on main `5e04b95e4` had 4 + 9 failures. A read-only analysis (each spec rerun alone;
compared with the pre-round baseline `65fdaba16`) found no production defect:

| Failure | Cause | Fix |
| --- | --- | --- |
| `toolStreamState.onTask.spec.ts` apply_diff (2) | #684 made `diffStrategy` required and dropped the guard; the spec's fake task had no `diffStrategy` | Fake task gets `diffStrategy.getProgressStatus` returning `undefined` (an empty object would return early and skip `ask`) |
| `webviewMessageHandler.routing.spec.ts` deleteCustomMode (2) | #678 resolves the rules folder through `RooDirectoryResolver`; the mocked `getRooDirectoriesForCwd` returned one directory, the real one returns `[global, project]`, so no project entry existed | Mock returns both, snapshot updated: the new `getRooDirectoriesForCwd` calls and the global tools dir in `refreshCustomTools`; `fileExistsAtPath(/workspace/.roo/rules-m1)` is kept |
| `ChatRow.golden-renders.spec.tsx` (3) | #673 changed `border-green-600/30` and `text-blue-400` to theme tokens without regenerating the golden | Golden regenerated; only those three class strings changed |
| `lucide-icons.golden.spec.tsx` | #671 deleted the only importers of `Circle` | Golden regenerated; only `Circle` removed |
| `pluralForms.spec.ts` (5 locales) | Pre-existing since #663: `webSearch.queryCount` lacks the `many` form that `Intl.PluralRules` selects for ca, es, fr, it, pt-BR | `queryCount_many` added with the `_other` text, like the other `_many` keys in those files |
