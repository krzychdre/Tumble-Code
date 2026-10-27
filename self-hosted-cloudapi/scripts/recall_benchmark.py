"""Recall search benchmark: millions of synthetic cards, real queries.

The gate of ai_plans/2026-10-26_18-22_cross-session-recall.md, section 5: p95
under 50 ms on the server for the search the API runs (services/recall_search
.search, with the visibility rule and the ranking). Needs an empty, throwaway
Postgres database; it drops and creates every table:

    docker run -d --rm --name recall-bench -p 127.0.0.1:55433:5432 \\
        -e POSTGRES_PASSWORD=test -e POSTGRES_DB=recall \\
        --tmpfs /var/lib/postgresql/data postgres:16.15-alpine
    RECALL_PG_URL=postgresql+asyncpg://postgres:test@127.0.0.1:55433/recall \\
        uv run python scripts/recall_benchmark.py 2000000

``--measure-only`` repeats the measurements on the cards already loaded.

One tenant (an organization) with 300 authors and 2000 projects; every card
has a title of 8 words and a body of 80, drawn from a Zipf-like vocabulary of
English and Polish words and identifiers, so a few words are in most cards and
most words are rare, as in real text.
"""

import asyncio
import itertools
import os
import random
import statistics
import sys
import time

# The app's settings are required at import (config/settings.py); the
# benchmark uses none of them, so placeholders do, as in tests/conftest.py.
os.environ["CLOUDAPI_ENV_FILE"] = ""
for name, value in {
    "DATABASE_URL": os.environ["RECALL_PG_URL"],
    "SECRET_KEY": "benchmark-secret-key-not-used-anywhere-0123",
    "API_BASE_URL": "http://bench",
    "AUTHENTIK_BASE_URL": "http://bench",
    "AUTHENTIK_CLIENT_ID": "bench",
    "AUTHENTIK_REDIRECT_URI": "http://bench/cb",
    "JWT_SECRET": "benchmark-jwt-secret-not-used-anywhere-0123",
}.items():
    os.environ.setdefault(name, value)

import asyncpg  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine  # noqa: E402

from src.database import Base  # noqa: E402
from src.models.project import SCOPE_MEMBERS, SCOPE_ORGANIZATION, Project  # noqa: E402
from src.services import recall_search  # noqa: E402

URL = os.environ["RECALL_PG_URL"]
CARDS = int(next((a for a in sys.argv[1:] if a.isdigit()), 2_000_000))
AUTHORS = 300
PROJECTS = 2000
TENANT = "org_bench"
RUNS = 40

BASE_WORDS = (
    "bridge task cloud project session error test fix build deploy config user model "
    "request response token cache file path query search index card scope tenant "
    "naprawa zadanie projekt sesja blad test poprawka wdrozenie konfiguracja uzytkownik "
    "model zapytanie odpowiedz plik sciezka wyszukiwanie indeks karta zakres"
).split()
VOCABULARY = (
    BASE_WORDS
    + [
        f"{prefix}{n}"
        for n in range(20000)
        for prefix in ("handler", "resolve", "widget")
    ][:60000]
)
# Zipf-like: the k-th word is drawn with weight 1/k (cumulated once, for speed).
CUM_WEIGHTS = list(
    itertools.accumulate(1 / (rank + 1) for rank in range(len(VOCABULARY)))
)


def _text(k: int) -> str:
    return " ".join(random.choices(VOCABULARY, cum_weights=CUM_WEIGHTS, k=k))


