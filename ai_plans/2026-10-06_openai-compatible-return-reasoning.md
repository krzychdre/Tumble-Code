# OpenAI-compatible: odsyłanie rozumowania do modelu, poziom Max, usunięcie „Enable R1 model parameters”

Gałąź: `feat/openai-compatible-return-reasoning` (bez commitów do czasu testu w działaniu).

## Problem (z dowodami)

Profil OpenAI-compatible (np. lokalny GLM-5.3-Flash na vLLM za llama-swap) nigdy nie odsyła
modelowi jego wcześniejszego rozumowania:

1. `ApiRequestBuilder.buildCleanConversationHistory` usuwa bloki `reasoning`, bo metadane modelu
   w tym profilu (wpisywane przez użytkownika) nie mają `preserveReasoning: true`.
2. `convertToOpenAiMessages` i tak pomija bloki `reasoning`.

Dowód z rejestratora zapytań (`llm_exchanges`, ostatnie zapytanie Flasha 2026-10-05 17:57 UTC,
suma kontrolna zgodna): 88 wiadomości asystenta, 0 z `reasoning_content`, 0 z `<think>`.
Test na żywym serwerze: model wylosował w rozumowaniu 483729; bez rozumowania w historii
odpowiedział, że nie ma do niego dostępu, z rozumowaniem podał 483729.

Dodatkowo vLLM (`0.26.1rc0+glm53`) czyta z wiadomości asystenta pole `reasoning`, a pole
`reasoning_content` po cichu ignoruje. Gdy są oba, bierze `reasoning` i niczego nie dubluje.
API Z.ai i DeepSeek oczekują `reasoning_content`. Dlatego odsyłamy oba pola.

Poziom rozumowania w UI OpenAI-compatible kończy się na `xhigh`, choć schemat
(`reasoningEffortExtendedSchema`) zna `max`, a GLM-5.3 przyjmuje `low`/`high`/`max`.

`clear_thinking: false` jest dziś wysyłane tylko przy poziomie medium/high/xhigh, czyli
zależy od poziomu, a powinno zależeć od tego, czy odsyłamy rozumowanie.

## Projekt

- Nowe pole profilu `openAiPreserveReasoning?: boolean` (schemat `openAiCompatibleConfigSchema`).
  W UI checkbox „Return reasoning to the model” z opisem.
- `OpenAiHandler.getModel()` ustawia `info.preserveReasoning` z tego pola. Dzięki temu istniejący
  mechanizm (`buildCleanConversationHistory(..., preserveReasoning)`) zostawia bloki rozumowania,
  decyzja zapada per zapytanie z bieżącego handlera, więc przełączenie trybu w trakcie zadania
  działa poprawnie (historia zawsze przechowuje rozumowanie).
- Przy włączonym polu wiadomości są konwertowane przez `convertToR1Format(..., { mergeToolResultText: true })`
  (system zostaje wiadomością systemową), a rozumowanie trafia do wiadomości asystenta jako
  `reasoning_content` i `reasoning`. Inni dostawcy korzystający z konwertera nie zmieniają ładunku.
- GLM: `thinking.clear_thinking: false` wtedy i tylko wtedy, gdy odsyłamy rozumowanie;
  poziom rozumowania idzie osobno jako `reasoning_effort` (łącznie z `max`).
- Usunięcie `openAiR1FormatEnabled` (UI, schemat, handler, i18n). Schemat jest `.strict()`, więc
  zapisane profile wymagają migracji: `openAiR1FormatEnabled: true` przechodzi na
  `openAiPreserveReasoning: true` (to była intencja: format R1 z rozumowaniem), klucz znika.
  Automatyczne rozpoznanie `deepseek-reasoner` po identyfikatorze modelu zostaje.
- `max` jako wybieralny poziom w UI OpenAI-compatible i w CLI.
- CLI: klucz w `cli-settings.json` mapowany na nowe pole; `reasoningEffort: "max"` musi dojść do
  zapytania (w analizie 2026-10-05 CLI wysyłało `low` mimo `max` w ustawieniach).

## Podział pracy

- Agent core: `packages/types`, `src/` (handler, konwerter, migracja, testy).
- Agent webview: `webview-ui/` (checkbox, usunięcie R1FormatSetting, `max`, i18n wszystkich
  języków, indeks wyszukiwania ustawień, testy).
- Agent CLI: `apps/cli/` (klucz ustawień, `max`, README, testy).

## Weryfikacja

- Testy jednostkowe na najniższej warstwie: konwersja wiadomości i parametry zapytania w
  `openai.spec.ts`, migracja profilu, render checkboxa w webview, mapowanie w CLI.
- `pnpm check-types`, `pnpm lint`, `pnpm knip`.
- Ręcznie po przebudowie VSIX: zapytanie Flasha w rejestratorze ma `reasoning` i `reasoning_content`
  w wiadomościach asystenta oraz `clear_thinking: false`; porównanie odsetka tur z rozumowaniem.
