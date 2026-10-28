# Web UI pod obciążeniem: zapytania DB i plan skalowania

**Status:** fazy 1-4 i 6 wdrożone na stosie lokalnych gałęzi (niezmergowane, niewypchnięte):
`perf/web-scale-bench` → `feat/web-metrics-event-columns` (F1) → `feat/web-metrics-sql-rollup` (F2) →
`feat/web-list-subtree-rollup` (F3) → `feat/web-pg-indexes` (F4) → `fix/cloud-hostile-client-bounds` (H) →
`perf/cloud-db-session-settings` (S) → `feat/web-metrics-rollup` (F6). Faza 5 nieruszona (tylko po pomiarach).
**Skala założona:** setki tysięcy tasków w okresie retencji, tysiące użytkowników na organizację, produkcyjny Postgres (SQLite tylko w testach).
**Docelowo:** /app/metrics, /app, /app/diagnostics i pozostałe listy mają stały czas odpowiedzi niezależnie od wielkości korpusu.
**Plany faz:** `2026-10-28_01-50_web-metrics-event-columns.md` (F1), `2026-10-28_03-35_web-metrics-sql-rollup.md` (F2),
`2026-10-28_00-21_web-list-run-totals.md` (F3), `2026-10-28_00-06_cloud-web-list-indexes.md` (F4),
`2026-10-28_12-00_cloud-hostile-client-bounds.md` (H), `2026-10-28_09-02_cloud-db-session-settings.md` (S),
`2026-10-28_10-16_web-metrics-rollup.md` (F6).

## Co już jest odporne na skalę (nie ruszać)

- Lista tasków czyta zdenormalizowane kolumny `tasks` (title, tokens, cost, `q_*`), utrzymywane przy zapisie przez `refresh_task_summary`: jeden zindeksowany query na stronę, `ix_tasks_user_updated` obsługuje domyślne sortowanie ([task_summary.py](../self-hosted-cloudapi/src/services/task_summary.py), [task.py](../self-hosted-cloudapi/src/models/task.py)).
- Drzewo subtasków: `subtrees`/`ancestors` to pojedyncze rekurencyjne CTE, nie query per poziom ([task_tree.py](../self-hosted-cloudapi/src/services/task_tree.py)).
- Wyszukiwarka recall: tsvector + `statement_timeout` + limit kandydatów, zaprojektowana pod dużą tabelę ([recall_search.py](../self-hosted-cloudapi/src/services/recall_search.py)).
- Dataset (`/app/dataset`): grupowanie w SQL po zindeksowanych kolumnach `llm_exchanges` ([dataset_overview.py](../self-hosted-cloudapi/src/services/dataset_overview.py)).
- Retencja: plan/apply w parach, savepoint per user ([retention_service.py](../self-hosted-cloudapi/src/services/retention_service.py)).
- `telemetry_events` ma composite index `(user_id, event_type, created_at)` i wyciągnięte `task_id`/`client_kind` ([event.py](../self-hosted-cloudapi/src/models/event.py)).

## Wąskie gardła (priorytet wg bólu przy skali)

Proporcje korpusu z żywej instancji (2026-10-27): 34 014 zdarzeń `LLM Completion` na 1 517 tasków (około 22 na task, średnio 707 B payloadu), 19 270 `Embedding Usage`, 156 619 `Task Message` (średnio 3,2 KB), 915 z 1 517 tasków to subtaski. Przy 500 tys. tasków daje to około 11 mln zdarzeń `LLM Completion`.

### W1: /app/metrics agreguje korpus w Pythonie (główny problem)

`compute_user_metrics` pobierał **wszystkie wiersze** `LLM Completion` z okresu, łącznie z `properties` (TEXT, pełny JSON), i agregował je w Pythonie. Wariant organizacyjny dodatkowo joinował `Task` per event.

Retencja **nigdy nie wymiata** `LLM Completion` i `Embedding Usage` (`PROTECTED_EVENT_TYPES`, [retention_service.py](../self-hosted-cloudapi/src/services/retention_service.py)): to z założenia nieograniczony, rosnący korpus. Period "All time" oznaczał pełny skan i JSON-parse setek tysięcy payloadów **na każde otwarcie strony**, a space organizacji mnożył to przez liczbę członków. Zmierzone na korpusie testowym: 10,8 s dla użytkownika z 20 tys. tasków (8,2 s poza SQL), 82 s dla organizacji (64 s poza SQL).

