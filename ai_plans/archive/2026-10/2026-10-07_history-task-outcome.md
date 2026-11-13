# Wynik zadania w historii: "Done" zamiast fałszywego "Unfinished"

**Status:** zrealizowane na gałęzi `feat/history-subtask-bullets`.

## Problem

Wiersz zadania nadrzędnego (Orchestrator) pokazywał "Unfinished", choć zadanie skończyło się wynikiem
(`completion_result`). Dowód z zadania `01a1178e-aa01`: ostatnie wiadomości to `say completion_result`,
`ask completion_result`, `ask resume_completed_task`, a `history_item.json` ma `"status": "active"`.

## Przyczyna

`HistoryItem.status` należy do mechanizmu delegacji, nie opisuje wyniku zadania. Wartość "completed"
ustawia tylko `DelegationService.reopenParentFromDelegation` podzadaniu, które oddało wynik rodzicowi.
Rodzic dostaje tam "active" i nic go potem nie zmienia; zadanie główne bez delegacji nie ma statusu
wcale. Webview wyprowadzał wynik ze statusu, więc każdy rodzic wyglądał na niedokończonego.

## Rozwiązanie

- Nowe pole `HistoryItem.outcome: "completed" | "unfinished"` liczone w `taskMetadata` przy każdym
  zapisie: ostatni krok (z pominięciem `resume_task`, `resume_completed_task` i prośby podzadania
  `finishTask`) to `completion_result` oznacza "completed".
- `status` zostaje nietknięty, bo `AttemptCompletionTool` używa "completed" jako blokady przed
  podwójnym zwrotem wyniku do rodzica.
- `TaskDetails` bierze `outcome`, a dla wpisów zapisanych wcześniej wraca do starego wywodu ze statusu.
  Stary wpis poprawia się sam przy następnym zapisie zadania (np. po otwarciu go).
