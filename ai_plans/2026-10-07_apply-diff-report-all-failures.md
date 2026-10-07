# apply_diff zgłasza każdy nieudany blok i mówi, które bloki się zapisały

**Status:** zrealizowane na gałęzi `fix/apply-diff-report-all-failures` (na stosie nad `fix/no-html-unescape-native-tools`).
**Powiązane plany:** brak (gałąź równoległa zmienia logikę dopasowania w `multi-search-replace.ts`; ta gałąź dotyka tam
tylko miejsc, w których powstają obiekty błędów, i pól wyniku).
**Zasady:** DRY (jeden formater listy bloków dla porażki i dla częściowego sukcesu, ten sam tekst idzie do modelu i do
wiersza `diff_error` w czacie), YAGNI (strategia dostaje tylko trzy pola liczbowe, bez nowych struktur), projekt pod
słabe modele (krótkie zdania, numery bloków w kolejności z diffa, wprost „Do NOT send ... again”).

## Problem (z historii zadań użytkownika, GLM-5.3)

- `ApplyDiffTool` w pętli po `failParts` robił `formattedError = ...` (przypisanie zamiast zbierania), więc model widział
  tylko OSTATNI nieudany blok. W 9 wywołaniach co najmniej 14 nieudanych bloków nigdy nie dotarło do modelu.
- Przy częściowym sukcesie wynik mówił tylko „But unable to apply all diff parts”, bez numerów bloków. Dwa razy model
  wysłał ponownie bloki, które już były w pliku, i dostał nowe błędy.
- Diff z 2 blokami, oba ze złym `:start_line:`: zgłoszony był tylko blok 2.
- Dodatkowa pułapka: strategia sortuje bloki po `:start_line:`, więc kolejność `failParts` nie jest kolejnością z diffa
  modelu.

## Projekt

### Strategia (`src/core/diff/strategies/multi-search-replace.ts`, zmiana minimalna)

- Przy budowie listy zamian każdy blok dostaje `block: { blockIndex, startLine }` (pozycja w diffie, liczona od 1,
  przed sortowaniem; zadeklarowany `:start_line:` albo `undefined`).
- Trzy miejsca `diffResults.push({ success: false, ... })` dostają `...replacement.block`.
- Wynik końcowy (sukces i porażka) dostaje `blockCount: matches.length`.
- Typ `DiffResult` (`src/shared/tools.ts`): opcjonalne `blockCount`, `blockIndex`, `startLine`.

### Narzędzie (`src/core/tools/ApplyDiffTool.ts`)

- `formatFailedBlocks`: wszystkie nieudane bloki, posortowane po `blockIndex`, każdy z nagłówkiem
  `Block 2 of 3 (:start_line:145) failed:`. Pełny tekst błędu (treść wyszukiwania, fragment pliku, który bywa całym
  plikiem) tylko dla pierwszego bloku; pozostałe dostają pierwszą linię przyczyny i sekcję „Best Match Found”
  (obciętą do 2000 znaków). Chroni to okno kontekstu przed kilkoma zrzutami całego pliku.
- Porażka wszystkich bloków: `Unable to apply diff to file: <ścieżka>` + „None of the N diff blocks were applied. The
  file is unchanged.” + lista. Ten sam tekst idzie do `task.say("diff_error", ...)` i `recordToolError`.
- Częściowy sukces (`partialApplyReport`): prefiks „Partially applied the diff to file: ... 1 of 3 blocks applied, 2
  failed.”, potem zwykły wynik zapisu, potem sufiks z listą zastosowanych bloków („Do NOT send block 1 again”),
  listą nieudanych („These changes are NOT in the file”), następnym krokiem (read_file, potem jedno nowe apply_diff
  tylko z nieudanymi blokami) i szczegółami. Sufiks stoi po wyniku zapisu, bo ten kończy się zdaniem „You do not need
  to re-read the file”; konkretna instrukcja ma być ostatnia.
- Bez `blockIndex`/`blockCount` (inna strategia, stare dane) narzędzie pisze wersję ogólną: liczba nieudanych bloków
  i „The other blocks were applied ... Do NOT send them again”.

## Przed / po

| Sytuacja                   | Przed                                   | Po                                                                               |
| -------------------------- | --------------------------------------- | -------------------------------------------------------------------------------- |
| 2 z 3 bloków nie pasuje    | model widzi tylko ostatni nieudany blok | oba bloki, w kolejności z diffa, z numerem i `:start_line:`                      |
| 1 z 3 zastosowany, 2 nie   | „But unable to apply all diff parts”    | numery zastosowanych i nieudanych bloków, zakaz ponownego wysłania zastosowanych |
| wiele zrzutów całego pliku | n/d (pokazywany był jeden)              | pełny zrzut tylko dla pierwszego nieudanego bloku                                |

## Testy

- `applyDiffTool.spec.ts`: dwa nieudane bloki w odwrotnej kolejności (oba zgłoszone, kolejność z diffa, zrzut tylko
  pierwszego, ten sam tekst w `diff_error`); prawdziwa strategia i diff z 2 blokami, oba chybione (oba zgłoszone);
  częściowy sukces z pełnym przypiętym tekstem wyniku.
- `multi-search-replace.spec.ts`: `blockIndex`, `startLine` i `blockCount` dla diffa z blokami nie po kolei.
- `writeAndApplyDiffPipeline.spec.ts`: przypięty tekst częściowego sukcesu w wersji ogólnej (bez `blockIndex`).
