# apply_diff: tolerancja na deterministyczne pomyłki formatu (wcięty nagłówek, zbędne znaczniki, zły `:start_line:`)

**Status:** zrealizowane na gałęzi `fix/apply-diff-parser-tolerance`.
**Plik:** `src/core/diff/strategies/multi-search-replace.ts` (`MultiSearchReplaceDiffStrategy`, używana przez narzędzie
`apply_diff`). Testy: `src/core/diff/strategies/__tests__/multi-search-replace-model-slips.spec.ts` (nowy) i jedna
zmieniona asercja w `multi-search-replace.spec.ts`.
**Zasady:** projektujemy pod słabe modele (GLM-5.3, Qwen, lokalne Llamy): przyjmujemy pomyłkę formatu, gdy jej
znaczenie jest jednoznaczne, i nigdy nie zgadujemy, gdy jest niejednoznaczne. YAGNI: żadnych nowych ustawień, prompt
bez zmian.

## Problem (analiza 114 nieudanych wywołań `apply_diff` z historii zadań użytkownika, 2026-10-07)

Analiza tylko do odczytu (`~/.config/Code/User/globalStorage/qub-it.tumble-code/tasks`) wskazała cztery przyczyny po
stronie parsera:

1. **Wcięty nagłówek (3 porażki, zadanie `01a1160c`, GLM-5.3).** Model napisał
   `<<<<<<< SEARCH\n :start_line:139\n-------\n    sub.add_parser("commit")...`, ze spacją przed `:start_line:`.
   Wyrażenie regularne parsera wymagało `:start_line:`, `:end_line:` i `-------` w kolumnie 0, więc nagłówek i
   separator trafiały do tekstu wyszukiwania (podobieństwo 46-73%, „No sufficiently similar match”).
2. **`:start_line:` daleko od prawdy (13 porażek w wielu zadaniach).** Tekst SEARCH był identyczny bajt w bajt i
   występował w pliku dokładnie raz, ale wskazówka myliła się o 42-201 linii albo wskazywała za koniec pliku
   (`:start_line:545` w pliku 459-liniowym, prawdziwa linia 449; wskazówka 133, prawda 198; wskazówka 25, prawda ~226).
   Wyszukiwanie przeglądało tylko okno ±`BUFFER_LINES` (40) wokół wskazówki, więc kończyło się „No sufficiently similar
   match”, a za końcem pliku nawet „(no match)”.
3. **Zbędne znaczniki (10 porażek).** Wszystkie kształty jednoznaczne:
    - dodatkowe `=======` tuż przed `>>>>>>> REPLACE` w bloku, który ma już separator, np.
      `SEARCH\n:start_line:15\n-------\nold\n=======\nnew\n=======\n>>>>>>> REPLACE` (zadanie `01a0f6be` i pięć podobnych);
    - podwójny separator jako usunięcie: `old\n=======\n=======\n>>>>>>> REPLACE` (zadanie `01a0fe73`, raz z uciętym
      zamknięciem);
    - `=======` albo powtórzone `>>>>>>> REPLACE` po zamknięciu ostatniego bloku.
4. **Mylący komunikat.** Gdy blok miał dwa niezaeskejpowane `=======`, walidator zwracał komunikat o znacznikach
   konfliktu scalania („escape it with a backslash”), bo `likelyBadStructure` jest fałszywe, gdy separatorów jest co
   najmniej tyle co bloków. Numer linii dotyczył diffu po naprawie, a nie tekstu modelu.

## Przyczyny i poprawki

### 1. Nagłówek z wcięciem

- Główne wyrażenie regularne: `[ \t]*` przed `:start_line:` i `:end_line:`. Linia `-------` może być wcięta tylko
  wtedy, gdy bezpośrednio po niej stoi nagłówek z numerem linii (lookbehind `(?<=:(?:start|end)_line:\s*\d+\s*\n)`).
  Wcięte `-------` jako pierwsza linia bloku bez nagłówka zostaje treścią (to może być prawdziwa treść pliku, np.
  podkreślenie w RST).