To samo w odczycie zdarzeń embeddingów.

### W2: `properties` jako TEXT JSON uniemożliwia agregację po stronie DB

Przyczyna źródłowa W1: pola liczbowe (inputTokens, outputTokens, cache*, cost, durationMs, modelId, apiProvider, mode) żyły tylko w JSON-ie. Tekstowa forma została wybrana, bo testy biegną na SQLite bez operatorów jsonb. Konsekwencje poza metrykami:

- `_request_counts` (diagnostics) pobierał **wszystkie** payloady completionów okresu, żeby policzyć `Counter((provider, model))` w Pythonie ([collect.py](../self-hosted-cloudapi/src/services/problems/collect.py)).
- `_completions_by_task` i `completions_for_task` dekodowały payloady per wiersz ([model_attribution.py](../self-hosted-cloudapi/src/services/model_attribution.py)).

### W3: grupowany widok listy skanuje całość per żądanie

`_group_page` pobierał **każdy** task pasujący do filtrów użytkownika (plus rekurencyjne CTE `_run_totals` nad całym drzewem subtasków) i grupował w Pythonie ([task_list.py](../self-hosted-cloudapi/src/web/presenters/task_list.py)). Grupa "model" wymagała splitowania labela w Pythonie. CTE zajmowało 825 ms z 1 112 ms domyślnego widoku (estymata 1,09 mln wierszy wobec 37 tys. rzeczywistych uruchamiała JIT). Sortowanie po koszcie na płaskiej liście też budowało CTE per żądanie.

### W4: per-render dodatkowe zapytania na /app

Każde otwarcie listy: `all_total` COUNT, `_reader_projects` (IN-subquery po taskach usera), `_filter_suggestions` = `SELECT DISTINCT models` po wszystkich taskach usera. Filtr modelu dopasowuje dowolny model z labela (`Task.models.icontains`), więc podpowiedzi muszą zawierać wszystkie modele wszystkich labeli, nie tylko pierwszy. Zmierzone koszty: DISTINCT 15 ms, `_reader_projects` 92 ms (stary indeks `project_id` czytał taski innych użytkowników), COUNT runów 63 ms.

### W5: wyszukiwanie ILIKE '%…%'

`icontains` na `tasks.title`, `tasks.workspace_path`, `projects.name` kompiluje się na Postgresie do `ILIKE`. Warunek wyszukiwania to `title ILIKE OR workspace_path ILIKE OR project_id IN (subquery)`; ramię z podzapytaniem nie wchodzi do BitmapOr, więc planista nie użyje indeksów pg_trgm i cały OR zostaje filtrem na wierszach usera. Koszt wyszukiwania siedzi w liczeniu runów (COUNT), nie w samym ILIKE.

### W6: strona taska ładuje całą konwersację

`_load_task_messages` + `conversation_json` wciągają pełne `message_data` wszystkich wiadomości do HTML-a. Długie CLI-owe runy (dziesiątki MB) = pojedyncze żądanie przenosi wszystko. To nie psuje list, ale strona taska przestanie być "równie szybka".

### W7: degradacja ścieżki zapisu (wpływ na przepustowość ogółem)

Przy każdej **finalnej** wiadomości live: `refresh_task_summary` robi pełny agregat `SUM`/`COUNT` po wszystkich wiadomościach taska, a `refresh_task_models` czyta wszystkie eventy taska ([telemetry_service.py](../self-hosted-cloudapi/src/services/telemetry_service.py), [task_summary.py](../self-hosted-cloudapi/src/services/task_summary.py)). O(n) na wiadomość, czyli kwadratowo na konwersację. Idempotentność była świadomą decyzją (upserty partiali); przy tysiącach wiadomości w tasku i wielu równoległych taskach obciąża bazę nieproporcjonalnie do zapisywanej treści.

### Mniejsze

