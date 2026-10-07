# Ponowienie pustej odpowiedzi z podpowiedzią o dostępnych narzędziach

**Status:** gotowe na gałęzi `fix/empty-response-retry-hint`.
**Powiązane:** inne gałęzie poprawiają stronę promptu (model w trybie Orchestrator nie powinien w ogóle sądzić,
że ma `execute_command`); ta gałąź zmienia tylko ponowienie po pustej odpowiedzi, niezależnie od wyzwalacza.
**Dotknięte pliki:** `src/core/task/TaskApiLoop.ts`, `src/core/prompts/responses.ts`,
`src/core/task/__tests__/TaskApiLoop.empty-response-retry-hint.spec.ts`, `.changeset/empty-response-retry-hint.md`.

## Objaw

Zadanie w trybie Orchestrator (GLM-5.3-Flash na vLLM) kręciło się bez końca. Tryb nie ma narzędzia
`execute_command`, ale model uznał, że je ma, i je wywołał. Parser narzędzi GLM w vLLM działa z
`validate_tool_names=True` i bez błędu wyrzuca wywołanie narzędzia, którego nie ma na liście `tools` zapytania.
Klient dostał więc samo rozumowanie („I need to actually call the tool. Run stats command.”), bez tekstu i bez
wywołania narzędzia. Zapisane `ui_messages` pokazują 4-5 razy z rzędu ten sam cykl: `api_req_started`
(~50-90 tokenów wyjściowych), `reasoning`, `api_req_retry_delayed` „Unexpected API Response: The language model
did not provide any assistant messages”, `error MODEL_NO_ASSISTANT_MESSAGES`, aż użytkownik zatrzymał zadanie.

## Przyczyna

- `TaskApiLoop.handleEmptyAssistantResponse` (stan na `main`) wkładał na stos ponowienie z identycznym
  `currentUserContent`. Model ze sztywnymi regułami w identycznym kontekście podejmuje identyczną decyzję, więc
  takie ponowienie nie mogło się udać.
- Istniejąca informacja zwrotna „Unknown tool” (`src/core/tools/validateToolUse.ts`,
  `presentAssistantMessage.ts`) nie zadziałała, bo wywołanie nigdy nie dotarło do klienta.
- Ścieżka ręczna (użytkownik klika Retry) miała drugi błąd: funkcja zdejmuje z historii ostatnią wiadomość
  użytkownika, ale ponowienie nie ustawiało `userMessageWasRemoved`. Przy `retryAttempt > 0`
  `prepareUserContent` nie dodaje wtedy wiadomości z powrotem, więc ponowione zapytanie kończyło się turą
  asystenta i w ogóle nie zawierało treści użytkownika.

## Poprawka

- `formatResponse.emptyResponseRetryNote(toolNames)` w `src/core/prompts/responses.ts`: krótka, dosłowna notatka
  po angielsku dla słabych modeli. Treść (dla listy narzędzi):
  `[ERROR] Your previous reply produced no text and no tool call that reached the system.` /
  `A call to a tool that is not in your tool list is rejected by the server and discarded.` /
  `The tools you can call now are: <nazwy>.` / `Reply with one of these tools, or with plain text.`
  Bez narzędzi ostatnia część brzmi `You have no tools in this request. Reply with plain text.`
  `formatResponse.isEmptyResponseRetryNote(text)` rozpoznaje notatkę po pierwszym zdaniu (nie po samym
  `[ERROR]`, którym zaczyna się też `noToolsUsed`).
- `TaskApiLoop.attemptApiRequest` zapamiętuje nazwy narzędzi zapytania w `lastRequestToolNames`:
  `allowedFunctionNames`, gdy jest ustawione (wtedy dostawca dostaje wszystkie narzędzia, ale wywołać może
  tylko te, łącznie z odroczonymi), w przeciwnym razie nazwy funkcji z `allTools`. Zapamiętanie zamiast
  ponownego `buildToolsArray`: to dokładnie ten zbiór, względem którego serwer odrzucił wywołanie, a ponowne
  budowanie ma skutek uboczny (czyści i wypełnia katalog narzędzi odroczonych) i odpytuje MCP. Razem z nazwami
  zapamiętany jest tryb (`lastRequestToolsMode`). Gdy użytkownik zmieni tryb między pustą odpowiedzią a kliknięciem
  Retry, nazwy należą do starego trybu, więc notatka ich nie wymienia i mówi tylko "Use only the tools in your tool
  list, or reply with plain text.".
- `handleEmptyAssistantResponse` buduje `retryUserContent = withEmptyResponseRetryNote(currentUserContent)`:
  nowa tablica (tablica wywołującego się nie zmienia), notatka z wcześniejszego ponowienia jest usuwana,
  nowa dopisywana na końcu, więc przy kolejnych pustych odpowiedziach w treści jest zawsze dokładnie jedna.
  Obie ścieżki (auto-approve lub zadanie w tle z backoffem oraz ręczny Retry) wkładają na stos
  `retryUserContent` z `userMessageWasRemoved: true`. Historia zostaje poprawna: zdjęta wiadomość użytkownika
  wraca jako jedna wiadomość z notatką (przed `environment_details`), nigdy dwie wiadomości użytkownika z rzędu.
- Bez zmian: `reportEmptyResponse`, wiersz `MODEL_NO_ASSISTANT_MESSAGES` od drugiej pustej odpowiedzi, backoff,
  obsługa przerwania, ścieżka „Failure: I did not provide a response.” po odmowie (zapisuje treść taką, jaka
  była wysłana).

## Testy

`src/core/task/__tests__/TaskApiLoop.empty-response-retry-hint.spec.ts` (7 testów):
dokładny tekst notatki; ponowienie auto-approve niesie notatkę z nazwami funkcji ostatniego zapytania i nie
zmienia tablicy wywołującego; `allowedFunctionNames` wygrywa z `allTools`; cztery puste odpowiedzi z rzędu
zostawiają jedną notatkę (i trzy wiersze błędu); ręczny Retry niesie notatkę i ustawia
`userMessageWasRemoved`; odmowa zapisuje historię jak dawniej; odpowiedź niepusta kolejkuje wyniki narzędzi bez
notatki.

```
cd src && ./node_modules/.bin/vitest run core/task/__tests__/TaskApiLoop.empty-response-retry-hint.spec.ts --maxWorkers=2
```
