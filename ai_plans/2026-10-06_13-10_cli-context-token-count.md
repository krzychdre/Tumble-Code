# CLI: liczba tokenów obok procentu kontekstu w stopce

**Status:** gotowe na gałęzi `feat/cli-context-token-count` (czwarta w stosie, na `feat/cli-live-token-counts`).
**Dotknięte pliki:** `apps/cli/src/ui/components/input/ContextGauge.tsx`, `InputFooter.tsx`, `InputArea.tsx`,
`apps/cli/src/ui/App.tsx`, testy wskaźnika i stopki.

## Potrzeba

Stopka pokazywała tylko pasek i procent zapełnienia okna kontekstu (`████░░░░░░ 38%`). Bez liczby tokenów nie
widać, ile to jest naprawdę ani na jaki rozmiar okna CLI liczy procent (np. czy wpis `contextWindow` zadziałał).

## Zmiana

- `ContextGauge` przyjmuje opcjonalne `tokens` i `window` i dopisuje po procencie `118K/262K`, w tym samym
  kolorze co procent (ostrzeżenie przy 80% i alarm przy 95% obejmują całość).
- `formatTokenCount`: `850`, `12.4K`, `118K` (od 100K bez części dziesiętnej), `1.0M`.
- Dane: `tokenUsage.contextTokens` (te same, z których liczony jest procent) i `contextWindow` z
  `getContextWindow`, przekazane z `App` przez `InputArea` i `InputFooter`.

## Testy

- `ContextGauge.test.tsx`: formatowanie liczb, wyświetlenie `45% 118K/262K`, sam procent bez liczb.
- `InputFooter.test.tsx`: `38% 99.6K/262K` w stopce.
- Cały pakiet CLI: 1446 testów zielonych.

## Uwagi

- Stopka staje się o około 10 znaków dłuższa; przy bardzo wąskim terminalu lewa podpowiedź skraca się jak dotąd.