- OFFSET-pagination: głębokie strony skanują offset wierszy ([pagination.py](../self-hosted-cloudapi/src/utils/pagination.py)); PAGE_SIZE 25 czyni to akceptowalnym (strona 300: 53 ms).
- `quality_overview` w space organizacji filtruje po `(organization_id, parent_task_id IS NULL, updated_at)`.
- Pula 20+10 połączeń ([database.py](../self-hosted-cloudapi/src/database.py)): z długimi agregacjami W1 pula zamienia się w kolejkę; po opanowaniu W1 przestaje być paląca.
- Prepared statements asyncpg: po 5 wykonaniach na jednym połączeniu Postgres może przejść na plan generyczny. Dla zawężonych stron metryk taki plan trwał minuty, dla zapytań listy kilka razy dłużej niż plan dla konkretnych wartości, a dla odczytu completionów taska przy każdej finalnej wiadomości 71 ms zamiast 13 ms (zob. "Ustawienia sesji Postgresa").

## Fazy (branch per funkcjonalność, stackowane)

### Faza 0: pomiar (`perf/web-scale-bench`)

Jednorazowe skrypty [web_scale_seed.py](../self-hosted-cloudapi/scripts/web_scale_seed.py) i [web_scale_measure.py](../self-hosted-cloudapi/scripts/web_scale_measure.py). Korpus skalibrowany na żywej bazie: 2 000 użytkowników, organizacja z 1 000 członków, power user z 20 tys. tasków, 200 tys. tasków (60% subtaski, drzewa do głębokości 4), 4,9 mln zdarzeń (4,4 mln `LLM Completion`), baza 5,4 GB. Pomiar: strony end to end przez aplikację ASGI, rozgrzewka + 5 przebiegów, mediana, EXPLAIN ANALYZE najwolniejszego zapytania każdej strony. Do usunięcia po zakończeniu pomiarów.

### Faza 1: kolumny liczbowe na `telemetry_events` (`feat/web-metrics-event-columns`)

- Przy ingeście (`event_row` w telemetry_service, reguła `event_columns` w telemetry_vocab) z payloadu `LLM Completion` trafiają do kolumn: `input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost, duration_ms, model_id, provider, mode, completion_kind, usage_reported`; z `Embedding Usage`: `input_tokens` i `embedding_source`.
- Liczby i nazwy są ograniczone tam, gdzie wchodzą (zob. "Wrogi klient"): liczba spoza granic jednego requestu (`utils/format.figure`: 10^9 tokenów, 10 000 $, 24 h) to 0, nazwa przechodzi przez `telemetry_vocab.clean_name` (tylko string, bez znaków sterujących, formatujących i surogatów, najwyżej 256 bajtów UTF-8).
- Migracja `e8f9a0b1c2d3` z backfillem w Pythonie (zamrożona kopia reguły z granicami, keyset po id, jak w `e7f8a9b0c1d2`): jsonb Postgresa odrzuca `NaN`, który Python zapisuje; payload dłuższy niż 16 384 znaki czyta jako pusty, więc partia ma ograniczoną pamięć.
- Metryki, `_request_counts` (SQL `GROUP BY provider, model_id`), `completions_for_task` i `_completions_by_task` czytają kolumny, nie `properties`.

### Faza 2: SQL GROUP BY (`feat/web-metrics-sql-rollup`)

- Totals, `by_model/mode/provider/kind/client`, `unreported`, czas, `task_count` i grupy (projekt z regułą `visible_to`, model, użytkownik w organizacji) liczone w SQL; pętla Pythonowa i jej wątek roboczy zniknęły.
- `by_day` w strefie czytelnika: `GROUP BY` kwadransa UTC, kwadranse składane w dni lokalne w Pythonie (każdy współczesny offset strefy jest wielokrotnością 15 minut, więc żaden kwadrans nie przecina lokalnej północy). Najwyżej 96 wierszy na dzień okresu, przenośne na SQLite.
- Plan generyczny zawężonej strony trwał minuty; od gałęzi S każde zapytanie planuje się dla swoich wartości (zob. "Ustawienia sesji Postgresa").
- Bez migracji. Tabela per użytkownik i dzień UTC nie da dni czytelnika spoza UTC, liczby tasków ani grupowania po projekcie; ziarno obsługujące wszystko to task × kwadrans, zbudowane w fazie 6.

