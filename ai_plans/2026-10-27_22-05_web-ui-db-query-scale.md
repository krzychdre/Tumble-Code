# Web UI pod obciążeniem — analiza zapytań DB i plan skalowania

**Status:** plan (analiza, bez zmian w kodzie)
**Skala założona:** setki tysięcy tasków w okresie retencji, tysiące użytkowników na organizację, produkcyjny Postgres (SQLite tylko w testach).
**Docelowo:** /app/metrics, /app, /app/diagnostics i pozostałe listy mają stały czas odpowiedzi niezależnie od wielkości korpusu.

## Co już jest odporne na skalę (nie ruszać)

- Lista tasków czyta zdenormalizowane kolumny `tasks` (title, tokens, cost, `q_*`), utrzymywane przy zapisie przez `refresh_task_summary` — jeden zindeksowany query na stronę, `ix_tasks_user_updated` obsługuje domyślne sortowanie ([task_summary.py](../self-hosted-cloudapi/src/services/task_summary.py), [task.py:142](../self-hosted-cloudapi/src/models/task.py:142)).
- Drzewo subtasków: `subtrees`/`ancestors` to pojedyncze rekurencyjne CTE, nie query per poziom ([task_tree.py](../self-hosted-cloudapi/src/services/task_tree.py)).
- Wyszukiwarka recall: tsvector + `statement_timeout` + limit kandydatów — zaprojektowana pod dużą tabelę ([recall_search.py](../self-hosted-cloudapi/src/services/recall_search.py)).
- Dataset (`/app/dataset`): grupowanie w SQL po zindeksowanych kolumnach `llm_exchanges` ([dataset_overview.py](../self-hosted-cloudapi/src/services/dataset_overview.py)).
- Retencja: plan/apply w parach, savepoint per user ([retention_service.py](../self-hosted-cloudapi/src/services/retention_service.py)).
- `telemetry_events` ma composite index `(user_id, event_type, created_at)` i wyciągnięte `task_id`/`client_kind` ([event.py:19](../self-hosted-cloudapi/src/models/event.py:19)).

## Wąskie gardła (priorytet wg bólu przy skali)

### W1 — /app/metrics agreguje korpus w Pythonie (główny problem)

`compute_user_metrics` pobiera **wszystkie wiersze** `LLM Completion` z okresu — łącznie z `properties` (TEXT, pełny JSON) — i agreguje je w Pythonie ([metrics_service.py:236](../self-hosted-cloudapi/src/services/metrics_service.py:236), pętla w [aggregate_user_metrics](../self-hosted-cloudapi/src/services/metrics_service.py:309)). Wariant organizacyjny dodatkowo joinuje `Task` per event.

Retencja **nigdy nie wymiata** `LLM Completion` i `Embedding Usage` (`PROTECTED_EVENT_TYPES`, [retention_service.py:53](../self-hosted-cloudapi/src/services/retention_service.py:53)) — to z założenia nieograniczony, rosnący korpus. Przy 500k tasków × 50–300 completionów to 25–150M wierszy. Period "All time" = pełny skan i JSON-parse milionów payloadów **na każde otwarcie strony**; space organizacji mnoży to przez liczbę członków. Docstring sam przyznaje: *"The volume is modest (one self-hosted user)"* ([metrics_service.py:17](../self-hosted-cloudapi/src/services/metrics_service.py:17)) — założenie już nieaktuale.

To samo w `_embedding_payloads` ([metrics_service.py:89](../self-hosted-cloudapi/src/services/metrics_service.py:89)).

### W2 — `properties` jako TEXT JSON uniemożliwia agregację po stronie DB

Przyczyna źródłowa W1: pola liczbowe (inputTokens, outputTokens, cache*, cost, durationMs, modelId, apiProvider, mode) żyją tylko w JSON-ie. Tekstowa forma została wybrana, bo testy biegną na SQLite bez operatorów jsonb. Konsekwencje poza metrykami:

- `_request_counts` (diagnostics) pobiera **wszystkie** payloady completionów okresu, żeby policzyć `Counter((provider, model))` w Pythonie ([collect.py:402](../self-hosted-cloudapi/src/services/problems/collect.py:402)).
- `_completions_by_task` i `completions_for_task` dekodują payloady per wiersz ([collect.py:188](../self-hosted-cloudapi/src/services/problems/collect.py:188), [model_attribution.py:94](../self-hosted-cloudapi/src/services/model_attribution.py:94)).

### W3 — grupowany widok listy skanuje całość per żądanie

`_group_page` pobiera **każdy** task pasujący do filtrów użytkownika (plus rekurencyjne CTE `_run_totals` nad całym drzewem subtasków) i grupuje w Pythonie ([task_list.py:561](../self-hosted-cloudapi/src/web/presenters/task_list.py:561), CTE w [task_list.py:457](../self-hosted-cloudapi/src/web/presenters/task_list.py:457)). Grupa "model" wymaga splitowania labela w Pythonie. Użytkownik z 50k tasków = 50k wierszy + rekurencja na **każdej** stronie widoku grupowego (domyślnego!). Sortowanie po kosztie na płaskiej liście też buduje CTE per żądanie.

