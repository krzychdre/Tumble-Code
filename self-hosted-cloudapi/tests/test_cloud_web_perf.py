"""P12: web panel transfer and query costs.

Four independent defects, one section each:

- responses went out uncompressed (290 KB Chart.js, 58 KB CSS, every page);
- the vendored scripts had no version in their URL and no Cache-Control, so a
  browser revalidated (or re-downloaded) them on every page;
- the task page's breadcrumb read its ancestors one query per level;
- the settings page summed the byte size of every selected message and event
  on every GET (about 0.85 s of the 0.9 s it took on the live corpus).
"""

import os
import re
from datetime import datetime, timedelta, timezone

from sqlalchemy import event, select

from src.auth.web_session import get_web_user_optional
from src.models.task import Task

from tests.web_helpers import _add_message, _msgs, _override_web_user, _seed_user


class _Statements:
    """Every SQL statement the engine runs while the block is open."""

    def __init__(self, engine):
        self.engine = engine.sync_engine
        self.seen: list[str] = []

    def _record(self, conn, cursor, statement, parameters, context, executemany):
        self.seen.append(statement)

    def __enter__(self):
        event.listen(self.engine, "before_cursor_execute", self._record)
        return self

    def __exit__(self, *exc):
        event.remove(self.engine, "before_cursor_execute", self._record)

    @property
    def selects(self) -> list[str]:
        return [s for s in self.seen if s.lstrip().upper().startswith(("SELECT", "WITH"))]


async def _chain(session_factory, depth: int, prefix: str = "a") -> list[str]:
    """A straight line of ``depth`` tasks, root first; returns their ids."""
    start = datetime(2026, 9, 1, tzinfo=timezone.utc)
    ids = [f"{prefix}{n}" for n in range(depth)]
    async with session_factory() as s:
        for n, task_id in enumerate(ids):
            s.add(
                Task(
                    id=task_id,
                    user_id="user_test",
                    title=f"Level {n}",
                    parent_task_id=ids[n - 1] if n else None,
                    created_at=start + timedelta(minutes=n),
                )
            )
            await s.flush()
        await s.commit()
    return ids


# --- breadcrumb: one query, not one per level ------------------------------


async def test_ancestors_cost_one_query_whatever_the_depth(db_session, session_factory, test_engine):
    from src.services.task_tree import ancestors

    await _seed_user(db_session)
    ids = await _chain(session_factory, 7)

    async with session_factory() as s:
        leaf = (await s.execute(select(Task).where(Task.id == ids[-1]))).scalar_one()
        with _Statements(test_engine) as sql:
            chain = await ancestors(s, leaf)

    assert [t.id for t in chain] == list(reversed(ids[:-1])), "nearest first, up to the root"
    assert len(sql.selects) == 1, f"one statement for six ancestors, got {len(sql.selects)}"


async def test_ancestors_stop_at_the_limit_nearest_first(db_session, session_factory):
    """The bound the walk always had: ``limit`` nearest ancestors, no more."""
    from src.services.task_tree import ancestors

    await _seed_user(db_session)
    ids = await _chain(session_factory, 14, prefix="deep")

    async with session_factory() as s:
        leaf = (await s.execute(select(Task).where(Task.id == ids[-1]))).scalar_one()
        chain = await ancestors(s, leaf)
        short = await ancestors(s, leaf, limit=3)

    assert [t.id for t in chain] == list(reversed(ids[-11:-1]))
    assert [t.id for t in short] == [ids[-2], ids[-3], ids[-4]]


async def test_ancestors_of_a_root_cost_nothing(db_session, session_factory, test_engine):
    from src.services.task_tree import ancestors

    await _seed_user(db_session)
    ids = await _chain(session_factory, 1, prefix="lone")

    async with session_factory() as s:
        root = (await s.execute(select(Task).where(Task.id == ids[0]))).scalar_one()
        with _Statements(test_engine) as sql:
            assert await ancestors(s, root) == []
    assert sql.selects == []


