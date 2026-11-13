# R8 — Cloud races: Share (select-then-insert) + Settings (optimistic version check w Pythonie)

**Roadmap:** pozycja R8 z [ai_plans/2026-09-27_simplification-roadmap.md](2026-09-27_simplification-roadmap.md)
**Branch:** `fix/r8-cloud-share-settings-races` (z main)
**Data:** 2026-09-27
**Zakres:** tylko R8 — dwa wyścigi zapisu w self-hosted-cloudapi. Kontrakty HTTP bez zmian łamiących; zmiany są wewnętrzne (indeks + semantyka zapisu).

---

## 1. Root cause

### 1.1 Share: select-then-insert na `TaskShare.task_id` bez unique index

Kod przed fixem — `src/services/share_service.py`, `share_task()`:

```python
    # Check for existing share
    result = await db.execute(
        select(TaskShare).where(TaskShare.task_id == task_id)
    )
    existing_share = result.scalar_one_or_none()
    ...
    if existing_share:
        existing_share.visibility = visibility      # gałąź "istnieje"
        ...
        return ShareResponse(..., is_new_share=False, ...)

    # Create new share
    share = TaskShare(
        task_id=task_id,
        visibility=visibility,
        share_url=share_url,
        manage_url=manage_url,
    )
    db.add(share)                                   # gałąź "nie istnieje"
    await db.flush()
```

Model `TaskShare` (`src/models/task.py`) miał tylko zwykły indeks:

```python
    task_id = Column(String, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True)
```

**Wyścig:** dwa równoległe requesty POST /api/extension/share (dwuklik, dwie karty) oba wykonują SELECT → oba widzą "brak share" → oba robią INSERT → **dwa wiersze `task_shares` dla jednego taska**.

**Konsekwencja nie jest tylko kosmetyczna:** każdy czytelnik share taska używa `scalar_one_or_none()` — `src/services/task_access.py`:

```python
    result = await db.execute(select(TaskShare).where(TaskShare.task_id == task_id))
    share = result.scalar_one_or_none()
```

Przy duplikatach `scalar_one_or_none()` rzuca `MultipleResultsFound` — **strona /shared/{task_id} przestaje działać** do ręcznego czyszczenia wierszy.

### 1.2 Settings: optimistic version check wykonywany w Pythonie

Kod przed fixem — `src/services/settings_service.py`, `update_user_settings()`:

```python
    user_settings = await get_or_create_user_settings(db, user_id)

    # Optimistic locking check
    if version is not None and user_settings.version != version:   # read + compare w Pythonie
        from fastapi import HTTPException
        raise HTTPException(status_code=409, detail="Version conflict")

    user_settings.settings = json.dumps(settings.model_dump(by_alias=False))
    user_settings.version += 1                                     # write
    await db.flush()
```

**Wyścig:** dwa równoległe PATCH /api/user-settings z tym samym `version` oba czytają ten sam numer, oba przechodzą porównanie w Pythonie, oba piszą `version + 1` → **update jednego z nich ginie bez śladu** (obaj dostają 200, obaj wierzą, że wygrali). To łamie sam cel optimistic lockingu: klient, który dostał 409-less success, nigdy nie re-fetchnie.

---

## 2. Fix

### 2.1 Share — unique index + ON CONFLICT (DO NOTHING + UPDATE)

**Model** (`src/models/task.py`, `TaskShare.__table_args__`) — deklaracja jako unikalny INDEX (nie UniqueConstraint), dokładnie według konwencji `uq_task_messages_task_ts` z d4e5f6a7b8c9, żeby fresh `create_all` i baza zmigrowana trzymały ten sam obiekt, a ON CONFLICT mógł nazywać `index_elements`:

```python
    __table_args__ = (
        Index("uq_task_shares_task_id", "task_id", unique=True),
    )
```

**Service** (`share_task()`) — select-then-insert zastąpiony race-proof insertem + refreshem:

```python
    result = await db.execute(
        _insert(TaskShare)
        .values(task_id=task_id, visibility=visibility,
                share_url=share_url, manage_url=manage_url)
        .on_conflict_do_nothing(index_elements=["task_id"])
    )
    created = result.rowcount == 1

    if not created:
        await db.execute(
            update(TaskShare).where(TaskShare.task_id == task_id)
            .values(visibility=visibility, share_url=share_url, manage_url=manage_url)
        )
    await db.flush()
```

Dlaczego DO NOTHING + UPDATE, a nie DO UPDATE w jednym: `rowcount` od `ON CONFLICT DO UPDATE` to 1 także dla gałęzi update, więc nie rozstrzygnie `is_new_share` (kontrakt odpowiedzi). Przy DO NOTHING rowcount=1 oznacza jednoznacznie INSERT. Refresh istniejącego wiersza zwykłym UPDATE po `task_id` — żadnej decyzji unikalnościowej nie zostawiono do wyścigu. Wzorzec z `telemetry_service.py` (`_ensure_task`).

**Migracja** `alembic/versions/b4c5d6e7f8a9_task_share_unique.py` (rewizja `b4c5d6e7f8a9`, po `a3b4c5d6e7f8`):

1. dedup istniejących wierszy — `DELETE ... WHERE id NOT IN (SELECT MIN(id) ... GROUP BY task_id)`; subquery (nie `DELETE...USING`), bo musi działać i na SQLite; zachowujemy wiersz o najniższym id = pierwszy share, którego URL mógł już ktoś dostać,
2. `CREATE UNIQUE INDEX uq_task_shares_task_id ON task_shares (task_id)`.

**Baseline fixture NIE wymagała zmiany** — `tests/fixtures/baseline_schema_sqlite.sql` to pre-alembic snapshot; nowy indeks wprowadza migracja, a drift test (baseline → upgrade head → compare_metadata) potwierdza zgodność z modelem. Zgodność potwierdzona zielonym `test_migration_drift.py` (KNOWN_DRIFT pozostał pusty).

### 2.2 Settings — atomiczny CAS w SQL

`update_user_settings()` — read-compare-write zastąpione jednym `UPDATE ... WHERE version = :expected RETURNING`:

```python
    new_version = user_settings.version + 1
    stmt = (
        update(UserSettings)
        .where(UserSettings.user_id == user_id)
        .values(settings=json.dumps(settings.model_dump(by_alias=False)))
        .values(version=new_version)
    )
    if version is not None:
        stmt = stmt.where(UserSettings.version == version)   # CAS w jednym stmt

    result = await db.execute(stmt.returning(UserSettings.version))
    row = result.scalar_one_or_none()
    if row is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=409, detail="Version conflict")
```

- `RETURNING` wspierane przez SQLite ≥3.35 (suite) i Postgres (produkcja) — SQLAlchemy emituje odpowiedni dialekt.
- 0 wierszy → 409 `"Version conflict"` — identyczny kształt odpowiedzi/status co dotychczas.
- PATCH bez `version` (opt-out z optimistic lockingu) — bez guardu WHERE, zawsze wygrywa, bump +1: bez zmian behawioralnych.
- `db.expire(user_settings)` po udanym UPDATE, żeby sesja nie trzymała nieaktualnego snapshotu.
- `new_version = read + 1` liczony jest tylko po to, by wpisać nową wartość — nie służy jako check (check jest w WHERE).

---

## 3. Testy (test_cloud_races.py — nowe)

Reprodukcja **deterministyczna**: silnik SQLite **plikowy** (in-memory StaticPool serializowałby callerów jednym połączeniem), każdy caller = własna sesja = własne połączenie; wrapper na `session.execute` pętla każdy caller w `asyncio.Barrier` **zaraz po odczycie**, za którym stoi wyścig. Zero sleepów.