### Faza 3: lista bez `_run_totals` per żądanie (`feat/web-list-subtree-rollup`)

- `tasks.primary_model` (pierwszy z labela), zapisywany razem z `models`; grupowanie i zawężanie po modelu używa kolumny, badge nadal splituje label. Podpowiedzi filtra modeli zostają `DISTINCT models` (wszystkie modele wszystkich labeli).
- `run_cost`, `run_tokens`, `run_duration_ms` na każdym tasku: on plus poddrzewo tego samego właściciela, najwyżej 128 poziomów w dół (`RUN_DEPTH_MAX`; najgłębszy prawdziwy łańcuch miał 90). `refresh_run_totals` liczy je od nowa (nigdy różnicą) dla taska i przodków tego samego właściciela przy zmianie własnych liczb (`refresh_task_summary`), linku (`record_relation`, `link_pending_children`) i usunięciu (`delete_tasks`: web, bulk, retencja). Gdy suma się zmieniła, blokuje wiersze od najgłębszego (`FOR NO KEY UPDATE`) i liczy jeszcze raz, więc dwa równoległe zapisy w jednym drzewie nie gubią się nawzajem. `delete_tasks` bierze swoje blokady w tej samej kolejności przed pierwszym zapisem (`FOR UPDATE` na usuwanych, `FOR NO KEY UPDATE` na odcinanych dzieciach i przodkach), więc usuwanie i streamujący subtask czekają na siebie zamiast się zakleszczać. Koszt na zapis: 1,3 ms bez zmiany, 5,4 ms ze zmianą (z planowaniem każdego zapytania przez gałąź S: 1,8 i 7,0 ms).
- Liczby wiadomości (`task_summary.message_metrics`) mają granice jednego requestu jak telemetria, a link nazywa tylko id taska do 256 znaków, więc suma runu nie przepełni BIGINT, a `ix_tasks_parent_user` przyjmie każdy link.
- `_group_page`: jeden `GROUP BY` (wiersz na grupę), kolejność i stronicowanie grup w Pythonie jak dotąd, pierwsze `GROUP_ROWS` tasków grupy przez `row_number()`.
- Migracja `f0a1b2c3d4e5`: najpierw zeruje liczby wiadomości spoza granic i przelicza ich taski oraz odcina linki do id rodzica dłuższych niż 256 znaków, potem kolumny + backfill jednym UPDATE z tą samą granicą głębokości, `ix_tasks_parent_user (parent_task_id, user_id)` zamiast `ix_tasks_parent_task_id`.

### Faza 4: indeksy Postgres (`feat/web-pg-indexes`)

Każdy indeks zostawiony tylko, gdy planista go używa i strona przyspiesza:

- częściowe `ix_tasks_user_roots (user_id, updated_at)` i `ix_tasks_org_roots (organization_id, updated_at)` `WHERE parent_task_id IS NULL`: strony runów, panel jakości (własny i organizacji); 4 razy mniejsze od złożonych z `parent_task_id` przy tych samych czasach;
- `ix_tasks_project_user (project_id, user_id)` zamiast `ix_tasks_project_id`: `_reader_projects` 92 ms → 1,1 ms;
- `ix_tasks_user_models (user_id, models)`: podpowiedzi modeli jako index-only scan, 15 ms → 2 ms. Wpis btree mieści najwyżej 2 704 B, więc label ma limit 2 000 B (`model_attribution.LABEL_MAX_BYTES`, najrzadsze modele odpadają, zostaje co najmniej 7), a migracja przebudowuje dłuższe labele zapisane wcześniej, zanim zbuduje indeks;
- `ix_tasks_user_id` usunięty: prefiks innych indeksów, zero użyć na całym pomiarze;
- liczniki listy jako `count(*)` (z `count(tasks.id)` planista zostawał przy złym indeksie);
- pg_trgm nie wchodzi (W5), częściowy indeks rodzica też nie (po fazie 3 nic nie zyskuje).
- Migracja `f1a2b3c4d5e6`.