async def fill() -> None:
    engine = create_async_engine(URL)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    await engine.dispose()

    conn = await asyncpg.connect(URL.replace("+asyncpg", ""))
    await conn.execute(
        "INSERT INTO users (id, authentik_id, email, first_name, last_name, public_metadata, "
        "created_at, updated_at) SELECT 'u' || n, 'ak' || n, n || '@x', 'U', '', '{}', now(), now() "
        f"FROM generate_series(0, {AUTHORS - 1}) n"
    )
    await conn.execute(
        "INSERT INTO organizations (id, name, has_image, created_at, updated_at) "
        f"VALUES ('{TENANT}', 'Bench', false, now(), now())"
    )
    await conn.execute(
        "INSERT INTO projects (id, tenant_id, organization_id, user_id, key, name, recall_scope, "
        f"created_at, updated_at) SELECT 'p' || n, '{TENANT}', '{TENANT}', 'u0', 'k' || n, "
        f"'p' || n, CASE WHEN n % 2 = 0 THEN '{SCOPE_ORGANIZATION}' ELSE '{SCOPE_MEMBERS}' END, "
        f"now(), now() FROM generate_series(0, {PROJECTS - 1}) n"
    )
    await conn.execute(
        "CREATE UNLOGGED TABLE staging (task_id text, project_id text, author_id text, "
        "last_ts bigint, title text, body text)"
    )
    now_ms = int(time.time() * 1000)
    started = time.monotonic()
    batch = 50_000
    for first in range(0, CARDS, batch):
        rows = [
            (
                f"t{n}",
                f"p{random.randrange(PROJECTS)}",
                f"u{random.randrange(AUTHORS)}",
                now_ms - random.randrange(3 * 365 * 24 * 3600 * 1000),
                # The vocabulary is already normalized (services/recall_text).
                _text(8),
                _text(80),
            )
            for n in range(first, min(first + batch, CARDS))
        ]
        await conn.copy_records_to_table("staging", records=rows)
        print(
            f"generated {first + len(rows)} cards in {time.monotonic() - started:.0f} s"
        )
    await conn.execute(
        "INSERT INTO tasks (id, user_id, client_kind, message_count, tokens_in, tokens_out, "
        "cache_reads, cache_writes, cost, q_requests, q_errors, q_retries, q_interventions, "
        "q_completion_replies, q_condense, q_tools, q_tool_paths, q_distinct_tool_paths, "
        "q_completed, recall_excluded, created_at, updated_at) SELECT task_id, author_id, 'vscode', "
        "0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, true, false, now(), now() FROM staging"
    )
    await conn.execute(
        "INSERT INTO session_cards SELECT task_id, $1, project_id, author_id, title, body, "
        "setweight(to_tsvector('simple', title), 'A') || setweight(to_tsvector('simple', body), 'B'), "
        "last_ts, true, false, now() FROM staging",
        TENANT,
    )
    await conn.execute("DROP TABLE staging")
    # Docker gives a container 64 MB of /dev/shm, too little for parallel
    # maintenance workers on millions of rows.
    await conn.execute("SET max_parallel_maintenance_workers = 0")
    await conn.execute("VACUUM ANALYZE session_cards")
    size = await conn.fetchval(
        "SELECT pg_size_pretty(pg_total_relation_size('session_cards'))"
    )
    print(
        f"filled {CARDS} cards in {time.monotonic() - started:.0f} s; table and index: {size}"
    )
    await conn.close()


async def measure() -> None:
    engine = create_async_engine(URL)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as db:
        org_project = await db.get(Project, "p0")
        members_project = await db.get(Project, "p1")
    cases = {
        "one common word": (org_project, False, lambda: "bridge"),
        "two words": (
            org_project,
            False,
            lambda: f"{random.choice(BASE_WORDS)} {random.choice(BASE_WORDS)}",
        ),
        "identifier": (org_project, False, lambda: f"handler{random.randrange(20000)}"),
        "cross-project, common word": (
            org_project,
            True,
            lambda: random.choice(BASE_WORDS),
        ),
        "cross-project, two words": (
            org_project,
            True,
            lambda: f"{random.choice(BASE_WORDS)} {random.choice(BASE_WORDS)}",
        ),
        "cross-project, identifier": (
            org_project,
            True,
            lambda: f"resolve{random.randrange(20000)}",
        ),
        "same project (members)": (
            members_project,
            False,
            lambda: random.choice(BASE_WORDS),
        ),
    }
    for label, (project, wide, query) in cases.items():
        took, broad = [], 0
        for _ in range(RUNS):
            async with factory() as db:
                started = time.perf_counter()
                result = await recall_search.search(
                    db, "u7", project, query(), wide, 10, None
                )
                took.append((time.perf_counter() - started) * 1000)
                broad += result.too_broad
                await db.rollback()
        took.sort()
        p95 = took[int(len(took) * 0.95) - 1]
        print(
            f"{label:30} p50 {statistics.median(took):7.1f} ms   p95 {p95:7.1f} ms   "
            f"too broad {broad}/{RUNS}"
        )
    await engine.dispose()


async def main() -> None:
    if "--measure-only" not in sys.argv:
        await fill()
    await measure()


if __name__ == "__main__":
    asyncio.run(main())
