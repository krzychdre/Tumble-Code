# Przycinanie starego rozumowania przy zapełnionym kontekście (`openAiTrimOldReasoning`)

**Status:** zrealizowane na gałęzi `feat/trim-old-reasoning` (rdzeń, webview, CLI; przegląd w trzech perspektywach, 5 z 8 zarzutów potwierdzonych i poprawionych).
**Powiązane plany:** `2026-10-06_openai-compatible-return-reasoning.md` (checkbox „Return reasoning to the model”),
`archive/2026-06/2026-06-07_microcompact-nondestructive.md` (microcompact przy wysyłce).
**Zasady:** DRY (jedna ścieżka decyzji „wycięte przy wysyłce” dla wyników narzędzi i rozumowania), YAGNI (tylko
przycinanie deterministyczne, bez streszczeń przez model, bez nowej telemetrii), OCP (rdzeń nie wie nic o
dostawcy, dostaje jedną flagę; nowy rodzaj przycinanych treści to nowy moduł obok, a nie zmiana starego).

## Problem (z pomiarów 2026-10-07, 14 zadań CLI, GLM-5.3 i Flash)

- Przy włączonym „Return reasoning to the model” każda tura asystenta wraca do modelu z pełnym blokiem
  rozumowania. To 20-38% historii w zadaniach z dużą ilością myślenia (zadanie `01a1119d`: ~110k z ~312k tokenów).
- Serwer trafia w prefix cache w 94-98% tokenów wejściowych, więc stare rozumowanie prawie nie kosztuje
  obliczeń. Kosztuje miejsce w oknie (wcześniejsza, stratna kondensacja), szybkość dekodowania i cenę
  odczytów z cache.
- Zmiana starych wiadomości przy każdym zapytaniu zabiłaby cache, dlatego przycinanie musi być:
  (1) uruchamiane dopiero pod presją, (2) stabilne między zapytaniami, (3) deterministyczne.
- Rozkład: bloki > 500 tokenów to 33% bloków i 78% rozumowania. Ustalenia („found”, „root cause”,
  „confirmed”) są najgęstsze na początku bloku, ale występują w całym bloku; plany („let me”, „next”) rosną
  ku końcowi. Duplikatów prawie nie ma (1% z wyników narzędzi, 3% z wywołania narzędzia tej tury).
- Reguła akapitowa (początek ~100 tokenów + ostatni akapit + akapity z ustaleniami) oszczędza ~50%
  rozumowania i zachowuje wszystkie akapity z ustaleniami. Przykład z zadania: 2695 → 921 tokenów.

## Projekt

### Ustawienie (włączane przez użytkownika, domyślnie wyłączone)

- Profil: `openAiTrimOldReasoning?: boolean` w `openAiCompatibleConfigSchema`
  (`packages/types/src/provider-config/shared.ts`), obok `openAiPreserveReasoning`.
- Webview: checkbox „Shorten old reasoning when the context fills up” wcięty pod „Return reasoning to the
  model” w `webview-ui/src/components/settings/providers/OpenAICompatible.tsx`, widoczny tylko gdy
  `openAiPreserveReasoning` jest włączone. Klucze i18n `settings:providers.trimOldReasoning.label` i
  `.description` we wszystkich 18 językach.
- CLI: `models.<id>.trimOldReasoning?: boolean` w `cli-settings.json`; `toProviderSettings` zawsze zapisuje
  `openAiTrimOldReasoning` (`?? false`), tak samo jak `openAiPreserveReasoning` (stan rozszerzenia jest
  scalany kluczami, więc stara wartość nie może przetrwać). Walidacja jak `preserveReasoning`. README.

### Bramka (jedno miejsce)

`shouldTrimOldReasoning(settings, modelInfo)` w module rdzenia: `settings.apiProvider === "openai" &&
settings.openAiTrimOldReasoning === true && modelInfo.preserveReasoning === true`. Bez odsyłania rozumowania
nie ma czego przycinać. Sprawdzenie dostawcy jest konieczne (poprawka po przeglądzie): ustawienia dostawców to
jeden płaski obiekt, więc `openAiTrimOldReasoning=true` przeżywa zmianę dostawcy profilu (lista rozwijana
zmienia tylko `apiProvider`) i start CLI z innym dostawcą (stan rozszerzenia jest scalany kluczami). Modele
Z.ai, DeepSeek, Moonshot, MiniMax i część Bedrock same deklarują `preserveReasoning: true`, więc bez tego
sprawdzenia nieaktualna wartość przycinałaby ich rozumowanie, choć tam nie ma checkboxa, który by to wyłączył.