### Ustawienia sesji Postgresa (`perf/cloud-db-session-settings`)

- `src/database.make_engine` przekazuje każdemu połączeniu puli `plan_cache_mode = force_custom_plan` i `jit = off` (asyncpg `server_settings`); SQLite bez zmian, alembic z ustawieniami serwera.
- Plan dla konkretnych wartości kosztuje 1-2 ms planowania na stronę, a usuwa plany generyczne list (`list_default` około 50 ms SQL zamiast około 280 ms od szóstego żądania na połączeniu) i ścieżki zapisu (finalna wiadomość power usera 12,8 ms zamiast 70,9 ms). JIT kosztował około 1 s na każde duże zapytanie metryk.

### Faza 6: rollup task × kwadrans (`feat/web-metrics-rollup`)

- Tabela `usage_rollup`: wiersz na użytkownika, typ zdarzenia, kwadrans UTC, task i kombinację nazw (klucz to sha256 taska, nazw i klienta), z sumami tokenów, kosztu i czasu, liczbą zdarzeń i `first_at`. Ingest dodaje każde zdarzenie jednym `INSERT ... ON CONFLICT DO UPDATE` w transakcji zdarzenia.
- Metryki (wszystkie przestrzenie, grupowania, zawężenia, okresy i dni lokalne), embeddingi i liczniki diagnostyki czytają rollup zamiast zdarzeń; reguły właściciela bez zmian.
- Migracja `f2b3c4d5e6a7`: jeden `GROUP BY` po kolumnach fazy 1, klucz liczony w Pythonie w partiach (57,7 s, 96 MB na korpusie testowym; 495 tys. wierszy).

### Faza 5: opcje po pomiarach (nie wchodzić bez potrzeby)

- Strona taska: paginacja konwersacji (endpoint JSON + lazy loading w render.js zamiast całego `messages_json` w HTML).
- Keyset pagination listy (`updated_at, id`) zamiast OFFSET przy głębokich stronach.
- Ścieżka zapisu W7: agregat tylko przy finałach `api_req_started` i completion eventach, nie przy każdej finalnej wiadomości. Osobna decyzja, bo rusza przemyślaną idempotentność.

## Wyniki (korpus testowy, mediana ms)

Przed: kod bazowy na świeżej kopii; po: cały stos (fazy 1-4, H, S, faza 6) na kopii zmigrowanej do jego głowy.

| Strona                                 | Przed  | Po    | Zysk  |
| -------------------------------------- | ------ | ----- | ----- |
| `/app/metrics?period=all` (power user) | 10 757 | 340   | 31,6x |
| `/app/metrics?period=30d`              | 412    | 28    | 14,7x |
| metryki organizacji, all, grupa user   | 82 270 | 1 997 | 41,2x |
| metryki organizacji, all, grupa model  | 80 192 | 2 441 | 32,9x |
| metryki organizacji, 30 dni            | 4 603  | 206   | 22,3x |
| `/app` (grupy po projekcie, runy)      | 1 112  | 130   | 8,6x  |
| `/app?group=model`                     | 493    | 94    | 5,2x  |
| `/app?sort=cost&dir=desc`              | 2 528  | 1 320 | 1,9x  |
| `/app?group=none`                      | 143    | 24    | 6,0x  |
| `/app?group=none&sort=cost&dir=desc`   | 1 371  | 549   | 2,5x  |
| `/app?group=none&page=300`             | 90     | 52    | 1,7x  |
| `/app?group=none&q=…`                  | 164    | 48    | 3,4x  |
| `/app?group=none&model=GLM`            | 197    | 39    | 5,1x  |
| `/app/diagnostics?period=all`          | 7 464  | 1 494 | 5,0x  |

Liczby stron metryk są identyczne jak przed zmianami (porównania na tych samych kopiach bazy: 0 różnic, sumy kosztów różnią się najwyżej ostatnimi bitami floatów). Lista ma stały czas. Strony "All time" metryk czytają rollup, który rośnie około dwunastu razy wolniej niż zdarzenia. `/app?sort=cost` to w ponad 85% renderowanie 12,9 MB HTML-a (najdroższe runy pokazują całe drzewa subtasków).

