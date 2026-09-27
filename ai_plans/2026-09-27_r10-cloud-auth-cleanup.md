# R10 — Cloud auth cleanup (wygasłe tickety/state/tokeny, GET-logout, `expires_at`)

**Branch:** `fix/r10-cloud-auth-cleanup` (z `main`, 2026-09-27)
**Roadmap:** [ai_plans/2026-09-27_simplification-roadmap.md](2026-09-27_simplification-roadmap.md) pozycja R10 (Priority 1, effort S)
**Poprzednie powiązane:** R7 (#534, savepoint-per-user w retention loop), R8 (#536), R9 (#537) — zmergowane.

---

## 1. Audyt — co było nie tak

### Tabele i ścieżki

| Tabela                  | Model                                         | Gdzie powstaje                                                  | Gdzie jest walidowana                                             | Problem                                                                                                    |
| ----------------------- | --------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `authentik_state_store` | `AuthentikStateStore` (`src/models/oauth.py`) | `store_oauth_state()` — każde wejście w OAuth (extension + web) | `get_oauth_state()` w `/auth/clerk/callback`                      | wiersz czytany, **nigdy nie usuwany** — tabela rośnie po każdym logowaniu; state jest wielorazowy (replay) |
| `tickets`               | `Ticket` (`src/models/user.py`)               | `create_ticket()` (TTL 5 min)                                   | `validate_ticket()` (jednorazowy przez `used`)                    | `used=True` zostaje w DB na zawsze; wygasłe też                                                            |
| `client_tokens`         | `ClientToken` (`src/models/user.py`)          | `create_client_token()` (idle-expiry DEF-S11)                   | `validate_client_token()` (odmawia wygasłych)                     | wygasłe wiersze zostają na zawsze                                                                          |
| `sessions`              | `Session` (`src/models/user.py`)              | `create_session()` w callbacku                                  | `resolve_web_user()` (web), `validate_client_token()` (extension) | **`expires_at` nigdy nie sprawdzane** w walidacji; kolumna nullable i nigdy nie ustawiana                  |

### Logout

- `GET /app/logout` (`src/routers/browser.py`): czyścił tylko cookie; `Session.is_active` zostawało `True`, więc sesja dalej autoryzowała (web cookie był wprawdzie nieważny, ale tokeny extension na tej samej sesji działały dalej).
- GET do zmiany stanu = CSRF-by-`<img>` (logout CSRF) — `CsrfOriginMiddleware` (DEF-S9) chroni tylko metody niebezpieczne.

### Retention loop (powiązanie R7)

`sweep_all_enabled()` iteruje użytkowników **w savepointach per user** (`begin_nested`); test izolacji: `test_a_failing_user_does_not_poison_the_others` w `test_web_settings.py`. Nowe purgi nie mogą znaleźć się wewnątrz tej pętli (nie są per-user) ani wewnątrz savepointu pojedynczego usera.

### CSRF

`CsrfOriginMiddleware` (`src/middleware/csrf.py`): niebezpieczna metoda + cookie → wymaga zaufanego `Origin`/`Referer`. Nie ma tokenów CSRF w formularzach — konwencja to origin-check na middleware. Nowy POST-owy logout automatycznie pod niego wpada; formularz w template nie potrzebuje ukrytego tokena.

---

## 2. Decyzje

### D1: GET → POST na `/app/logout` — **usuwamy GET całkowicie**, bez deprecjonowanego redirectu

Uzasadnienie:

- **Jedyny caller jest w repo**: `src/web/templates/base.html` (link „Sign out"). Zmieniam razem z endpointem (link → formularz POST). Zewnętrzni klienci nie istnieją: web panel to jedyny konsument ścieżki `/app/*`, nie jest to kontrakt extension (extension używa `POST /v1/client/sessions/{id}/remove`), nie ma API-doców ani klientów poza repo.
- **Utrzymanie GET jako deprecjonowanego redirectu zachowałoby lukę**, którą domykamy: `<img src="/app/logout">` na dowolnej stronie same-site dalej by działało. Pożytek z GET-owego logoutu jest zerowy (nic go nie linkuje poza templatem, który zmieniamy).
- Ktoś z bookmarkiem do `/app/logout` dostanie 405 — akceptowalne dla niepublicznego panelu; test pinuje nowe zachowanie (`test_get_logout_is_gone`), więc decyzja jest udokumentowana kodem.

### D2: Purge wygasłych wierszy — **w retention loop, ale poza pętlą userów (global purge)**

Uzasadnienie:

- Wiersze auth nie mają właścicielskiej polityki retencji (nie są to taski/telemetria usera); expiry jest wewnętrzną cechą wiersza. Nie ma czego scope'ować per user.
- R7: `sweep_all_enabled()` działa w savepointach per user — wrzucenie globalnego DELETE do wnętrza któregokolwiek savepointu (a) wiązałoby porażkę purgu z porażką usera i odwrotnie, (b) mogło wywalić test izolacji. Dlatego `purge_expired_auth_rows()` wołam **w `run_retention_loop()` po `sweep_all_enabled()`**, w tej samej sesji/cyklu i w tym samym commicie (jedno fsync na cykl, zgodnie z uzasadnieniem R7), ale poza savepointami. Porażka purgu ląduje w istniejącym `except` → log + następny cykl, jak każda inna porażka cyklu.
- Osobny cykl maintenance (drugi task + własny interwał) to nowa machineria dla trzech DELETE-ów — dokładnie to, czego docstring retention_scheduler unika.

### D3: `Session.expires_at` — sprawdzane w `resolve_web_user()` (web), NULL = bezterminowa

- Wygasła sesja = brak autoryzacji (None → redirect do loginu), traktowana jak nieistniejąca — zgodnie z roadmapą.
- NULL pozostaje „nie wygasa" (to jest dziś stan każdej sesji na tej instalacji; nic nie ustawia `expires_at`), więc zmiana nie wylogowuje nikogo.
- W ścieżce extension (`validate_client_token`) expiry kontrolują same client tokeny (DEF-S11) — tam `Session.expires_at` pozostaje niesprawdzane, bo kolumna jest pusta i tamtejszy check nic by nie zrobił; nie duplikuję logiki. (Residual: jeśli kiedyś ustawimy `Session.expires_at`, trzeba go sprawdzić i tam.)

### D4: Consume state-row w `get_oauth_state()` — delete-on-read

- Wiersz jest jednostrzałowy z definicji (PKCE state); callback, który go przeczytał, kasuje go w tym samym flushu. Replay (przeciek state do logów, retry przeglądarki) dostaje 400 jak dziś nieznany state.
- Ścieżka not-found nie issuuje DELETE (warunek na `scalar_one_or_none()`), więc zapytania z losowym state nie ruszają cudzych wierszy.
- Porażka dalszej części callbacku (token exchange, userinfo) nie przywraca wiersza — poprawnie: state i tak został spendnięty u IdP, ponowne użycie byłoby błędne.

### D5: Purge ticketów — wygasłe, używane czy nie

`used=True` to martwy ciężar taki sam jak expiry; `validate_ticket()` i tak odmawia obu. Warunek purge: `expires_at < now` (jedno kryterium, bez rozdzielnia `used`). Client tokeny: purgowane tylko gdy `client_token_idle_days > 0` — konfiguracyjne „nigdy nie wygasają" musi być uszanowane (test `test_purge_never_touches_tokens_when_expiry_is_off`).

---

## 3. Zmiany — before / after

### 3.1 Consume state-row — `src/services/auth_service.py` `get_oauth_state()`

Before:

```python
async def get_oauth_state(db, state):
    """Retrieve and validate OAuth state."""
    result = await db.execute(
        select(AuthentikStateStore).where(
            AuthentikStateStore.state == state,
            AuthentikStateStore.expires_at > datetime.now(timezone.utc),
        )
    )
    return result.scalar_one_or_none()
```

After:

```python
async def get_oauth_state(db, state):
    """Retrieve, validate, and consume OAuth state. (…) the row is single-use (R10):
    it is deleted as soon as it is read (…)"""
    result = await db.execute(
        select(AuthentikStateStore).where(
            AuthentikStateStore.state == state,
            AuthentikStateStore.expires_at > datetime.now(timezone.utc),
        )
    )
    state_store = result.scalar_one_or_none()
    if state_store is not None:
        await db.execute(delete(AuthentikStateStore).where(AuthentikStateStore.state == state))
        await db.flush()
    return state_store
```

### 3.2 Global purge — nowa funkcja `purge_expired_auth_rows()` w `src/services/auth_service.py`

```python
async def purge_expired_auth_rows(db, now=None) -> int:
    """Delete expired single-use and idle-expired auth rows; return how many. (R10)"""
    ...
    states = await db.execute(delete(AuthentikStateStore).where(AuthentikStateStore.expires_at < expired))
    tickets = await db.execute(delete(Ticket).where(Ticket.expires_at < expired))
    if settings.client_token_idle_days > 0:
        tokens = await db.execute(delete(ClientToken).where(ClientToken.expires_at < expired))
```

### 3.3 Podpięcie w retention loop — `src/services/retention_scheduler.py`

Before:

```python
async with async_session_factory() as db:
    count = await sweep_all_enabled(db)
    await db.commit()
```

After:

```python
async with async_session_factory() as db:
    count = await sweep_all_enabled(db)
    # Global auth hygiene (R10): … outside the per-user savepoints …
    purged = await purge_expired_auth_rows(db)
    await db.commit()
```

### 3.4 `expires_at` w walidacji web-sesji — `src/auth/web_session.py` `resolve_web_user()`

Before: po `select(Session).where(Session.id == session_id, Session.is_active == True)` szło prosto do usera.

After:

```python
    if session.expires_at is not None:
        expires_at = session.expires_at
        # SQLite's aiosqlite driver returns naive datetimes …
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at <= datetime.now(timezone.utc):
            return None
```

### 3.5 POST logout — `src/routers/browser.py`

Before:

```python
@router.get("/app/logout")
async def web_logout(request: Request):
    """Clear the browser session cookie and return to the login page."""
    response = RedirectResponse(url="/app/login", status_code=303)
    clear_session_cookie(response, secure=cookie_should_be_secure(request))
    return response
```

After:

```python
@router.post("/app/logout")
async def web_logout(
    request: Request,
    user: Optional[WebUser] = Depends(get_web_user_optional),
    db: AsyncSession = Depends(get_db),
):
    """Deactivate the session, clear the cookie, and return to the login page. (…)"""
    if user is not None:
        await deactivate_session(db, user["session_id"])
    response = RedirectResponse(url="/app/login", status_code=303)
    clear_session_cookie(response, secure=cookie_should_be_secure(request))
    return response
```

### 3.6 Template + CSS — `src/web/templates/base.html`, `src/web/static/app.css`

Before: `<a class="btn ghost" href="/app/logout">Sign out</a>`
After:

```html
<form method="post" action="/app/logout" class="inline">
	<button type="submit" class="btn ghost">Sign out</button>
</form>
```

plus `form.inline { display: inline-flex; margin: 0; }` w CSS, żeby przycisk nie łamał rzędu w headerze.

### 3.7 Route-table test — `tests/test_route_table.py`

`("/app/logout", ("GET",), …)` → `("/app/logout", ("POST",), …)`; analogicznie w teście openapi.

---

## 4. Testy — `tests/test_auth_cleanup.py` (nowy plik, 15 testów)

Wymagania dowodowe z roadmapy:

- **(a) consume:** `test_get_oauth_state_consumes_the_row` (drugi odczyt = None), `test_get_oauth_state_with_an_unknown_state_deletes_nothing`, `test_get_oauth_state_still_refuses_an_expired_row`.
- **(b) purge tylko wygasłe:** `test_purge_removes_only_expired_rows` (3 usunięte, 4 aktywne zostają), `test_purge_takes_used_tickets_too`, `test_purge_never_touches_tokens_when_expiry_is_off`, `test_purge_counts_the_deleted_rows`.
- **(c) wygasła sesja nie autoryzuje:** `test_an_expired_session_does_not_resolve_a_web_user` (+ `…_live_…` i `…_without_expiry_…` jako kontratesty, żeby check nie zabrał dostępu nikomu żywemu).
- **(d) POST logout:** `test_post_logout_deactivates_the_session` (kolejne żądanie z tym samym cookie → 303 do `/app/login`), `test_post_logout_clears_the_cookie`, `test_post_logout_without_a_session_still_redirects`, `test_get_logout_is_gone` (405 — decyzja D1), `test_post_logout_from_an_untrusted_origin_is_refused` (CSRF: 403, sesja przeżywa).
- **(e) izolacja R7:** `test_a_failing_user_does_not_poison_the_others` z `tests/test_web_settings.py` — zielony w pełnym suite (purge jest poza pętlą userów, więc test nie mógł się zepsuć; uruchomiony razem z resztą).

**Wynik pełnego suite:** `uv run pytest` → **837 passed, 1 xfailed, 5 warnings** (warnings pre-existing: deprecacje httpx/starlette).

## 5. Knip

`pnpm knip` — brak nowych błędów vs main (baseline: exit 1 pre-existing). Zmiany dotyczą wyłącznie `self-hosted-cloudapi/` (Python), którego knip nie analizuje.

---

## 6. Residualsy

1. **`Session.expires_at` w ścieżce extension** (`validate_client_token`) pozostaje niesprawdzane — patrz D3. Jeśli kiedyś zaczniemy ustawiać tę kolumnę, trzeba dodać check i tam (i ustawić wartość przy `create_session`).
2. **Sesje (tabela `sessions`) nie są purgowane** — po R10 aktywne/wygasłe sesje z `is_active=False` dalej zostają w DB. To celowe: cascade `delete-orphan` na ClientToken powiązany z sesją + brak expiry na kolumnie sprawia, że „którą sesję usunąć" nie ma dziś dobrej odpowiedzi (ostatnio widziana aktywność nie jest zapisywana). Roadmapa R10 wymienia tickety/state/tokeny, nie sesje.
3. **Ktoś z bookmarkiem GET-logout dostanie 405** — patrz D1; świadomy trade-off.
4. **Purge licznik w logu** (`[retention] purged N expired auth row(s)`) — pojawia się dopiero od pierwszego cyklu z porcją do usunięcia; puste cykle nie logują (spójnie z resztą loopa).