### Moduł rdzenia: `src/core/context-management/reasoningTrim.ts` (nowy, czysty, bez I/O)

Stałe (eksportowane, udokumentowane liczbami z pomiarów):

- `REASONING_TRIM_MIN_CHARS = 2_000` (~500 tokenów): krótszy blok nigdy nie jest przycinany.
- `REASONING_TRIM_HEAD_CHARS = 400` (~100 tokenów): tyle początku zostaje zawsze (pełne akapity).
- `REASONING_TRIM_KEEP_RECENT = 3`: rozumowanie z 3 najnowszych wiadomości asystenta jest nietykalne.
- `REASONING_FINDING_PATTERN`: wyrażenie regularne słów-ustaleń (angielskie + kilka polskich rdzeni).
- `REASONING_TRIM_MARKER(n)`: `[... ${n} paragraph(s) of earlier reasoning omitted to save context ...]`
  (ASCII, bez długich myślników).

Funkcje:

- `reasoningTrimKey(ts: number): string` → `"reasoning:" + ts`. Klucz w TYM SAMYM zbiorze co tool_use_id
  wyników wyciętych przez microcompact (`Task.microcompactedIds`). Prefiks nie koliduje z id narzędzi.
- `trimReasoningText(text: string): string | undefined`. Dzieli na akapity (pusta linia). Zostawia: akapity
  początku aż do `HEAD_CHARS`, ostatni akapit, każdy akapit pasujący do `FINDING_PATTERN`. Każdy ciąg
  usuniętych akapitów zastępuje jednym znacznikiem. Zwraca `undefined`, gdy blok krótszy niż `MIN_CHARS`,
  gdy nie da się usunąć żadnego akapitu albo gdy wynik nie jest krótszy. Czysta funkcja: ten sam tekst daje
  zawsze ten sam wynik (stabilność cache).
- `selectReasoningTrims(messages, { targetChars, alreadyTrimmed })` → `{ keys: string[]; reclaimedChars }`.
  Kandydaci: wiadomości asystenta z `ts`, z pierwszym blokiem `{ type: "reasoning", text: string }`, bez
  ostatnich `KEEP_RECENT` wiadomości asystenta, dla których `trimReasoningText` coś daje. Najpierw wszystkie
  klucze z `alreadyTrimmed`, które nadal wskazują kandydata (zbiór tylko rośnie, cache), potem od najstarszych
  aż `reclaimedChars >= targetChars`. Działa na historii efektywnej (to, co naprawdę idzie do modelu).
- `applyReasoningTrims(messages, ids: ReadonlySet<string>)` → ta sama referencja, gdy nic nie pasuje; inaczej
  kopia, w której blok rozumowania wskazanych wiadomości ma tekst `trimReasoningText(text)`. Nie mutuje
  wejścia. Ignoruje klucze, które nie są kluczami rozumowania.
- `shouldTrimOldReasoning(settings, modelInfo)` (bramka powyżej).

### Wpięcie (DRY: ścieżka microcompact, bez nowych pól w Task)

- `manageContext` (`src/core/context-management/index.ts`): nowa opcja `trimOldReasoning?: boolean`.
  W bloku pre-pass (gdy `overCondenseThreshold || overAllowedTokens`), PRZED wynikami narzędzi:
  `selectReasoningTrims(..., { targetChars, alreadyTrimmed: previouslyClearedIds })`, potem
  `microcompactToolResults` z celem pomniejszonym o odzyskane znaki (zero, gdy rozumowanie wystarczyło;
  klucze narzędzi z poprzedniego zapytania i tak są przenoszone). Wynik: `microcompactClearedIds` zawiera
  klucze obu rodzajów; `microcompactTokensCleared` obejmuje też rozumowanie (znaki /
  `MICROCOMPACT_CHARS_PER_TOKEN`, ta sama skala co `estimateTokenCount`). Reszta (ścieżka „wystarczy, nie
  kondensuj”, `nextMicrocompactStrippedTokens`, wymuszony pass po błędzie okna) działa bez zmian.
  Kolejność: rozumowanie przed wynikami narzędzi, bo przycięte rozumowanie zachowuje ustalenia i nie wymaga
  akcji naprawczej, a wycięty wynik narzędzia może kosztować ponowne czytanie pliku (dodatkowe zapytanie).
  Telemetria bez nowych pól (YAGNI); `tokensCleared` po prostu obejmuje rozumowanie.