Migracje na korpusie testowym (4,9 mln zdarzeń, 200 tys. tasków): cały stos od kodu bazowego 850 s (maszyna częściowo zajęta testami), z czego backfill F1 to około 14 minut (szacunek dla żywej instancji: około 10 s), F3 kilkanaście sekund, F4 i H około sekundy, rollup około minuty; potem VACUUM ANALYZE 142 s.

## Wrogi klient

Każde konto, które może się zalogować, traktujemy jako potencjalnie wrogie: steruje konfiguracją swojego klienta (własny serwer zgodny z OpenAI raportuje dowolne zużycie, własne model info dowolną cenę, własny tryb dowolną nazwę, id tasków generuje klient) i może wysyłać ręcznie zrobione żądania HTTP i socket.io. Nie może popsuć ani spowolnić stron innych kont i admina organizacji, zepsuć ich zapisanych liczb, wyczerpać pamięci, CPU ani puli połączeń, ani zatrzymać migracji. Każda gałąź ogranicza to, co sama wprowadza:

- F1: granice liczb jednego requestu i reguła nazw przy ingeście i w zamrożonej kopii backfillu. Bez nich dwa zdarzenia jednego członka przepełniały sumy strony organizacji (500 na każdym grupowaniu), ujemny koszt kasował cudze zużycie, a jedna zapisana wartość ponad int64, NUL albo nazwa niebędąca stringiem przerywała całą migrację.
- F3: przodkowie tylko tego samego właściciela (zapis nie blokuje cudzych wierszy), granica głębokości 128 (łańcuch ani cykl nie robi z zapisu ani z migracji pracy kwadratowej), granice liczb wiadomości, id taska w linku do 256 znaków, label do 2 000 B, blokady `delete_tasks` od najgłębszego.
- F4: przebudowa za długich labeli przed `CREATE INDEX`.
- H (kod starszy niż stos): link tylko między taskami nadawcy, completion nie przepisuje cudzego wiersza taska, karta recall nie zatrzymuje kart innych kont (tekst bez NUL i surogatów, SAVEPOINT na kartę), czas wiadomości tylko do 2100 r., limit ciała `POST /api/events`, najwyżej 8 sesji bazy na konto w bridge'u, tabele breakdown do 50 wierszy, granice zużycia w nagraniach wymian; migracja `f1b2c3d4e5a6` czyści to, co zapisano wcześniej.
- `tests/test_hostile_clients.py` (SQLite i Postgres) wysyła to wszystko przez prawdziwe ścieżki ingestu jako członek organizacji i sprawdza strony admina, innego konta i samego napastnika. Wrogie dane zapisane kodem bazowym (01057282b) przechodzą migrację do głowy stosu na Postgresie 16.

Zostawione, z powodami w planie H: usunięty członek nadal dopisuje zużycie do organizacji (decyzja właściciela), panel jakości organizacji czyta wszystkie runy okresu, tekst z NUL w tytule albo ścieżce psuje zapis tylko samemu nadawcy.

## Decyzje właściciela

1. JIT wyłączony dla połączeń aplikacji (gałąź S): około 1 s mniej na każdym dużym zapytaniu metryk.
2. `plan_cache_mode = force_custom_plan` dla całego silnika (gałąź S): 1-2 ms planowania na stronę zamiast planów generycznych.
3. `ix_tasks_user_models` zostaje; label ma limit bajtów, a nazwy modeli są oczyszczane przy ingeście (F1, F3, F4).
4. `delete_tasks` blokuje wiersze od najgłębszego (F3): jedno zapytanie blokujące na wiersz każdego usuwania, także w retencji.
5. Strażnicy typów i zakresów w `event_columns` i w zamrożonej kopii migracji (F1).
6. Metryki organizacji z rollupu task × kwadrans (faza 6).

## Czego świadomie nie ruszamy

- Ochrony `PROTECTED_EVENT_TYPES` w retencji: koszt i historia mają żyć wiecznie, dlatego dane muszą być agregowalne, a nie wymiatane.
- Recall search, dataset, retencja: zaprojektowane pod skalę już dziś.
