# Cały wiersz `execute_command` w czacie ma się zwijać i rozwijać

Data: 2026-09-10
Branch: `fix/chat-command-row-collapsible` (odgałęziony od `main`, commit `4d87b0d97`)
Poprzednik: `ai_plans/2026-09-03_chat-command-output-collapsed-by-default.md` (#161, scalony)

## Problem zgłoszony przez użytkownika

Po #161 zwija się tylko wyjście polecenia. Samo polecenie jest zawsze widoczne w bloku
`CodeBlock`, który ma własną "roletę" ograniczającą wysokość do 500 px
(`WINDOW_SHADE_SETTINGS.collapsedHeight`). Przy długim poleceniu (np. skrypt Pythona
przekazany przez heredoc, kilkadziesiąt linii) wiersz "Running" nadal zajmuje pół ekranu,
mimo że wyjście jest zwinięte. Użytkownik potwierdził na zrzucie ekranu z zainstalowanej
paczki (bin/tumble-code-1.0.0.vsix, 2026-09-03 16:08, zawiera #161), że to blok polecenia.

Decyzja użytkownika (2026-09-10): "Całość ma mieć możliwość zwijania/rozwijania".

## Dowód, skąd bierze się widoczny blok

- `webview-ui/src/components/chat/CommandExecution.tsx:257-275`: `<CodeBlock source={command} />`
  i `<CommandPatternSelector>` renderują się niezależnie od `isExpanded`; tylko
  `TerminalOutput` jest warunkowy.
- `webview-ui/src/components/common/CodeBlock.tsx:17-20, 280-288`: roleta 500 px z paskiem
  przewijania; przycisk rozwinięcia rolety widać dopiero po najechaniu myszką i tylko wtedy,
  gdy treść przekracza stałą 500 (porównanie ze stałą, nie z propsem `collapsedHeight`).
- Nagłówek wiersza to wyłącznie ikona i stały napis `chat:commandExecution.running`
  (`ChatRow.tsx:299-309`), więc po zwinięciu całości nie byłoby wiadomo, jakie polecenie
  kryje się w środku.

## Dwie pułapki, które projekt musi obejść

1. Ten sam wiersz jest prośbą o zgodę. `ChatRow.tsx:1717` renderuje `CommandExecution`
   dla `ask === "command"`, a przyciski "Run Command"/"Reject" pokazuje `ChatView`, gdy
   `clineAsk === "command" && enableButtons` (`ChatView.tsx:395-400`). Przed decyzją
   użytkownik musi widzieć pełne polecenie, więc wiersz oczekujący na ręczną zgodę ma być
   domyślnie otwarty.
2. Automatyczna zgoda nie może powodować mignięcia (otwarcie i natychmiastowe zwinięcie).
   Dowód, że go nie będzie: `TaskAskSay.ts:96-119` rozstrzyga auto-zgodę PRZED dodaniem
   wiadomości i stempluje `isAnswered: true`, a `ChatView.tsx:311-313` przy `isAnswered`
   przerywa obsługę (`break`) i nigdy nie ustawia `clineAsk`/`enableButtons`. Warunek
   `clineAsk === "command" && enableButtons` jest więc prawdziwy tylko wtedy, gdy na ekranie
   naprawdę są przyciski zgody. Po kliknięciu `clearApprovalButtons()` (`ChatView.tsx:783`)
   zeruje oba, więc wiersz wraca do stanu domyślnego.
   Uwaga: ręczna zgoda NIE ustawia `isAnswered` na wiadomości `command`
   (`TaskAskSay.ts:478-505` stempluje tylko `followup` i `tool`), dlatego sygnałem jest stan
   ChatView, nie flaga na wiadomości.

## Zmiana

1. `CommandExecution.tsx`
    - Szewron (przycisk ze strzałką) zwija i rozwija CAŁĄ treść pod nagłówkiem: blok polecenia
      (`CodeBlock`), wyjście (`TerminalOutput`, jeśli jest) i panel `CommandPatternSelector`.
      W stanie zwiniętym żaden z nich nie jest montowany w DOM.
    - Szewron jest widoczny zawsze (polecenie zawsze istnieje), nie tylko gdy jest wyjście.
    - W stanie zwiniętym nagłówek pokazuje jednoliniowy podgląd polecenia: pierwsza niepusta
      linia (po `trim`), a jeśli polecenie ma więcej linii, dopisany znak wielokropka `…`
      (U+2026, bez nowych kluczy i18n). Styl: `font-mono text-xs text-vscode-descriptionForeground
truncate min-w-0`, kontener nagłówka dostaje `min-w-0 flex-1`, żeby działało ucinanie.
      Po rozwinięciu podgląd znika (blok polecenia jest tuż pod nagłówkiem).
    - Etykiety dostępności szewronu: nowe klucze `chat:commandExecution.expandCommand` /
      `collapseCommand` we WSZYSTKICH 18 locale (ca de en es fr hi id it ja ko nl pl pt-BR ru
      tr vi zh-CN zh-TW); stare `expandOutput`/`collapseOutput` usunięte (jedyny konsument to
      ten komponent). Polski: "Rozwiń polecenie" / "Zwiń polecenie".
    - Roleta 500 px wewnątrz `CodeBlock` zostaje bez zmian (po rozwinięciu długie polecenie
      nadal jest przewijane wewnątrz bloku).
2. `ChatView.tsx`
    - `isCommandAwaitingApproval = clineAsk === "command" && enableButtons`.
    - Dla wiersza przekazywane jest
      `isExpanded={expandedRows[ts] ?? (isLast && message.type === "ask" && message.ask === "command" && isCommandAwaitingApproval)}`.
      Operator `??` zamiast `|| false`, bo jawny wpis `false` (użytkownik zwinął) ma wygrać z
      domyślnym otwarciem. `clineAsk` dochodzi do zależności `itemContent`.
    - `toggleRowExpansion(ts, expand?)` przekazuje jawną wartość do istniejącego
      `handleSetExpandedRow(ts, expand)`.
3. `ChatRow.tsx`
    - Typ `onToggleExpand: (ts: number, expand?: boolean) => void`.
    - `handleToggleExpand` woła `onToggleExpand(message.ts, !isExpanded)`, czyli przełącza
      względem stanu WYŚWIETLANEGO. Bez tego pierwszy klik w domyślnie otwarty wiersz
      (brak wpisu w `expandedRows`) ustawiłby `!undefined === true` i wiersz zostałby otwarty.
      Dla wierszy bez domyślnego otwarcia wynik jest identyczny jak dotychczas.
4. Changeset `.changeset/chat-command-row-collapsible.md` (patch).

## Reguła zachowania (do testów)

| Sytuacja                                                      | Domyślnie                 | Klik szewronu                |
| ------------------------------------------------------------- | ------------------------- | ---------------------------- |
| polecenie streamuje się (partial, przyciski wyłączone)        | zwinięty, podgląd 1 linii | działa                       |
| czeka na ręczną zgodę (przyciski widoczne)                    | otwarty                   | zwija, wybór trwa po zgodzie |
| auto-zatwierdzone (isAnswered), działa, zakończone, historia  | zwinięty                  | rozwija całość               |
| po kliknięciu "Run Command" bez wcześniejszego kliku szewronu | wraca do zwiniętego       | działa                       |

## Świadomie pominięte

- Klikalny cały nagłówek (jak `ToolUseBlockHeader` w `CodeAccordion`): w nagłówku jest
  przycisk przerwania i tooltipy, więc zostaje sam szewron, jak w #161.
- Automatyczne rozwijanie przy niezerowym kodzie wyjścia: osobna decyzja.
- Zmiana rolety `CodeBlock` (porównanie ze stałą zamiast propsa): nie jest potrzebna, skoro
  blok w ogóle nie jest montowany w stanie zwiniętym.

## Testy

- `webview-ui/src/components/chat/__tests__/CommandExecution.spec.tsx`: blok
  "output collapsing" zastąpiony blokiem "row collapsing" (domyślnie brak `code-block`,
  `terminal-output` i `command-pattern-selector` w DOM; podgląd pierwszej linii i wielokropek
  dla wieloliniowego polecenia; brak wielokropka dla jednoliniowego; rozwinięcie montuje całą
  trójkę; klik deleguje do rodzica; szewron obecny także bez wyjścia). Testy, które
  sprawdzają treść bloku lub panelu wzorców, dostają `isExpanded={true}`.
- `ChatView`/`ChatRow`: test, że wiersz `ask: command` czekający na zgodę jest domyślnie
  otwarty, a ten sam wiersz z `isAnswered: true` zwinięty, oraz że klik w domyślnie otwarty
  wiersz go zwija (jawne `false`), jeśli istniejąca uprząż testowa ChatView na to pozwala
  bez nadmiernej rozbudowy; w przeciwnym razie test jednostkowy `handleToggleExpand` w
  ChatRow (wywołanie z `!isExpanded`).

Uruchomienie:
`pnpm --filter @roo-code/vscode-webview test src/components/chat/__tests__/CommandExecution.spec.tsx`
`pnpm --filter @roo-code/vscode-webview lint && pnpm --filter @roo-code/vscode-webview check-types`
`pnpm knip` (musi zakończyć się kodem 0 przed wypchnięciem)

## Wynik (uzupełnia implementacja)

Data wykonania: 2026-09-10. Branch: `fix/chat-command-row-collapsible`, bazowy commit `4d87b0d97`.

### Co zostało zrobione

Zaimplementowane zostały wszystkie cztery punkty sekcji "Zmiana", bez odstępstw merytorycznych.

W `webview-ui/src/components/chat/CommandExecution.tsx` cała treść pod nagłówkiem, czyli blok
`CodeBlock` z poleceniem, sekcja `TerminalOutput` z wyjściem oraz panel `CommandPatternSelector`,
została objęta jednym warunkiem `isExpanded`. W stanie zwiniętym żaden z tych trzech elementów nie
jest montowany w drzewie DOM, więc nie ma ani ukrytego znacznika, ani pracy związanej z konwersją
sekwencji ANSI. Szewron jest teraz renderowany bezwarunkowo, ponieważ polecenie istnieje zawsze,
także zanim pojawi się jakiekolwiek wyjście. Dodana została pamiętana przez `useMemo` wartość
`commandPreview`, która dzieli polecenie na linie, przycina każdą z nich, odrzuca linie puste, bierze
pierwszą pozostałą i dokleja znak wielokropka `…` (U+2026), jeśli niepustych linii jest więcej niż
jedna. Podgląd renderuje się wyłącznie w stanie zwiniętym, w lewej grupie nagłówka, ze stylem
`font-mono text-xs text-vscode-descriptionForeground truncate min-w-0`, a sama lewa grupa dostała
klasy `min-w-0 flex-1`, bez których klasa `truncate` nie ma czego uciąć. Logika `statusCache`,
kropki sygnalizującej działanie procesu i przycisku przerwania pozostała nietknięta, tak samo jak
roleta 500 px wewnątrz `CodeBlock`.

W `webview-ui/src/components/chat/ChatView.tsx` powstała stała `isCommandAwaitingApproval`, równa
`clineAsk === "command" && enableButtons`, czyli dokładnie warunkowi, przy którym na ekranie widać
przyciski "Run Command" i "Reject". Prop `isExpanded` przekazywany do wiersza to teraz
`expandedRows[ts] ?? (isLast && typ ask && ask === "command" && isCommandAwaitingApproval)`. Operator
`??` jest tu kluczowy, bo jawnie zapisane `false` (użytkownik zwinął wiersz) musi wygrać z domyślnym
otwarciem. Funkcja `toggleRowExpansion` przyjmuje drugi, opcjonalny argument `expand` i przekazuje go
do istniejącego `handleSetExpandedRow`, zachowując stabilną tożsamość referencyjną, co jest istotne,
bo `ChatRow` jest opakowany w `memo` z porównaniem `deepEqual` z pakietu fast-deep-equal, a to
porównuje funkcje po tożsamości.

W `webview-ui/src/components/chat/ChatRow.tsx` typ propsa zmienił się na
`onToggleExpand: (ts: number, expand?: boolean) => void`, a `handleToggleExpand` woła
`onToggleExpand(message.ts, !isExpanded)` i ma `isExpanded` na liście zależności. Dzięki temu
przełączanie odbywa się względem stanu wyświetlanego, a nie względem mapy rodzica, w której wiersz
otwarty domyślnie nie ma jeszcze żadnego wpisu. Nic innego w tym pliku się nie zmieniło.

Klucze i18n `chat:commandExecution.expandOutput` i `collapseOutput` zostały zastąpione przez
`expandCommand` i `collapseCommand` we wszystkich 18 locale, dokładnie w tym samym miejscu w pliku.
Przed zmianą sprawdzone zostało (przez `grep` po całym repozytorium), że jedynym konsumentem starych
kluczy był ten komponent i jego test.

Powstał changeset `.changeset/chat-command-row-collapsible.md` z nagłówkiem `"tumble-code": patch`.

### Pliki dotknięte

Kod produkcyjny: `webview-ui/src/components/chat/CommandExecution.tsx`,
`webview-ui/src/components/chat/ChatView.tsx`, `webview-ui/src/components/chat/ChatRow.tsx`.

Tłumaczenia: `webview-ui/src/i18n/locales/{ca,de,en,es,fr,hi,id,it,ja,ko,nl,pl,pt-BR,ru,tr,vi,zh-CN,zh-TW}/chat.json`,
po dwie linie w każdym pliku.

Testy: `webview-ui/src/components/chat/__tests__/CommandExecution.spec.tsx` (zmieniony),
`webview-ui/src/components/chat/__tests__/ChatView.command-row-expansion.spec.tsx` (nowy),
`webview-ui/src/components/chat/__tests__/ChatRow.command-expand-toggle.spec.tsx` (nowy).

Pozostałe: `.changeset/chat-command-row-collapsible.md` (nowy), ten plik planu.

### Testy dopisane i zmienione

Blok `describe("output collapsing")` został zastąpiony blokiem `describe("row collapsing")` z siedmioma
przypadkami: brak `code-block`, `terminal-output` i `command-pattern-selector` w DOM przy zwiniętym
wierszu, podgląd pierwszej linii z wielokropkiem dla polecenia wieloliniowego, podgląd bez wielokropka
dla jednoliniowego, brak podglądu po rozwinięciu, montaż całej trójki przy `isExpanded={true}`,
delegowanie kliknięcia do rodzica bez zmiany stanu lokalnego oraz obecność szewronu także wtedy, gdy
polecenie nie wyprodukowało wyjścia. Wszystkie istniejące testy, które sięgają po blok polecenia albo
po panel wzorców, dostały jawne `isExpanded={true}`. Pomocnicza funkcja `renderExpanded` została
rozważona i odrzucona, bo część testów używa własnego `ExtensionStateContext.Provider` zamiast
wspólnego `ExtensionStateWrapper`, więc jeden helper nie pokryłby obu stylów i diff byłby mniej
czytelny niż jawny prop w każdym miejscu.

Powstał osobny plik `ChatView.command-row-expansion.spec.tsx`, zbudowany na tej samej lekkiej uprzęży
co istniejący `ChatView.clear-approval-buttons.spec.tsx`. Sprawdza trzy rzeczy: wiersz `ask: command`
czekający na zgodę jest domyślnie otwarty, ten sam wiersz z `isAnswered: true` jest zwinięty, a
kliknięcie szewronu na wierszu otwartym domyślnie zwija go i to zwinięcie utrzymuje się mimo że
przyciski zgody nadal są na ekranie. Uprząż mockuje `ChatRow`, bo prawdziwy komponent jest zbyt ciężki
do zamontowania w tym teście, a przycisk w mocku jest okablowany dokładnie tak jak prawdziwe
`ChatRow.handleToggleExpand`.

Ponieważ mock `ChatRow` nie dowodzi zachowania samego `ChatRow`, dodany został drugi, wąski plik
`ChatRow.command-expand-toggle.spec.tsx`, który renderuje prawdziwy `ChatRowContent` z wiadomością
`ask: "command"` i klika prawdziwy szewron z `CommandExecution`. Sprawdza, że przy `isExpanded={false}`
rodzic dostaje `(ts, true)`, a przy `isExpanded={true}` dostaje `(ts, false)`. Ten plik musi mockować
domyślny eksport modułu `i18next`, ponieważ `ExtensionStateContextProvider` ciągnie za sobą
`src/i18n/setup.ts`, który w momencie importu woła `i18next.use(...).init(...)`.

### Weryfikacja i jej wyniki

`pnpm --filter @roo-code/vscode-webview test src/components/chat/__tests__/CommandExecution.spec.tsx`
zakończyło się wynikiem 1 plik testowy przeszedł, 42 testy przeszły, 0 nieudanych.

`pnpm --filter @roo-code/vscode-webview test src/components/chat src/i18n` zakończyło się wynikiem
42 pliki testowe przeszły, 444 testy przeszły, 0 nieudanych. Żaden test nie był pominięty i nie było
testów nieudanych z powodów niezwiązanych ze zmianą, więc nie było potrzeby dowodzenia niczego przez
porównanie z gałęzią `main`.

`pnpm --filter @roo-code/vscode-webview lint` zakończyło się kodem 0. Warto odnotować, że skrypt
uruchamia `eslint` z flagą `--max-warnings=0`, więc reguła `react-hooks/exhaustive-deps`, która w tym
repozytorium jest ostrzeżeniem, w praktyce blokuje build.

`pnpm --filter @roo-code/vscode-webview check-types` (czyli `tsc`) zakończyło się kodem 0.

`node scripts/find-missing-translations.js --area=webview --file=chat.json` zakończyło się kodem 0 i
raportem "No missing translations" dla wszystkich 17 nieangielskich locale.

`node scripts/find-missing-i18n-key.js --file=chat.json` kończy się kodem 1 i wypisuje ponad 21 tysięcy
linii, ale jest to szum niezależny od tej zmiany. Skrypt ignoruje własną flagę `--file`, traktuje każdy
napis w formie `foo:bar` jako klucz i18n oraz przechodzi rekurencyjnie po katalogu `src`, wchodząc do
`src/node_modules` i `src/dist`. Dowód, że to szum zastany, a nie skutek tej zmiany: utworzone zostało
robocze drzewo `git worktree add /tmp/roo-wt-main main`, ten sam skrypt uruchomiono na czystym `main`,
oba raporty porównano po odfiltrowaniu wpisów z `dist` i `node_modules`, i zbiór "tylko na main" był
pusty, a w raporcie z gałęzi nie ma ani jednego wpisu dotyczącego `commandExecution`. Drzewo robocze
zostało po weryfikacji usunięte.

`pnpm knip` z katalogu głównego repozytorium zakończyło się kodem 0 (wypisane pozycje należą do
kategorii ostrzeżeń, które nie łamią CI).

`git diff --cached | grep -nP '[\x{2013}\x{2014}]'` nie wypisało nic, czyli w zmianie nie ma ani
półpauzy, ani myślnika.

Dodatkowo uruchomiony został `npx prettier --check` na wszystkich dotkniętych plikach. Jedyny plik,
który nie przechodził, to `CommandExecution.spec.tsx`, i został sformatowany przez `prettier --write`,
po czym testy przebiegły ponownie z wynikiem 42 na 42.

### Odstępstwa od specyfikacji

Jedno, drobne i wymuszone przez linter. Specyfikacja mówiła, żeby do listy zależności `itemContent`
dopisać `clineAsk`. Zamiast tego dopisana została stała `isCommandAwaitingApproval`, która jest
dokładnie równa `clineAsk === "command" && enableButtons`. Powód: reguła `react-hooks/exhaustive-deps`
wymaga w liście zależności identyfikatora faktycznie użytego wewnątrz wywołania zwrotnego i
jednocześnie zgłasza ostrzeżenie o zbędnej zależności dla identyfikatora, który wewnątrz nie występuje.
Przy `--max-warnings=0` obie sytuacje przerywają lint, a że `isCommandAwaitingApproval` zmienia się
dokładnie wtedy, kiedy zmienia się `clineAsk` albo `enableButtons`, moment przeliczenia `itemContent`
jest identyczny z zamierzonym.

Poza tym w `itemContent` wyodrębniona została lokalna stała `isLast = index === groupedMessages.length - 1`,
bo wartość jest potrzebna w dwóch miejscach: w warunku domyślnego otwarcia i w propsie `isLast`.
Wcześniej to wyrażenie było wpisane bezpośrednio w propsie.

Sekcja "Świadomie pominięte" została uszanowana w całości. Nagłówek nie stał się klikalny, nie ma
automatycznego rozwijania przy niezerowym kodzie wyjścia, a roleta w `CodeBlock` nie została ruszona.

### Pytania i miejsca do obejrzenia przez recenzenta

Pierwsze. Podgląd polecenia siedzi w tej samej lewej grupie nagłówka co ikona, tytuł i kropka statusu.
Przy bardzo długim tytule wiersza podgląd zostanie ucięty wcześniej, niż mógłby, bo `flex-1` dzieli
miejsce między wszystkie dzieci grupy. Wygląd trzeba obejrzeć na żywo w zbudowanej paczce, bo testy
jednostkowe nie mówią nic o szerokościach.

Drugie. Margines `mb-1` na kontenerze nagłówka zostaje także w stanie zwiniętym, kiedy pod nagłówkiem
nie ma już nic. To kilka pikseli pustego miejsca pod zwiniętym wierszem. Zostało celowo nietknięte,
żeby nie zmieniać odstępów w stanie rozwiniętym, ale jeśli w praktyce razi, jest to jedna klasa do
przeniesienia na blok treści.

Trzecie. Domyślne otwarcie działa tylko dla ostatniej wiadomości na liście, zgodnie z warunkiem
`isLast`. Jeśli w trakcie oczekiwania na zgodę doklei się jakakolwiek nowa wiadomość poniżej, wiersz
polecenia przestanie być ostatni i zwinie się, mimo że przyciski zgody nadal będą widoczne. W obecnym
przepływie po prośbie o zgodę nic się nie dokleja, ale warto o tym pamiętać przy zmianach kolejności
wiadomości.

Czwarte. Test `ChatView.command-row-expansion.spec.tsx` mockuje `ChatRow` i sam odtwarza jego
okablowanie, więc dowodzi zachowania `ChatView`, a nie `ChatRow`. Zachowanie samego `ChatRow` jest
pokryte osobno przez `ChatRow.command-expand-toggle.spec.tsx`. Recenzent, który wolałby jeden test
pełnej integracji, musiałby zamontować prawdziwy `ChatRow` w `ChatView`, co wymaga mockowania sporej
części drzewa renderowania (Markdown, Mermaid, podświetlanie składni) i zostało uznane za nieopłacalne.
