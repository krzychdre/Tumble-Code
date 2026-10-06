# CLI: tokeny wysłane i pobrane na żywo w wierszu spinnera

**Status:** gotowe na gałęzi `feat/cli-live-token-counts` (trzecia w stosie, na `feat/cli-model-switch`).
**Powiązane plany:** `2026-09-23_19-21_cli-spinner-step-timer.md` (znacznik kroku `markStepStarted`).
**Dotknięte pliki:** `apps/cli/src/agent/transcript-reducer.ts`, `apps/cli/src/ui/store.ts`,
`apps/cli/src/ui/hooks/useTranscriptSink.ts`, `apps/cli/src/ui/utils/liveTokens.ts` (nowy),
`apps/cli/src/ui/components/Spinner.tsx`, `apps/cli/src/ui/App.tsx`, testy i snapshot charakteryzacji.

## Objaw

Licznik `↓ N tokens` w spinnerze zmieniał się tylko po przejściu do następnego kroku; przez cały czas
generowania odpowiedzi (często minuty) stał w miejscu. Tokenów wysłanych nie było wcale.

## Co się działo

- Spinner dostawał `tokenUsage.totalTokensOut`, liczone przez `consolidateTokenUsage` z wiadomości
  `api_req_started` w `clineMessages`.
- Rdzeń zapisuje `tokensIn`/`tokensOut` do tej wiadomości wyłącznie w `updateApiReqMsg`
  (`src/core/task/TaskStreamProcessor.ts`, `createUpdateApiReqMsgFn`), wywoływanym z
  `createBackgroundUsageDrain` po odebraniu fragmentu `usage`. Na początku zapytania wiadomość ma tylko
  `{ apiProtocol }` (`TaskApiLoop.ts`, okolice `say("api_req_started", ...)`).
- Serwer zgodny z OpenAI (`stream_options.include_usage`) wysyła `usage` dopiero w ostatnim fragmencie
  strumienia, więc prawdziwe liczby nie istnieją, dopóki odpowiedź się nie skończy.

## Zmiana

- Reduktor: gdy `api_req_started` ma już `tokensIn` lub `tokensOut`, emituje `markStepCounted(ts)`;
  sklep trzyma `stepCountedAt` (tylko do przodu, jak `stepStartedAt`).
- Dopóki `stepCountedAt < stepStartedAt` (zapytanie trwa), `App` liczy szacunek
  `estimateStepOutputTokens(messages, stepStartedAt)`: znaki odpowiedzi, rozumowania i wywołań narzędzi
  (z treścią pisanego pliku z `toolData`) od początku kroku, podzielone przez 4. Pomija wyjście poleceń,
  odpowiedzi MCP i wiersze dodane przez samo CLI.
- Spinner pokazuje `↑ <wysłane> ↓ <pobrane> tokens`; pobrane w trakcie strumienia to suma potwierdzona
  plus szacunek, oznaczona `~`. Liczby odświeżają się raz na sekundę, w takcie istniejącego zegara.

## Przed / po

| Sytuacja | Przed | Po |
| --- | --- | --- |
| Model generuje odpowiedź przez 2 min | `↓ 70.9K` bez zmian | `↓ ~71.4K`, `~72.0K`, ... co sekundę |
| Koniec zapytania | skok do prawdziwej sumy | prawdziwa suma, bez `~` |
| Tokeny wysłane | niewidoczne | `↑ 120.4K` (potwierdzone przez serwer) |

## Testy

- `liveTokens.test.ts`: liczenie znaków kroku, treść pliku z wywołania narzędzia, pomijanie obcych wierszy.
- `Spinner.test.tsx`: `formatTokens`; liczby zmieniają się na takt zegara, nie przy każdej zmianie props.
- `transcript-reducer.test.ts`: `markStepCounted` dopiero po raporcie tokenów, nie dla tekstu, który nie jest JSON.
- Snapshot `App.characterization`: 13 linii spinnera z nowym przyrostkiem `↓ ~N tokens`, nic poza tym.

## Uwagi

- Tokeny wysłane są znane dopiero z raportu serwera na końcu zapytania, więc `↑` zmienia się raz na krok;
  zapytanie wychodzi w całości na początku, nie strumieniem.
- Szacunek 4 znaki na token zaniża tekst polski (bliżej 3); po końcu zapytania i tak zastępuje go wartość z serwera.
