# new_task: bezpiecznik przeciw pętli samodelegowania

**Status:** gotowe na gałęzi `fix/new-task-delegation-guard`.
**Powiązane:** gałąź siostrzana poprawia komunikat `read_file` o obrazie (przyczyna tego konkretnego incydentu)
oraz błędne `rootTaskId`; ta gałąź to ogólna siatka bezpieczeństwa w `new_task`, niezależna od wyzwalacza.
**Dotknięte pliki:** `src/core/tools/NewTaskTool.ts`, `src/core/prompts/tools/native-tools/new_task.ts`,
`src/core/tools/__tests__/newTaskTool.spec.ts`, `.changeset/new-task-delegation-guard.md`.

## Objaw

Zadanie na modelu tylko tekstowym (GLM-5.3, profil `GLM-5.3-NVFP4-HIGH`) miało obejrzeć zrzut ekranu.
`read_file` kazał przekazać obraz do trybu z obsługą obrazów; takiego trybu nie było, więc model wywołał
`new_task(mode "ask", ...)`. Każde zadanie potomne w trybie Ask, na tym samym modelu i tym samym profilu,
zrobiło dokładnie to samo. Wynik: jeden łańcuch 91 zagnieżdżonych zadań (korzeń
`01a11598-6328-743d-87f3-24f02ad97650` w trybie `code`, dalej `ask -> ask -> ask ...`, czasem `orchestrator`),
każde po 38k-100k tokenów wejściowych, aż użytkownik je zatrzymał. Odczytane z
`~/.config/Code/User/globalStorage/qub-it.tumble-code/tasks/<id>/history_item.json` (pola `mode`,
`parentTaskId`, `apiConfigName`): wszystkie poziomy mają ten sam `apiConfigName`, a `rootTaskId` wskazuje
zwykle rodzica, nie korzeń.

## Co się działo

- `src/core/tools/NewTaskTool.ts:101` (stan na `main`) sprawdzał tylko, czy tryb istnieje, a `:126` od razu
  delegował przez `provider.delegateParentAndOpenChild`. Jedyna odmowa dotyczyła podzadań w tle
  (`task.isBackground`).
- `src/core/webview/DelegationService.ts:187` (`delegate`) tworzy dziecko bez żadnego limitu głębokości.
- Tryb ma przypisany dokładnie jeden profil dostawcy: `modeApiConfigs[mode]`
  (`ProviderSettingsManager.getModeConfigId`, rozwiązywane w `ModeProfileBinding.resolve`), w CLI
  `cli-settings.json modes[mode]`, a przy blokadzie profilu wszystkie tryby mają profil bieżący. Aktywacja
  profilu przypisuje go do bieżącego trybu (`ModeProfileBinding.activateProviderProfile`). Dziecko w tym samym
  trybie dostaje więc ten sam model i te same narzędzia co rodzic, czyli nie potrafi niczego więcej.

## Przed / po

| Sytuacja                                                  | Przed               | Po                                                                        |
| --------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------- |
| Zadanie użytkownika (poziom 0) deleguje do własnego trybu | dozwolone           | dozwolone (świeży kontekst)                                               |
| Podzadanie deleguje do własnego trybu (`ask -> ask`)      | dozwolone, pętla    | odmowa, błąd narzędzia uczący, co zrobić                                  |
| `orchestrator -> code -> ask`                             | dozwolone           | dozwolone                                                                 |
| Dziecko na poziomie 5                                     | dozwolone           | dozwolone                                                                 |
| Dziecko na poziomie 6 i głębiej                           | dozwolone bez końca | odmowa                                                                    |
| Model ponawia odrzucone `new_task`                        | nie dotyczy         | każda odmowa liczy się jako pomyłka, limit pomyłek pyta użytkownika       |
| Incydent 2026-10-07                                       | 91 zadań w łańcuchu | 2 zadania: `ask` na poziomie 1 dostaje odmowę przy pierwszym `ask -> ask` |

## Poprawka