- `repairTruncatedDiff` odcina nagłówek tą samą regułą (`isDirective`), żeby naprawa uciętego diffu nie wzięła
  wciętego nagłówka za pierwszą linię SEARCH.
- Prompt narzędzia (`src/core/prompts/tools/native-tools/apply_diff.ts`) sprawdzony: pokazuje nagłówek w kolumnie 0 i
  nie sugeruje wcięcia, więc bez zmian.

### 2. Skan całego pliku, tylko dla dokładnego i jedynego trafienia

- Nowa funkcja `findExactMatches(lines, searchChunk)`: zwraca wszystkie pozycje, gdzie fragment pasuje z
  podobieństwem 1 (identycznie po `normalizeString`, jak liczy `getSimilarity`). Normalizuje każdą linię pliku raz i
  łączy niepuste linie spacją; to daje ten sam napis co normalizacja całego fragmentu, bo `normalizeString` zamienia
  znaki pojedynczo i zwija wszystkie białe znaki. Bez odległości Levenshteina, więc skan całego pliku jest tani.
- Uruchamiana dopiero wtedy, gdy zawiodło wyszukiwanie w oknie i przebieg z agresywnym zdejmowaniem numerów linii, i
  tylko gdy podano `:start_line:` (bez wskazówki okno i tak obejmuje cały plik).
- Przyjmujemy wynik tylko przy dokładnie jednym trafieniu, niezależnie od `fuzzyThreshold`: dopasowanie przybliżone
  daleko od wskazówki to zgadywanie. Przy 2+ trafieniach błąd mówi, ile razy tekst występuje i w których liniach, z
  prośbą o poprawienie `:start_line:`.
- Księgowanie przesunięć: zamiast jednej sumy `delta` lista zastosowanych edycji (`appliedEdits`: pozycja w
  `resultLines` w chwili edycji i zmiana liczby linii). Wskazówkę kolejnego bloku przesuwają tylko edycje na jej
  wysokości lub powyżej (`shiftHint`). Dotąd wszystkie wcześniejsze edycje leżały powyżej (bloki są sortowane po
  wskazówce), więc wynik jest ten sam; blok przeniesiony skanem całego pliku może jednak leżeć poniżej wskazówek
  późniejszych bloków i nie wolno mu ich przesuwać.

### 3. Usuwanie zbędnych znaczników przed walidacją (`repairStrayMarkers`)

Nowy krok po `repairTruncatedDiff`, przed `validateMarkerSequencing`, liniowy i z poszanowaniem znaczników
zaeskejpowanych (`\=======` nigdy nie pasuje):

- w kompletnym bloku (`SEARCH` ... `>>>>>>> REPLACE`) z dokładnie dwoma separatorami, gdy między drugim separatorem a
  zamknięciem są tylko puste linie: usuwamy drugi separator i te puste linie. To obejmuje `new\n=======\n>>>>>>> REPLACE`
  oraz `old\n=======\n=======\n>>>>>>> REPLACE` (pusta zamiana, czyli usunięcie). Kolejność po `repairTruncatedDiff`
  sprawia, że podwójny separator z uciętym zamknięciem też działa;
- po zamknięciu bloku: linie `=======` i powtórzone `>>>>>>> REPLACE`, gdy do następnego bloku albo do końca diffu są
  tylko puste linie i takie znaczniki;
- blok z liniami konfliktu (`<<<<<<< HEAD`, `>>>>>>> develop`, także zaeskejpowanymi `\<<<<<<< HEAD`) zostaje bez
  zmian, bo gołe `=======` może tam być środkową linią konfliktu, której model nie zaeskejpował; walidator zgłasza go
  jak dotąd.

Funkcja zwraca też `lineMap` (numer linii wejścia dla każdej linii wyniku), a walidator raportuje numery linii przez
tę mapę, więc błąd wskazuje linię, którą napisał model.

### 4. Komunikat o podwójnym separatorze

