"""Web panel scale benchmark, part 2: the pages, timed end to end.

Times the panel's heaviest pages for the power user of the corpus
scripts/web_scale_seed.py builds, through the app itself (ASGI, no network,
no Authentik: the signed-in reader is a dependency override, as in
tests/web_helpers.py, and the app's lifespan never runs). It knows only
URLs, so the same script measures every branch of the plan
ai_plans/2026-10-27_22-05_web-ui-db-query-scale.md. Measure a copy of
web_base, never web_base itself:

    docker exec web-scale-bench psql -U postgres \\
        -c "CREATE DATABASE web_x TEMPLATE web_base STRATEGY FILE_COPY"
    cd self-hosted-cloudapi
    WEB_BENCH_PG_URL=postgresql+asyncpg://postgres:test@127.0.0.1:55434/web_x \\
        WEB_BENCH_LABEL=x uv run --frozen python scripts/web_scale_measure.py

Each page is requested once to warm up, then RUNS times. Per page: the median
and the slowest wall time, and of the median run the number of SQL
statements, their summed time (sent to answered, rows fetched), the rest
(Python and rendering) and the slowest statement, whose EXPLAIN (ANALYZE,
BUFFERS) goes to /tmp/web-scale-bench/<label>/<page>.txt. The table goes to
summary.txt beside them.
"""

import asyncio
import os
import re
import statistics
import time
from pathlib import Path

# Imported first: it points the app's settings at WEB_BENCH_PG_URL.
from web_scale_seed import ORG, POWER_EMAIL, POWER_USER, SEARCH_WORD, URL

import asyncpg  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy import event  # noqa: E402

from src.auth.web_session import get_web_user_optional  # noqa: E402
from src.database import engine  # noqa: E402
from src.main import app  # noqa: E402

LABEL = os.environ["WEB_BENCH_LABEL"]
OUT = Path("/tmp/web-scale-bench") / LABEL
RUNS = 5

SCENARIOS = {
    "metrics_all": "/app/metrics?period=all",
    "metrics_30d": "/app/metrics?period=30d",
    "metrics_org_all_user": f"/app/metrics?period=all&space={ORG}&group=user",
    "metrics_org_all_model": f"/app/metrics?period=all&space={ORG}&group=model",
    # The quality panel's period bound on the organization's runs.
    "metrics_org_30d": f"/app/metrics?period=30d&space={ORG}&group=project",
    # No parameters and no cookie: grouped by project, runs only.
    "list_default": "/app",
    "list_group_model": "/app?group=model",
    "list_group_cost": "/app?sort=cost&dir=desc",
    "list_flat": "/app?group=none",
    "list_flat_cost": "/app?group=none&sort=cost&dir=desc",
    "list_flat_page_300": "/app?group=none&page=300",
    "list_search": f"/app?group=none&q={SEARCH_WORD}",
    "list_model_filter": "/app?group=none&model=GLM",
    "diagnostics_all": "/app/diagnostics?period=all",
}


class Statements:
    """The SQL statements of a request: (ms, statement, parameters)."""

    def __init__(self):
        self.seen: list[tuple[float, str, tuple]] = []

    def before(self, conn, cursor, statement, parameters, context, executemany):
        conn.info["bench_started"] = time.perf_counter()

    def after(self, conn, cursor, statement, parameters, context, executemany):
        started = conn.info.pop("bench_started")
        self.seen.append(
            ((time.perf_counter() - started) * 1000, statement, parameters)
        )


async def request(client: AsyncClient, statements: Statements, path: str) -> dict:
    # A remembered view or period would change what a later request shows.
    client.cookies.clear()
    statements.seen.clear()
    started = time.perf_counter()
    response = await client.get(path)
    wall = (time.perf_counter() - started) * 1000
    if response.status_code != 200:
        raise SystemExit(f"{path} answered {response.status_code}")
    return {
        "wall": wall,
        "sql": sum(ms for ms, _, _ in statements.seen),
        "count": len(statements.seen),
        "slowest": max(statements.seen, key=lambda s: s[0]),
        "kb": len(response.content) / 1024,
    }


async def explain(statement: str, parameters: tuple) -> str:
    conn = await asyncpg.connect(URL.replace("+asyncpg", ""))
    rows = await conn.fetch(f"EXPLAIN (ANALYZE, BUFFERS) {statement}", *parameters)
    await conn.close()
    return "\n".join(row[0] for row in rows)


def one_line(statement: str) -> str:
    return re.sub(r"\s+", " ", statement).strip()


async def main() -> None:
    print(f"measuring {URL} as {LABEL!r}, {RUNS} runs per page")
    OUT.mkdir(parents=True, exist_ok=True)
    statements = Statements()
    event.listen(engine.sync_engine, "before_cursor_execute", statements.before)
    event.listen(engine.sync_engine, "after_cursor_execute", statements.after)
    app.dependency_overrides[get_web_user_optional] = lambda: {
        "user_id": POWER_USER,
        "session_id": "sess_bench",
        "email": POWER_EMAIL,
        "name": "Power User",
        "image_url": None,
    }
    table = [
        f"{'page':22} {'median ms':>10} {'max ms':>9} {'stmts':>6} {'sql ms':>9} "
        f"{'other ms':>9} {'slowest ms':>11} {'kB':>6}"
    ]
    slowest = []
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://bench") as client:
        for name, path in SCENARIOS.items():
            await request(client, statements, path)
            runs = [await request(client, statements, path) for _ in range(RUNS)]
            walls = sorted(r["wall"] for r in runs)
            median = sorted(runs, key=lambda r: r["wall"])[len(runs) // 2]
            ms, statement, parameters = median["slowest"]
            plan = await explain(statement, parameters)
            (OUT / f"{name}.txt").write_text(
                f"{path}\nruns ms: {', '.join(f'{w:.0f}' for w in walls)}\n"
                f"slowest statement of the median run, {ms:.1f} ms:\n\n{statement}\n\n"
                f"parameters: {parameters}\n\n{plan}\n"
            )
            line = (
                f"{name:22} {statistics.median(walls):10.0f} {walls[-1]:9.0f} "
                f"{median['count']:6} {median['sql']:9.0f} "
                f"{median['wall'] - median['sql']:9.0f} {ms:11.1f} {median['kb']:6.0f}"
            )
            print(line, flush=True)
            table.append(line)
            slowest.append(f"{name}: {one_line(statement)[:240]}")
    await engine.dispose()
    summary = "\n".join([*table, "", "slowest statement per page:", *slowest]) + "\n"
    print(f"\n{summary}")
    (OUT / "summary.txt").write_text(summary)


if __name__ == "__main__":
    asyncio.run(main())
