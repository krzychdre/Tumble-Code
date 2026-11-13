# R3-9: podział diagnostics_service.py na pakiet services/problems/

**Data:** 2026-10-03 · **Branch:** `chore/r3-9-diagnostics-problems-split` · **Źródło zakresu:** ai_plans/simplification_round3_audit_2026-10-02.md, punkt 9

## Cel

`self-hosted-cloudapi/src/services/diagnostics_service.py` (1035 linii) trzymał cały potok raportu problemów w jednym płaskim module: dwa dataclassy (`Occurrence`, `ProblemFilter`) i 31 funkcji modułowych w czterech troskach. Szwy potoku (collect → filter → group → render) były numerami linii, nie importami — zmiana reguły grupowania wymagała przewijania 1000 linii. Audyt nakazał czysty podział, bez zmian sygnatur i bez zmian zachowania.

## Zmiana

### Nowy pakiet `self-hosted-cloudapi/src/services/problems/`

| Moduł          | Linie | Zawartość (czysty przenosiny z `diagnostics_service.py`)                                                                                                                                              |
| -------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `base.py`      | 118   | `Occurrence`, stałe źródeł (`SOURCE_*`, `SOURCE_LABELS`), `TELEMETRY_CATEGORIES`, `NOT_MODEL_CATEGORIES`, `CLASS_ORDER`, limity (`MAX_GROUPS` itd.), pomocnicze `utc`/`fmt_when`/`prop_text`/`chunks` |
| `collect.py`   | 365   | trzy źródła → `Occurrence`: `conversation_category`, `conversation_occurrences`, `telemetry_occurrence`, `collect_occurrences`, `first_report_at`, `_request_counts`, zapytania pomocnicze            |
| `filters.py`   | 129   | `ProblemFilter`, `FILTER_FIELDS`/`FILTER_LABELS`, `SORT_*`                                                                                                                                            |
| `aggregate.py` | 236   | `group_occurrences`, `aggregate_problems`, `model_fit`, `rules_by_signature`, `_options`                                                                                                              |
| `views.py`     | 241   | `_group_view`, `_sample_view`, `group_key`, `pick_samples`, `report_view`                                                                                                                             |
| `service.py`   | 58    | punkt wejścia okresu: `compute_user_problems`, `load_report`                                                                                                                                          |
| `__init__.py`  | 10    | docstring opisujący szwy potoku                                                                                                                                                                       |

Cztery moduły `collect/filters/aggregate/views` to dokładnie układ z audytu; `base` i `service` są dodane, bo (a) `Occurrence` i pomocnicze funkcje są współużytkowane przez cztery troski i potrzebują liścia bez cykli, (b) `compute_user_problems`/`load_report` wiążą collect+aggregate i nie należą do żadnej z czterech trosk. Sygnatury i treść przeniesionych funkcji bez zmian.

### `diagnostics_service.py` → jednoplikowy re-export (90 linii)

Pięć miejsc importujących `services.diagnostics_service` (router `web_diagnostics`, `problem_brief.py`, `web/presenters/problem_view.py`, `test_web_diagnostics.py`, `test_problem_filters_brief.py`) pozostało nietkniętych. Moduł re-eksportuje całą publiczną powierzchnię plus trzy prywatne nazwy, których używa `problem_brief.py` (`_chunks`, `_fmt_when`) i które wewnętrznie istnieją nadal jako `chunks`/`fmt_when`/`utc` w `base.py` (aliasy w re-eksportach pod starymi nazwami). Ruff F401 dla re-eksportów rozwiązano przez `__all__`.

### Drobne korekty spójności

- `docs/08-cloud.md`: wzmianka o implementacji wskazuje teraz na `services/problems/` (z adnotacją o re-eksporcie); akapit o trzech źródłach i składnia stron bez zmian.
- Docstringi przeniesionych funkcji/klas przeniesione razem z nimi; docstring modułu `diagnostics_service.py` został rozdzielony między `problems/__init__.py` i moduły pakietu według troski.

## Czego NIE zmieniono

- Routing, odpowiedzi HTTP, szablony, zapytania SQL, reguły klasyfikacji (`problem_catalogue.py`, `problem_brief.py` — nietknięte).
- Testy: zero edycji w `test_web_diagnostics.py`, `test_problem_catalogue.py`, `test_problem_filters_brief.py` i pozostałych.

## Weryfikacja

- `cd self-hosted-cloudapi && uv run pytest` — **1173 passed, 1 xfailed** (tyle samo co na main przed zmianą), w tym 117 testów problemowych bez ani jednej edycji testu.
- `uv run ruff check .` — All checks passed.
- `git diff` potwierdza: jedyny zmodyfikowany plik źródłowy to `diagnostics_service.py` (zmiejszony z 1035 do 90 linii) plus nowy katalog `problems/`; pięć miejsc importu bez zmian.

## Odchylenia od audytu

- Dodane moduły `base.py` i `service.py` ponad wskazane cztery — uzasadnione wyżej; audyt mówił „pure moves, no signature changes", nie zakazywał liścia współdzielonego.
- Prywatne stałe `_WHERE_KEYS`/`_MESSAGE_KEYS`/`_IN_CHUNK` straciły podkreślnik w `base.py` (`WHERE_KEYS`/`MESSAGE_KEYS`/`IN_CHUNK`), bo w nowym układzie są między modułowe, nie module-private; stara nazwa `diagnostics_service` nie eksportowała ich publicznie, więc powierzchnia importów pięciu stron jest w pełni zachowana.

## Wdrożenie

Zmiana jest w obrazie api dopiero po przebudowie obrazu docker (nie uruchamiać docker z agenta). Zachowanie publiczne identyczne, więc rebuild api obrazu wystarcza — VSIX i CLI nie są dotknięte.