- W stanie „po separatorze” drugie `=======` daje teraz krótki komunikat: blok ma więcej niż jeden separator
  `=======` (z numerem linii), dozwolony jest dokładnie jeden na blok SEARCH/REPLACE, kilka miejsc to kilka bloków,
  poprawny format, i jedno zdanie o `\=======`, gdy taka linia jest w pliku.
- Komunikat o konflikcie scalania zostaje dla linii zaczynających się od `<<<<<<<`/`>>>>>>>` oraz wtedy, gdy diff
  zawiera zaeskejpowane znaczniki (model edytuje tekst konfliktu i pominął jedno `=======`, zadanie `01a0ee0b`).

## Testy

`multi-search-replace-model-slips.spec.ts`, każdy kształt z prawdziwych danych:

- nagłówek ` :start_line:3` (kształt z `01a1160c`); nagłówek wcięty tabem z `:end_line:` i wciętym `-------`;
  wcięte `-------` bez nagłówka zostaje treścią (negatywny); `repairTruncatedDiff` z wciętym nagłówkiem;
- `:start_line:545` w pliku 459-liniowym (prawda 449); wskazówka 133, prawda 198; ten sam tekst dwa razy w pliku nadal
  zawodzi i podaje linie (negatywny); przy `fuzzyThreshold` 0.9 daleki prawie identyczny tekst nie jest przyjmowany
  (negatywny); edycja przeniesiona w dół nie przesuwa wskazówki późniejszego bloku (`bufferLines` 0, tekst drugiego
  bloku występuje dwa razy, więc tylko poprawne przesunięcie daje sukces);
- dodatkowe `=======` przed zamknięciem (kształt `01a0f6be`), także z pustymi liniami; podwójny separator jako
  usunięcie (`01a0fe73`), także z uciętym zamknięciem; `=======` na końcu diffu; powtórzone zamknięcie na końcu i
  między blokami; zaeskejpowane `\=======` w zamianie zostaje treścią;
- niejednoznaczne `A / ======= / B / ======= / C` (kształt `01a0fba0`) nadal zawodzi, z nowym komunikatem i linią 7;
  numer linii modelu po usunięciu zbędnego zamknięcia wcześniej w diffie; blok z zaeskejpowanymi liniami konfliktu i
  „pustym ogonem” po drugim separatorze nie jest naprawiany (negatywny); komunikat o konflikcie scalania dla
  `<<<<<<< HEAD` i dla diffu z zaeskejpowanymi znacznikami.

W `multi-search-replace.spec.ts` test „detects two separators” oczekuje teraz nowego komunikatu.

Odtworzenie na 120 zapisanych diffach z analizy (stary i nowy parser, sama walidacja): 10 diffów z kategorii 3
przechodzi teraz walidację, 4 niejednoznaczne dostają nowy komunikat, 2 z zaeskejpowanymi znacznikami zachowują
komunikat o konflikcie; 3 diffy z wciętym nagłówkiem mają teraz poprawnie odczytany `:start_line:` i czysty tekst SEARCH.

## Czego celowo nie tolerujemy

- Dwa separatory z treścią po każdym (`SEARCH / A / ======= / B / ======= / C`): nowym tekstem może być B albo C.
- Dwa sąsiednie separatory z treścią po nich (`A / ======= / ======= / B`): nie było tego w danych, a „B” mogłoby
  być linią `=======` z treścią, więc nie zgadujemy.
- `>>>>>>> REPLACE / ======= / treść / >>>>>>> REPLACE` (treść między blokami).
- Wcięte `-------` bez nagłówka z numerem linii.
- Skan całego pliku z dopasowaniem przybliżonym albo przy kilku dokładnych trafieniach.

## Uwagi

- Numer linii w błędzie walidacji jest numerem linii modelu z dokładnością do `repairTruncatedDiff`: ta naprawa
  dopisuje znaczniki na końcu uciętego bloku, więc przesunięcie zdarza się tylko wtedy, gdy w środku diffu stoi blok
  bez obu znaczników, a dalej jest inny błąd.
- Zachowanie sprzed zmiany, zostawione bez zmian: `-------\s*\n` połyka pustą linię tuż po separatorze nagłówka.
