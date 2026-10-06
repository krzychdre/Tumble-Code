# CLI: zmiana modelu w locie (`/model`)

**Status:** gotowe na gałęzi `feat/cli-model-switch` (druga w stosie, na `feat/cli-reasoning-effort-per-model`).
**Powiązane plany:** `2026-10-06_11-42_cli-reasoning-effort-per-model.md`, `2026-09-23_cli-per-mode-provider-settings` (mechanizm `cliModeProviderSettings`).
**Dotknięte pliki:** `apps/cli/src/agent/extension-host.ts`, `apps/cli/src/lib/utils/provider-config.ts`,
`apps/cli/src/lib/utils/model-command.ts` (nowy), `apps/cli/src/lib/utils/commands.ts`, `apps/cli/src/ui/hooks/useTaskSubmit.ts`,
`apps/cli/src/ui/hooks/useExtensionHost.ts`, `apps/cli/src/ui/App.tsx`, `apps/cli/src/commands/cli/run.ts`,
`src/core/webview/ModeProfileBinding.ts`, `src/core/webview/ClineProvider.ts`, `src/core/webview/messageHandlers/providerProfiles.ts`,
`packages/types/src/vscode-extension-host.ts`, `apps/cli/README.md`, testy.

## Potrzeba

Model sesji CLI był ustalany tylko przy starcie (plik, `modes`, `--model`). Zmiana wymagała restartu.

## Jak to działało

CLI wysyła przy starcie wiadomość `cliModeProviderSettings` (`base` + `modes`). Rozszerzenie trzyma ją w pamięci
(`ModeProfileBinding`) i stosuje dopiero w `handleModeSwitch`, czyli przy przełączeniu trybu. Nie było drogi
"zastosuj teraz dla bieżącego trybu".

## Zmiana

- Rdzeń: `ModeProfileBinding.applyCliProviderSettingsToCurrentMode()` rozwiązuje ustawienia bieżącego trybu
  (`modes[mode] ?? base`), zapisuje je przez `contextProxy.setProviderSettings` (czyści klucze, których nowe
  ustawienia nie mają, więc poziom rozumowania poprzedniego modelu nie zostaje) i przebudowuje handler zadania
  (`updateTaskApiHandlerIfNeeded`, `forceRebuild`). Strumień w toku kończy się na starym handlerze.
  Handler wiadomości wywołuje to, gdy `cliModeProviderSettings` ma `bool: true`.
- CLI: `withModel(settings, model, ...)` w `provider-config.ts` podmienia pole modelu dostawcy i wszystko, co
  przychodzi z modelem (poziom rozumowania, rozmiar, ceny, `preserveReasoning`), przez tę samą funkcję co
  `toProviderSettings` (wydzielone `applyModelSettings`).
- `ExtensionHost.switchModel(mode, model)`: nowy wpis trybu w `modeProviderSettings`, poziom z
  `resolveReasoningEffort` (flaga `-r`, potem wpis modelu), wysyłka z `bool: true`. Nowe opcje hosta:
  `models` (blok z pliku) i `forcedReasoningEffort` (flaga `-r`).
- TUI: komenda `/model` (bez argumentu: lista modeli z `models`, bieżący oznaczony; z argumentem: przełączenie).
  Teksty w `model-command.ts`. Zmiana dotyczy bieżącego trybu do końca sesji; powrót do tego trybu przywraca
  wybrany model; plik ustawień nie jest zapisywany. Stopka i okno kontekstu biorą się z `apiConfiguration`
  w stanie rozszerzenia, więc aktualizują się same.

## Przed / po

| Sytuacja | Przed | Po |
| --- | --- | --- |
| Zmiana modelu w trakcie sesji | tylko restart | `/model <id>`, następne zapytanie idzie do nowego modelu |
| Przejście GLM (`max`) na Qwen bez wpisu | nie dotyczy | Qwen bez poziomu, okno 128k, komunikat o braku wpisu |
| Zmiana modelu w `code`, potem przejście do `architect` | nie dotyczy | `architect` ma swój model, powrót do `code` daje nowy |

## Testy

- Rdzeń `ClineProvider.cliModeProviderSettings.spec.ts`: natychmiastowe zastosowanie i przebudowa handlera,
  wyczyszczenie poziomu poprzedniego modelu, inne tryby nietknięte, brak ustawień CLI = nic.
- `provider-config.test.ts` (`withModel`): połączenie zostaje, rzeczy poprzedniego modelu znikają, nowy model
  przynosi swoje, pole modelu dostawcy (np. `apiModelId` dla `zai`).
- `extension-host.test.ts`: wysyłka z `bool: true` tylko dla danego trybu, `-r` obowiązuje też po `/model`,
  kolejne przełączenia startują z aktualnego wpisu.
- `useTaskSubmit.test.tsx`: lista, przełączenie bez wysyłki do modelu, ostrzeżenie o braku wpisu, ten sam model.

## Uwagi

- Zmiana dostawcy przez `/model` nie jest obsługiwana (tylko model tego samego dostawcy).
- Brak podpowiedzi (autocomplete) identyfikatorów modeli po `/model `; lista jest wypisywana przez samo `/model`.
- Incydent przy pracy: inny agent w tym samym drzewie zrobił `git checkout -b` i zacommitował te zmiany razem ze
  swoimi; pliki przeniesiono do worktree `/tmp/roo-wt-cli-model`, tamten agent przebudował swoją gałąź.