def test_the_ancestor_query_is_a_recursive_cte_on_postgres():
    """The production database is Postgres: the statement must compile there as
    WITH RECURSIVE, not only on the SQLite the suite runs."""
    from sqlalchemy.dialects import postgresql

    from src.services.task_tree import _ancestor_query

    sql = str(_ancestor_query("child", 10).compile(dialect=postgresql.dialect()))
    assert sql.lstrip().upper().startswith("WITH RECURSIVE")


async def test_the_task_page_does_not_grow_a_query_per_level(
    client, db_session, session_factory, test_engine
):
    await _seed_user(db_session)
    shallow = await _chain(session_factory, 2, prefix="s")
    deep = await _chain(session_factory, 8, prefix="d")

    _override_web_user(client.app)
    try:
        with _Statements(test_engine) as sql:
            resp = client.get(f"/app/tasks/{shallow[-1]}")
        shallow_selects = len(sql.selects)
        with _Statements(test_engine) as sql:
            deep_resp = client.get(f"/app/tasks/{deep[-1]}")
        deep_selects = len(sql.selects)
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.status_code == deep_resp.status_code == 200
    for task_id in deep[:-1]:
        assert f'href="/app/tasks/{task_id}"' in deep_resp.text, "every ancestor is in the breadcrumb"
    assert deep_selects == shallow_selects


# --- compression -----------------------------------------------------------


def test_large_responses_are_gzipped(client):
    resp = client.get("/static/vendor/chart.umd.min.js", headers={"Accept-Encoding": "gzip"})
    assert resp.status_code == 200
    assert resp.headers.get("content-encoding") == "gzip"
    assert "Accept-Encoding" in resp.headers.get("vary", "")


async def test_pages_are_gzipped(client, db_session):
    await _seed_user(db_session)
    _override_web_user(client.app)
    try:
        resp = client.get("/app/settings", headers={"Accept-Encoding": "gzip"})
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)
    assert resp.status_code == 200
    assert resp.headers.get("content-encoding") == "gzip"
    assert "Data retention" in resp.text, "the client still reads the page"


def test_small_responses_stay_plain(client):
    resp = client.get("/health", headers={"Accept-Encoding": "gzip"})
    assert resp.status_code == 200
    assert "content-encoding" not in resp.headers


def test_uncompressed_when_the_client_does_not_ask(client):
    resp = client.get("/static/vendor/chart.umd.min.js", headers={"Accept-Encoding": "identity"})
    assert "content-encoding" not in resp.headers
    assert len(resp.content) == os.path.getsize(
        os.path.join(os.path.dirname(__file__), "..", "src", "web", "static", "vendor", "chart.umd.min.js")
    )


# --- versioned static URLs with a long cache -------------------------------


def _static_urls(html: str) -> list[str]:
    return re.findall(r'(?:src|href)="(/static/[^"]+)"', html)


def test_every_template_versions_its_static_urls():
    """Every page, including those that load Chart.js only when there is data."""
    templates_dir = os.path.join(os.path.dirname(__file__), "..", "src", "web", "templates")
    found = []
    for name in sorted(os.listdir(templates_dir)):
        with open(os.path.join(templates_dir, name), encoding="utf-8") as fh:
            for url in _static_urls(fh.read()):
                found.append(url)
                assert url.endswith("?v={{ asset_v }}"), f"{name}: {url} has no version token"
    assert any("chart.umd.min.js" in u for u in found)


async def test_a_rendered_page_carries_the_current_token(client, db_session, session_factory):
    from src.web.templating import templates

    await _seed_user(db_session)
    ids = await _chain(session_factory, 1, prefix="page")
    token = templates.env.globals["asset_v"]

    _override_web_user(client.app)
    try:
        resp = client.get(f"/app/tasks/{ids[0]}")
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    urls = _static_urls(resp.text)
    assert any("socket.io.min.js" in u for u in urls), "the task page loads socket.io"
    for url in urls:
        assert url.endswith(f"?v={token}"), f"{url} has no version token"