`NewTaskTool.delegationRefusal` sprawdza dwie rzeczy po walidacji trybu, a przed pytaniem użytkownika o zgodę:

1. **Ten sam tryb z podzadania.** Jeśli zadanie ma `parentTaskId` i jego bieżący tryb (`getTaskMode()`, więc
   po `switch_mode` liczy się tryb aktualny) równa się trybowi docelowemu, odmowa. Profilu nie porównujemy,
   bo tryb wyznacza jeden profil (patrz wyżej); porównanie niczego by nie zmieniło.
2. **Limit głębokości `MAX_DELEGATION_DEPTH = 5`.** Zadanie użytkownika to poziom 0. Głębokość liczymy,
   idąc po `parentTaskId` przez historię zadań (`provider.getHistoryItem`), zaczynając od
   `task.parentTaskId`; `rootTaskId` jest pomijane, bo bywa błędne. Obiekty `parentTask` też nie, bo po
   powrocie z dziecka rodzic jest odtwarzany z historii bez nich. Pętla kończy się najpóźniej po 5 krokach,
   więc łańcuch zapętlony (błędne dane) nie zawiesza narzędzia; brakujący wpis w historii przerywa liczenie.
   Dlaczego 5: zwykły łańcuch `orchestrator -> code -> pomocnik` ma 2-3 poziomy, 5 zostawia zapas na
   orkiestrator w orkiestratorze, a każdy poziom to pełny prompt systemowy i kontekst (38k-100k tokenów).

Teksty błędów (dla modelu, po angielsku jak pozostałe błędy narzędzi):

- `new_task refused: this task is already a subtask in "ask" mode, and a new "ask" subtask would run the same
model with the same tools, so it could not do anything this task cannot. Do the work yourself in this task.
If it cannot be done here, finish with attempt_completion and explain what could not be done and why, so
the parent task can decide what to do next.`
- `new_task refused: this task is already 5 levels of subtasks below the task the user started, which is the
limit (5). Do the work yourself in this task. ...` (ta sama końcówka).

Odmowa idzie przez `recordFailure` bez `failTurn`: zwiększa licznik pomyłek (model, który uparcie ponawia,
dojdzie do limitu i system zapyta użytkownika), ale nie blokuje `attempt_completion` w tej samej turze.
Zerowanie licznika przesunięto za bezpiecznik, inaczej każda odmowa zaczynałaby od zera.

Opis narzędzia `new_task` dostał jedno zdanie o obu regułach, żeby słabszy model wiedział o nich z góry.
Bez nowego ustawienia: limit jest bezpiecznikiem, nie preferencją, a w kodzie nie ma podobnych limitów
konfigurowanych przez użytkownika.

## Testy

`src/core/tools/__tests__/newTaskTool.spec.ts`, blok `newTaskTool delegation guard`:

- odmowa `ask -> ask` z podzadania (bez pytania o zgodę, licznik pomyłek 1, tekst wskazuje `attempt_completion`);
- zadanie użytkownika deleguje do własnego trybu: dozwolone;
- `orchestrator -> code -> ask`: dozwolone;
- dziecko na poziomie 5: dozwolone; na poziomie 6: odmowa (granica w obie strony);
- zapętlony łańcuch: dokładnie 5 odczytów historii, odmowa;
- rodzic usunięty z historii: liczenie się kończy, delegacja dozwolona.

Z wyłączonym bezpiecznikiem trzy testy odmów nie przechodzą (sprawdzone).

## Uwagi

- Rzadki wyjątek: zadanie odtworzone z historii zachowuje własny profil (`apiConfigName`), nawet jeśli tryb ma
  już przypisany inny. Wtedy dziecko w tym samym trybie dostałoby inny model, a mimo to dostaje odmowę.
  Uznajemy to za akceptowalne: użytkownik może zawsze sam uruchomić zadanie w innym profilu.
- Podzadania w tle (`run_parallel_tasks`) nadal mają osobną, wcześniejszą odmowę; nie liczą się do głębokości.
