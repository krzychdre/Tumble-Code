# CLI: poziom rozumowania przeniesiony do wpisu modelu (`models.<id>.reasoningEffort`)

**Status:** gotowe na gałęzi `feat/cli-reasoning-effort-per-model` (pierwsza z czterech gałęzi w stosie).
**Powiązane plany:** `2026-10-06_openai-compatible-return-reasoning.md` (poziom `max`),
`2026-09-23_19-45_cli-context-window-per-model.md` (blok `models`).
**Dotknięte pliki:** `apps/cli/src/lib/utils/provider-config.ts`, `apps/cli/src/lib/utils/model-settings.ts`,
`apps/cli/src/commands/cli/run.ts`, `apps/cli/src/types/types.ts`, `apps/cli/src/main.ts`, `apps/cli/README.md`, testy.

## Objaw

`~/.roo/cli-settings.json` użytkownika miał `"reasoningEffort": "max"` na najwyższym poziomie. Ta jedna
wartość szła do każdego modelu sesji, także do `Qwen3.8-27B` (np. przez wpis `modes` albo `--model`),
który poziomu `max` nie zna i ma własny zestaw poziomów.

## Co się działo

`resolveProviderConfig` traktował `reasoningEffort` jako wartość niezwiązaną z dostawcą ani modelem:
wygrywała najwyższa warstwa, która go ustawiła (plik, wpis trybu, flaga). Wpis trybu przełączający
się na innego dostawcę (np. `openai-codex`) też dziedziczył globalne `max` (test
"a mode entry naming another provider..." oczekiwał wcześniej `reasoningEffort: "max"`).

## Zmiana

- `CliModelSettings.reasoningEffort`: poziom należy do modelu, obok `contextWindow`, cen i
  `preserveReasoning`. Walidowany w `findModelSettingsProblems` (błąd przy starcie z nazwą modelu).
- `resolveReasoningEffort(provider, modelSettings, flag)` w `provider-config.ts`: flaga `-r`, potem
  wpis modelu, potem domyślne (`unspecified` dla `openai`, `medium` dla reszty). `run.ts` wylicza go
  osobno dla bazy, dla każdego trybu i dla konfiguracji startowej.
- `reasoningEffort` zniknął z `ProviderConfigLayer`/`ResolvedProviderConfig`/`pickProviderConfig`.
- Stary klucz na najwyższym poziomie i w `modes.<slug>` jest ignorowany z ostrzeżeniem, które podaje
  gotowy wpis do przeniesienia (z nazwą modelu, który tam działa).
- `-r` sam w sobie nie wyłącza już wpisów `modes` (wcześniej każda flaga dostawcy, łącznie z `-r`,
  dawała jedną konfigurację na wszystkie tryby). Teraz ustawia poziom dla każdego modelu tego
  uruchomienia; nieprawidłowy poziom flagi nadal kończy start błędem.
- `listSetModelSettings` pomija `reasoningEffort`: w przeciwieństwie do rozmiaru i cen działa u
  każdego dostawcy, więc nie trafia do ostrzeżenia "ignored with the X provider".

## Przed / po

| Sytuacja                          | Przed                     | Po                                                    |
| --------------------------------- | ------------------------- | ----------------------------------------------------- |
| Globalne `max`, tryb na Qwen      | Qwen dostaje `max`        | ostrzeżenie, Qwen bez poziomu (albo z własnym wpisem) |
| Tryb `ask` na `openai-codex`      | dziedziczy globalne `max` | `medium` (domyślne dostawcy)                          |
| `-r low` z wpisami `modes`        | `modes` ignorowane        | `modes` działają, każdy model dostaje `low`           |
| `models.X.reasoningEffort: "maz"` | (klucz nieznany)          | błąd przy starcie z nazwą modelu                      |

## Testy

- `provider-config.test.ts`: nowy blok `resolveReasoningEffort` (wpis modelu, flaga, domyślne).
- `run.test.ts`: każdy model sesji dostaje swój poziom; tryb na innym dostawcy nie dziedziczy
  poziomu; `-r` zachowuje `modes`; błędny poziom we wpisie modelu i we fladze; ostrzeżenie o
  starym kluczu (najwyższy poziom i `modes`); poziom nie trafia do ostrzeżenia o ignorowanych
  kluczach u `anthropic`.
- Snapshot `--help` zaktualizowany (nowy opis `-r`). Cały pakiet CLI: 1418 testów zielonych.

## Uwagi

- Plik użytkownika trzeba przenieść ręcznie: `"reasoningEffort": "max"` z najwyższego poziomu do
  `models["GLM-5.3-NVFP4"]` i `models["GLM-5.3-Flash-NVFP4"]`. Do tego czasu CLI ostrzega przy
  starcie, a GLM dostaje brak poziomu.
- Poziomy są nadal z listy `--reasoning-effort` (`reasoningEffortsExtended` + `unspecified`/`disabled`);
  dowolne nazwy poziomów wymagałyby zmiany typu w rdzeniu.