def test_a_versioned_asset_is_cached_for_a_year(client):
    from src.web.templating import templates

    token = templates.env.globals["asset_v"]
    resp = client.get(f"/static/vendor/chart.umd.min.js?v={token}")
    assert resp.status_code == 200
    cache = resp.headers.get("cache-control", "")
    assert "immutable" in cache and "max-age=31536000" in cache, cache


def test_an_unversioned_or_stale_url_is_not_cached_for_a_year(client):
    for url in ("/static/vendor/chart.umd.min.js", "/static/vendor/chart.umd.min.js?v=stale"):
        resp = client.get(url)
        assert resp.status_code == 200
        assert "immutable" not in resp.headers.get("cache-control", ""), url


def test_the_version_token_follows_content_not_mtime(tmp_path):
    """An immutable cache is only safe if a content change always changes the
    URL. mtimes do not guarantee that (a checkout or an image build can set
    them to anything), so the token must be derived from the bytes."""
    from src.web.templating import _asset_version

    one, two = tmp_path / "one", tmp_path / "two"
    for folder, body in ((one, b"console.log(1)"), (two, b"console.log(2)")):
        folder.mkdir()
        (folder / "a.js").write_bytes(body)
        os.utime(folder / "a.js", ns=(1_700_000_000_000_000_000, 1_700_000_000_000_000_000))

    assert _asset_version(one) != _asset_version(two)
    assert _asset_version(one) == _asset_version(one)


# --- settings: the size scan only on demand --------------------------------


async def _selectable_corpus(session_factory, count: int = 3):
    """Old tasks with messages, and a policy that selects them all."""
    from src.services.retention_service import get_policy

    when = datetime.now(timezone.utc) - timedelta(days=200)
    async with session_factory() as s:
        for n in range(count):
            s.add(Task(id=f"old-{n}", user_id="user_test", title=f"Old {n}", updated_at=when))
            await s.flush()
            await _add_message(s, f"old-{n}", _msgs()[0])
        policy = await get_policy(s, "user_test")
        policy.max_age_days = 30
        await s.commit()


def _size_scans(statements: list[str]) -> list[str]:
    return [s for s in statements if "length(" in s.lower()]


async def test_opening_settings_does_not_scan_payload_sizes(
    client, db_session, session_factory, test_engine
):
    await _seed_user(db_session)
    await _selectable_corpus(session_factory)

    _override_web_user(client.app)
    try:
        with _Statements(test_engine) as sql:
            resp = client.get("/app/settings")
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.status_code == 200
    assert _size_scans(sql.seen) == [], "a plain GET must not sum payload sizes"
    # The counts are still there, they are cheap.
    assert re.search(r'signal-value">3</span><span class="signal-label">Tasks', resp.text)
    assert re.search(r'signal-value">3</span><span class="signal-label">Messages', resp.text)
    # The size is one click away.
    assert 'href="/app/settings?size=1"' in resp.text


async def test_the_size_is_calculated_on_demand(client, db_session, session_factory, test_engine):
    from src.services.retention_service import plan_sweep, read_policy
    from src.utils.format import fmt_bytes

    await _seed_user(db_session)
    await _selectable_corpus(session_factory)
    async with session_factory() as s:
        expected = await plan_sweep(s, "user_test", await read_policy(s, "user_test"))
    assert expected.total_bytes > 0, "the fixture must have something to measure"

    _override_web_user(client.app)
    try:
        with _Statements(test_engine) as sql:
            resp = client.get("/app/settings?size=1")
    finally:
        client.app.dependency_overrides.pop(get_web_user_optional, None)

    assert resp.status_code == 200
    assert _size_scans(sql.seen), "the on-demand request does measure"
    assert f'signal-value">{fmt_bytes(expected.total_bytes)}</span>' in resp.text
    assert 'href="/app/settings?size=1"' not in resp.text