### W4 — per-render dodatkowe scany na /app

Każde otwarcie listy: `all_total` COUNT, `_reader_projects` (IN-subquery po taskach usera), `_filter_suggestions` = `SELECT DISTINCT models` po wszystkich taskach usera — `models` nie ma indeksu, DISTINCT czyta każdy wiersz usera ([task_list.py:522](../self-hosted-cloudapi/src/web/presenters/task_list.py:522), [task_list.py:712](../self-hosted-cloudapi/src/web/presenters/task_list.py:712)).

### W5 — wyszukiwanie ILIKE '%…%' bez trigramów

`icontains` na `tasks.title`, `tasks.workspace_path`, `projects.name` = seq-scan wierszy usera/orgu per wyszukiwanie (pg_trgm GIN nie istnieje). Choć filtr `user_id` ogranicza zakres, power-user z dziesiątkami tysięcy tasków odczuje to w interaktywnym filtrowaniu.

### W6 — strona taska ładuje całą konwersję

`_load_task_messages` + `conversation_json` wciągają pełne `message_data` wszystkich wiadomości do HTML-a. Długie CLI-owe runy (dziesiątki MB) = pojedyncze żądanie przenosi wszystko. To nie zepsuje list, ale strona taska przestanie być "równie szybka".

### W7 —srdfacja ścieżki zapisu (wpływ na przepustowość ogółem)

Przy każdej **finalnej** wiadomości live: `refresh_task_summary` robi pełny agregat `SUM`/`COUNT` po wszystkich wiadomościach taska + `refresh_task_models` czyta wszystkie eventy tasku ([telemetry_service.py:533](../self-hosted-cloudapi/src/services/telemetry_service.py:533), [task_summary.py:223](../self-hosted-cloudapi/src/services/task_summary.py:223)). O(n) na wiadomość → kwadratowo na konwersację. Idempotentność była świadomą decyzją (upserty partiali); przy tysiącach wiadomości w tasku i wielu równoległych taskach obciąża bazę nieproporcjonalnie do zapisywanej treści.

### Mniejsze

- OFFSET-pagination: głębokie strony skanują offset wierszy ([pagination.py](../self-hosted-cloudapi/src/utils/pagination.py)); PAGE_SIZE 25 czyni to akceptowalnym, dopóki ktoś nie wejdzie na stronę 400.
- `quality_overview` w space organizacji filtruje po `(organization_id, parent_task_id IS NULL, updated_at)` — jest tylko indeks jedno-kolumnowy `ix_tasks_organization_id`.
- Pula 20+10 połączeń ([database.py:23](../self-hosted-cloudapi/src/database.py:23)) — z długimi agregacjami W1 pula połączeń zamieni się w kolejkę; po opanowaniu W1 przestaje być paląca.

## Plan — fazy (branch per funkcjonalność, stackowane)

### Faza 1 — kolumny agregacyjne na `telemetry_events`

Branch: `feat/web-metrics-event-columns`.

Dokładnie ten sam zabieg, który `task_id`/`client_kind` przeszły kiedyś: przy ingescie (`record_event`, [telemetry_service.py:230](../self-hosted-cloudapi/src/services/telemetry_service.py:230)) wyciągnąć z payloadu `LLM Completion` do kolumn:

```
input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
cost, duration_ms, model_id, provider, mode, completion_kind, usage_reported
```

- Migracja z backfillem (dekodowanie JSON po stronie PG w SQL; fallback: jednorazowy skrypt w Pythonie — zwykła pętla).
- `compute_user_metrics` przestaje czytać `properties`: SELECT po wąskich kolumnach, pętla Pythonowa zostaje (już nie parsuje JSON, nie transferuje payloadów). Analogicznie `aggregate_user_metrics` bierze pola z kolumn.
- `_request_counts` → `SELECT provider, model_id, count(*) GROUP BY` — zero payloadów.
- `completions_for_task`/`_completions_by_task` czytają kolumny zamiast dekodować `properties`.
- Kolumny są zwykłymi integerami/tekstem — działają identycznie na SQLite, więc suity pytest nie wymagają dialektyki.

Efekt: koszt strony metryk przestaje zależeć od rozmiaru payloadu; zostaje liczba wierszy okresu.

### Faza 2 — SQL GROUP BY + dzienny rollup

Branch: `feat/web-metrics-sql-rollup` (na szczycie Fazy 1).