| Test                                                               | before (main)                                | after (fix)                                           |
| ------------------------------------------------------------------ | -------------------------------------------- | ----------------------------------------------------- |
| `test_concurrent_share_requests_create_exactly_one_share_row[2,3]` | RED — N wierszy share, N×`is_new_share=True` | GREEN — 1 wiersz, dokładnie jeden `is_new_share=True` |
| `test_concurrent_settings_patches_let_exactly_one_win[2,3]`        | RED — N×200, update przegranego ginie        | GREEN — 1×200 + (N−1)×409                             |
| `test_sharing_an_already_shared_task_returns_the_existing_share`   | GREEN (kontrakt re-share)                    | GREEN                                                 |
| `test_settings_version_conflict_response_is_unchanged`             | GREEN (sekwencyjny 409)                      | GREEN                                                 |
| `test_settings_update_without_version_always_succeeds`             | GREEN (opt-out)                              | GREEN                                                 |

Szczegół dowodowy: asercja `pause.paused in (0, parties)` — na main barrier odpala się dla wszystkich callerów (pełna reprodukcja wyścigu), po fixie raced read nie istnieje (`paused == 0`), a unikalny indeks i tak gwarantuje 1 wiersz przy dowolnym przeploteniu.

**Pełny suite:** 812 passed, 1 xfailed — w tym test izolacji R7 (retention savepoint) i cały `test_migration_drift.py` (migracje vs `Base.metadata`, db-migrate.sh end-to-end).

---

## 4. Zmienione pliki

| Plik                                                                      | Zmiana                                                              |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `self-hosted-cloudapi/src/models/task.py`                                 | `TaskShare.__table_args__`: unikalny Index `uq_task_shares_task_id` |
| `self-hosted-cloudapi/src/services/share_service.py`                      | select-then-insert → ON CONFLICT DO NOTHING + UPDATE refresh        |
| `self-hosted-cloudapi/src/services/settings_service.py`                   | Python check → atomiczny UPDATE...WHERE version...RETURNING         |
| `self-hosted-cloudapi/alembic/versions/b4c5d6e7f8a9_task_share_unique.py` | NOWA migracja: dedup + unique index (po a3b4c5d6e7f8)               |
| `self-hosted-cloudapi/tests/test_cloud_races.py`                          | NOWY plik: deterministyczne testy obu wyścigów + kontrakty          |

---

## 5. Residualsy / ryzyka

- **SQLite RETURNING**: wymaga SQLite ≥3.35 (Python ≥3.11 ma 3.35+). Produkcja (Postgres/asyncpg) wspiera RETURNING natywnie. Gdyby kiedyś dodać dialekt bez RETURNING, CAS trzeba by rozbić na UPDATE + osobny SELECT w tej samej transakcji (słabsze, ale wciąż atomowe na poziomie wiersza).
- **Wyścig w `get_or_create_user_settings`** (pierwszy PATCH nowego usera może tworzyć wiersz równolegle) istnieje dalej — ale `user_id` ma unique constraint w modelu, więc najwyżej jeden flush poleci z IntegrityError; poza zakresem R8 (roadmap nie wymienia; konsekwencja to 500, nie cicha utrata danych).
- **`ON CONFLICT`** jest dialektowe (postgresql/sqlite) — repo już tak robi (`telemetry_service.py`); na ewentualnym innym dialekcie share wróciłby do zwykłego insert (funkcja wybiera gałąź po `db.bind.dialect.name`).
- **Kolejność deploy**: migracja i kod muszą wylądować razem (kod wymaga indeksu, inaczej równoległe share nadal wygrałoby przez wyjątek... nie — bez indeksu DO NOTHING niczego nie konfliktuje i duplikaty wracają). W praktyce obraz Dockera buduje się z jednego commita; db_bootstrap FRESH robi create_all (indeks jest w modelu), MANAGED dostaje go migracją.
- **exclude_none**: bez zmian — endpointy share i user-settings mają już `response_model_exclude_none=True` i test `test_share_existing_task_response_has_no_null_fields` pozostaje zielony.