- `TaskContextManager`: oba wywołania `manageContext` (zwykłe i wymuszone) dostają
  `trimOldReasoning: shouldTrimOldReasoning(this.access.apiConfiguration, this.access.api.getModel().info)`.
- `ApiRequestBuilder.buildCleanConversationHistory`: po `applyMicrocompactCleared` także
  `applyReasoningTrims(sourceMessages, microcompactedIds)` (ten sam zbiór).
- Komentarze przy `microcompactedIds` / `microcompactClearedIds` / `previouslyClearedIds` mówią, że zbiór
  trzyma tool_use_id wyników i klucze `reasoning:<ts>`.

## Podział pracy (równolegle, rozłączne pliki)

| Agent     | Pliki                                                                                          | Zależność |
| --------- | ---------------------------------------------------------------------------------------------- | --------- |
| A rdzeń   | `reasoningTrim.ts` + `__tests__/reasoningTrim.spec.ts`                                         | brak      |
| B wpięcie | `context-management/index.ts`, `TaskContextManager.ts`, `ApiRequestBuilder.ts` + ich testy     | po A      |
| C webview | `OpenAICompatible.tsx`, 18× `settings.json`, spec komponentu, ew. indeks wyszukiwania ustawień | brak      |
| D CLI     | `apps/cli` (`types.ts`, `model-settings.ts`, `provider-config.ts`, README) + testy             | brak      |

Następnie przegląd w trzech perspektywach (poprawność i stabilność cache; DRY/YAGNI/OCP i czytelność;
spójność UI, i18n i CLI), weryfikacja każdego zarzutu przez niezależnych sceptyków, poprawki, bramki CI.

## Przed / po

| Sytuacja                                         | Przed                                                 | Po (ustawienie włączone)                                                                         |
| ------------------------------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Kontekst poniżej progu kondensacji               | pełne rozumowanie                                     | bez zmian, cache jak dotąd                                                                       |
| Próg osiągnięty                                  | wycinanie starych wyników narzędzi, potem kondensacja | najpierw przycięcie długich starych bloków rozumowania, potem wyniki narzędzi, potem kondensacja |
| Kolejne zapytania po przycięciu                  | n/d                                                   | te same bloki przycięte identycznie, cache trafia                                                |
| Ustawienie wyłączone lub rozumowanie nieodsyłane | n/d                                                   | zachowanie dokładnie jak dziś                                                                    |

## Testy

Opisane przy agentach; dodatkowo odtworzenie reguły na prawdziwych historiach zadań (ile oszczędza).

## Uwagi

- Słowa-ustalenia są głównie angielskie; GLM rozumuje po angielsku w zmierzonych zadaniach.
- Blok bez podziału na akapity nie jest przycinany (YAGNI: zdania jako jednostka dopiero, gdy dane pokażą potrzebę).
- Wpływ na jakość pracy agenta warto sprawdzić zestawem agent-bench (5 zadań × 2 przebiegi GLM-5.3-Flash).

## Wynik na prawdziwych danych (2026-10-07)

`selectReasoningTrims` + `applyReasoningTrims` bez limitu celu, na historiach 14 ostatnich zadań CLI
(`~/.vscode-mock/global-storage/tasks`): rozumowanie 317 965 → 202 686 tokenów (36% mniej), cała historia
7,2% mniejsza; w zadaniach z dużą ilością myślenia historia maleje o 17-40% (np. `01a1158e` 39,5%,
`01a11315` 19,7%, `01a110c8` 16,7%). Zadanie skondensowane (`01a1119d`) zyskuje mało, bo liczy się tylko
historia efektywna. Dwa przebiegi dały identyczny wynik (determinizm, stabilność cache).

## Poprawki po przeglądzie

- Bramka sprawdza też `apiProvider === "openai"`: ustawienia dostawcy to jeden płaski obiekt, więc
  `openAiTrimOldReasoning: true` przetrwałby przełączenie profilu na Z.ai (którego modele mają
  `preserveReasoning` z tabeli) i przycinałby tam rozumowanie bez widocznego checkboxa.
- Changesety: `tumble-code` (rdzeń + webview) i osobny dla `@tumble-code/cli`.
- Opis w 18 językach dopasowany do zachowania (próg kondensacji albo limit okna; co dokładnie zostaje).