1. Wszystkie `by_model`/`by_mode`/`by_provider`/`by_kind`/`by_client`, totals, `task_count` (`count(distinct task_id)` — kolumna `task_id` już jest) i grupy project/user (join po `Task.project_id`/`owner`) liczone w SQL `GROUP BY`. Pętla Pythonowa znika.
2. `by_day` — bucket dnia czytelnika (strefa!) najprościej trzymać per-event: wąskie wiersze (bez payloadu) wystarczą, bo agregacja dni to czyste dodawanie intów. Ewentualny dalszy krok: kolumna `day_utc` liczona przy ingescie + korekta strefy na granicy dnia w Pythonie tylko dla wierszy z pogranicznych godzin.
3. Opcjonalnie docelowo: tabela `metrics_daily` upsertowana przy ingescie (`user_id, day, model_id, provider, mode, client_kind, completion_kind, input, output, cache_*, cost, duration_ms, completions`), gdy punkt 1–2 okażą się niewystarczające dla "All time" organizacji. Wprowadzać dopiero po pomiarze — nie zakładać na zapas.

### Faza 3 — lista: koniec `_run_totals` per żądanie

Branch: `feat/web-list-subtree-rollup`.

1. Kolumna `tasks.primary_model` (pierwszy z labela) utrzymywana w `refresh_task_models` — grupowanie po modelu robi się zwykłym `GROUP BY`; split labela zostaje tylko do wyświetlania badge'a.
2. Zdenormalizować sumy poddrzewa na wierszu runa: `run_cost`, `run_tokens`, `run_duration_ms`, przeliczane (a) w `refresh_task_summary` dla taska samego w sobie i (b) przy każdej zmianie `parent_task_id` (`record_relation`, `adopt_from_relations`, `link_pending_children`) — propagacja w górę po łańcuchu przodków. Sortowanie po cost/tokens i grupy czytają kolumny, rekurencyjne CTE znika z żądań.
3. `_group_page`: sumy grup w SQL (`GROUP BY project_id/primary_model/user_id` + `ORDER BY` sumy) + `LIMIT/OFFSET` na grupach; tylko `GROUP_ROWS` pierwszych tasków grupy dociągane jak dotychczas.
4. `_filter_suggestions`: `DISTINCT primary_model` (zwykły DISTINCT po jednej kolumnie zamiast czytania i splitowania labela); przy dużym bólu — krótki cache per user z invalidacją po zapisie.

### Faza 4 — indeksy Postgres

Branch: `feat/web-pg-indexes` (samodzielny, można stackować równolegle do 1–3).

- `CREATE EXTENSION pg_trgm` + GIN na `tasks.title`, `tasks.workspace_path`, `projects.name` (dla `icontains`).
- Composite `(organization_id, parent_task_id, updated_at)` na `tasks` — quality_overview w space organizacji.
- Przegląd `(user_id, parent_task_id)` dla dominującego `scope=roots`.
- Warunek: testy na SQLite nie dotknięte (indeksy w migracji jako `dialect_kwargs` lub warunek dialektu).

### Faza 5 — opcje po pomiarach (nie wchodzić bez potrzeby)

- Strona taska: paginacja konwersacji (endpoint JSON + lazy loading w render.js zamiast całego `messages_json` w HTML).
- Keyset pagination listy (`updated_at, id`) zamiast OFFSET przy głębokich stronach.
- Ścieżka zapisu W7: inkrementalne `SUM`y zamiast pełnego re-agregatu — wymaga rozwiązania problemu double-count przy upsertach partiali (deltas nie działałyby); bezpieczniejszy wariant: agregat tylko przy `api_req_started` finałach i completion eventach, nie przy każdej finalnej wiadomości. Osobna decyzja, bo rusza idempotentność, która była przemyślana.

## Weryfikacja

1. **Pomiar przed/po — obowiązkowy** (właściciel odrzuca fixy bez dowodu): migawka produkcyjnej bazy PG do środowiska testowego (albo syntetyczny seed: 500k tasków, 2k użytkowników, 50M eventów), potem:
   - `EXPLAIN ANALYZE` głównych query metryk/listy przed i po każdej fazie;
   - rozszerzenie [test_cloud_web_perf.py](../self-hosted-cloudapi/tests/test_cloud_web_perf.py) o żądania na dużym seedzie (asercje czasowe luźne — smoke, nie benchmark);
   - skrypt jednorazowy w `scripts/` (zwykła pętla z printami, bez argparse) do porównania czasów `/app/metrics?period=all`, `/app`, `/app?sort=cost` przed/po — usunięty po zakończeniu pomiarów.
2. Każda faza: changeset `"tumble-code"` z `Improved:` (user-facing: szybsze strony).
3. Testy jednostkowe pytest: istniejące `test_web_metrics.py` muszą przejść bez zmian semantyki (agregacje te same liczby) — kolumny nie zmieniają wyników, tylko drogę.

## Czego świadomie nie ruszamy

- Pętli Pythonowej w `aggregate_user_metrics` jako kształtu — Faza 2 ją usuwa, ale Faza 1 już zdjęcie JSON-parse wystarczy, by odzyskać interaktywność; odrywanie wszystkiego naraz powiększa ryzyko regresji liczbowej.
- Ochrony `PROTECTED_EVENT_TYPES` w retencji — koszt/ historia ma żyć wiecznie; dlatego dane muszą być agregowalne, a nie wymiatane.
- Recall search, dataset, retencja — zaprojektowane pod skalę już dziś.
