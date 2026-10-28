"""Web panel scale benchmark, part 1: a synthetic corpus of a large deployment.

The measurements of ai_plans/2026-10-27_22-05_web-ui-db-query-scale.md
(scripts/web_scale_measure.py times the pages on what this builds). Needs a
throwaway Postgres; it drops and recreates the database the URL names,
``web_base``. The
compose file passes its Postgres no server settings, so neither does this:

    docker run -d --name web-scale-bench --shm-size=1g -p 127.0.0.1:55434:5432 \\
        -e POSTGRES_PASSWORD=test -e POSTGRES_DB=postgres postgres:16.15-alpine
    cd self-hosted-cloudapi
    WEB_BENCH_PG_URL=postgresql+asyncpg://postgres:test@127.0.0.1:55434/web_base \\
        uv run --frozen python scripts/web_scale_seed.py

The schema comes from create_all and is stamped at the alembic head, as
db-migrate.sh does for a fresh database, so a copy of it (``CREATE DATABASE
web_x TEMPLATE web_base``) takes a branch's migrations with a plain
``alembic upgrade head``.

Calibrated on the live deployment (2026-10-27: one user, 1,517 tasks, 34,014
LLM Completion events, 19,270 Embedding Usage events): the completions per
task, the subtask share, the model, provider, mode, kind and client mix, the
token and cost ranges and the payload keys. Scaled up:

- 2,000 users; 1,000 of them are members of the organization org_bench and
  hold 170,000 of the 200,000 tasks, the other 1,000 hold personal ones;
- the power user (an admin of org_bench) has 20,000 tasks;
- 60 % of the tasks are subtasks, in trees up to 4 levels deep under 15 % of
  the runs; the runs start over the last two years;
- about 22 LLM Completion events per task, inside the task's lifetime, and
  the task's summary columns summed from them;
- Embedding Usage events in the live proportion for the power user and at a
  tenth of it for everyone else (disk);
- for the power user's problem report: error events and conversation errors
  (with the requests they are attributed by) before the first error report,
  error reports after it.

No Task Message events and no conversations otherwise: no measured page reads
them. Seeded with a fixed random seed, so every run builds the same corpus
(the timestamps follow the clock).
"""

import asyncio
import json
import math
import os
import random
import time
import uuid
from datetime import datetime, timedelta, timezone

URL = os.environ["WEB_BENCH_PG_URL"]
DATABASE = URL.rsplit("/", 1)[1]
# The app's settings are required at import (config/settings.py). The
# database is the bench's, whatever the shell says; the rest are placeholders,
# as in tests/conftest.py.
os.environ["CLOUDAPI_ENV_FILE"] = ""
os.environ["DATABASE_URL"] = URL
for name, value in {
    "SECRET_KEY": "benchmark-secret-key-not-used-anywhere-0123",
    "API_BASE_URL": "http://bench",
    "AUTHENTIK_BASE_URL": "http://bench",
    "AUTHENTIK_CLIENT_ID": "bench",
    "AUTHENTIK_REDIRECT_URI": "http://bench/cb",
    "AUTHENTIK_API_TOKEN": "benchmark-authentik-token-not-used-0123",
    "JWT_SECRET": "benchmark-jwt-secret-not-used-anywhere-0123",
    "LOG_LEVEL": "WARNING",
}.items():
    os.environ.setdefault(name, value)

import asyncpg  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from sqlalchemy.ext.asyncio import create_async_engine  # noqa: E402

import src.models  # noqa: E402, F401 - registers every table on Base.metadata
from src.database import Base  # noqa: E402
from src.services.organizations import ROLE_ADMIN  # noqa: E402

SEED = 20261027
NOW = datetime.now(timezone.utc)
SPAN = timedelta(days=730)
# Error reports arrive from here on; before it the problem report reads the
# legacy sources (error events, conversation errors).
REPORTS_SINCE = NOW - timedelta(days=365)
# Completions carry durationMs from here on.
DURATIONS_SINCE = NOW - timedelta(days=365)

USERS = 2000
ORG = "org_bench"
ORG_MEMBERS = 1000
ORG_ADMINS = 5
POWER_USER = "user_power"
POWER_EMAIL = "power@bench.example"
POWER_TASKS = 20_000
MEMBER_TASKS = 150_000
SOLO_TASKS = 30_000
ORG_PROJECTS = 400
POWER_PROJECTS = 26

ROOT_SHARE = 0.4
DELEGATING_SHARE = 0.15
MAX_DEPTH = 4
# Live: 131 of 1,517 tasks have no completion; the rest a median of 10, a
# 90th percentile of 56, a mean of 24.
NO_COMPLETIONS = 0.086
COMPLETIONS_MEDIAN = 10
COMPLETIONS_SIGMA = 1.34
COMPLETIONS_MAX = 600
EMBEDDINGS_PER_COMPLETION = 0.57
OTHERS_EMBEDDING_FACTOR = 0.1
ERROR_EVENTS_PER_TASK = 1.5
REPORTS_PER_TASK = 0.6
# In about 12 % of the titles (scripts/web_scale_measure.py searches for it).
SEARCH_WORD = "deploy"
BATCH = 50_000

# (provider, model, live completions, $ per million input, cached input and
# output tokens). The prices put the median completion near the live $0.005.
MODELS = [
    ("openai", "DeepSeek-V4.1-Flash-1017", 11897, 0.27, 0.03, 1.1),
    ("openai", "GLM-5.3-Flash-NVFP4", 9684, 0.2, 0.03, 0.8),
    ("openai", "GLM-5.3-NVFP4", 9134, 0.6, 0.11, 2.2),
    ("openai", "DeepSeek-V4.1-Flash-1017-abliterated", 1246, 0.27, 0.03, 1.1),
    ("openai", "Qwen3.8-27B", 547, 0.1, 0.01, 0.4),
    ("openai", "qwen3.8-27b", 335, 0.1, 0.01, 0.4),
    ("openai", "Qwen3.5-4B", 95, 0.02, 0.0, 0.08),
    ("anthropic", "claude-haiku-5-5", 71, 1.0, 0.1, 5.0),
    ("openai", "Qwen3.6-35B-A3B", 23, 0.1, 0.01, 0.4),
    ("openai", "Qwen3.8-27B-small", 20, 0.1, 0.01, 0.4),
    ("openai", "Qwen3.5-2B", 13, 0.02, 0.0, 0.08),
    ("anthropic", "claude-sonnet-5-5", 9, 3.0, 0.3, 15.0),
    ("openai", "LiquidAI/LFM2.5-2.6B-GGUF:Q4_K_M", 6, 0.02, 0.0, 0.08),
    ("anthropic", "claude-opus-5-5", 3, 5.0, 0.5, 25.0),
]
MODEL_WEIGHTS = [m[2] for m in MODELS]
MODES = [
    "code",
    "ask",
    "orchestrator",
    "code-reviewer",
    "reviewer",
    "architect",
    "debug",
    "vision",
]
MODE_WEIGHTS = [30445, 1342, 820, 445, 355, 296, 238, 73]
# (source, live events, median promptTokens)
EMBEDDING_SOURCES = [
    ("index-scan", 9929, 4680),
    ("index-watch", 9307, 7811),
    ("search", 34, 13),
]
ERROR_EVENTS = [
    "Code Index Error",
    "Diff Application Error",
    "Consecutive Mistake Error",
    "Exception",
    "Schema Validation Error",
]
ERROR_EVENT_WEIGHTS = [4581, 333, 21, 17, 4]
REPORT_CATEGORIES = [
    (
        "tool_error",
        417,
        ["read_file", "execute_command", "web_fetch", "search_files", "list_files"],
    ),
    ("diff_error", 231, ["apply_diff"]),
    ("api_error", 86, [None]),
    ("invalid_tool_call", 65, ["write_to_file", "apply_diff", "execute_command"]),
    ("empty_response", 54, [None]),
    ("mistake_limit", 14, [None]),
    ("context_overflow", 4, [None]),
]

WORDS = (
    "fix task cloud project session error test build bridge deploy config user model "
    "request response token cache file path query search index card scope tenant "
    "naprawa zadanie projekt sesja blad test poprawka wdrozenie konfiguracja uzytkownik "
    "zapytanie odpowiedz plik sciezka wyszukiwanie indeks karta zakres plan review"
).split()
VOCABULARY = WORDS + [
    f"{prefix}{n}" for n in range(1000) for prefix in ("handler", "resolve", "widget")
]
# Zipf-like: the k-th word is drawn with weight 1/k.
CUM_WEIGHTS = []
for rank in range(len(VOCABULARY)):
    CUM_WEIGHTS.append((CUM_WEIGHTS[-1] if CUM_WEIGHTS else 0) + 1 / (rank + 1))
FIRST_NAMES = "Anna Piotr Maria Jan Kasia Tomasz Ola Marek Ewa Pawel Alice Bob Carol Dave Erin Frank".split()
LAST_NAMES = "Nowak Kowalski Wisniewski Lewandowska Zielinski Smith Jones Brown Taylor Wilson".split()
PROJECT_WORDS = "atlas beacon comet delta ember falcon garnet harbor iris juniper kestrel lumen".split()

rng = random.Random(SEED)


def lognormal(median: float, sigma: float) -> float:
    return rng.lognormvariate(math.log(median), sigma)


def scattered(rate: float) -> int:
    """A count with mean ``rate``, spread like real counts are."""
    return int(rate * rng.expovariate(1.0) + rng.random())


def text(words: int) -> str:
    return " ".join(rng.choices(VOCABULARY, cum_weights=CUM_WEIGHTS, k=words))


def task_uuid(start: datetime) -> str:
    """A UUIDv7 like the extension's task ids: the start time leads."""
    ms = int(start.timestamp() * 1000)
    value = (
        (ms << 80)
        | (7 << 76)
        | (rng.getrandbits(12) << 64)
        | (2 << 62)
        | rng.getrandbits(62)
    )
    return str(uuid.UUID(int=value))


def short_id(prefix: str) -> str:
    """Like models/base.generate_id."""
    return f"{prefix}{rng.getrandbits(100):025x}"


class BenchUser:
    def __init__(self, n: int):
        self.n = n
        self.power = n == 0
        self.id = POWER_USER if self.power else short_id("user_")
        self.email = POWER_EMAIL if self.power else f"u{n}@bench.example"
        self.org = ORG if n < ORG_MEMBERS else None
        self.handle = f"u{n}"
        # The power user works with every model, in the live mix.
        picks = len(MODELS) if self.power else rng.randint(1, 3)
        self.models = (
            list(range(len(MODELS)))
            if self.power
            else rng.choices(range(len(MODELS)), MODEL_WEIGHTS, k=picks)
        )
        self.model_weights = [MODEL_WEIGHTS[m] for m in self.models]
        # (project id, name, key) of the projects the user works in.
        self.projects: list[tuple[str, str, str]] = []


class BenchTask:
    __slots__ = (
        "id",
        "user",
        "parent",
        "children",
        "depth",
        "project",
        "workspace",
        "client",
        "model",
        "second_model",
        "mode",
        "start",
        "end",
    )

    def __init__(self, user: BenchUser, parent=None):
        self.user = user
        self.parent = parent
        self.children: list[BenchTask] = []
        self.depth = parent.depth + 1 if parent else 0
        if parent is None:
            self.project, self.workspace = pick_folder(user)
            self.client = "cli" if rng.random() < 0.077 else "vscode"
            self.model = rng.choices(user.models, user.model_weights)[0]
        else:
            parent.children.append(self)
            self.project, self.workspace, self.client = (
                parent.project,
                parent.workspace,
                parent.client,
            )
            self.model = (
                parent.model
                if rng.random() < 0.7
                else rng.choices(user.models, user.model_weights)[0]
            )
        self.second_model = (
            rng.choices(user.models, user.model_weights)[0]
            if rng.random() < 0.01
            else None
        )
        self.mode = rng.choices(MODES, MODE_WEIGHTS)[0]


def pick_folder(user: BenchUser) -> tuple:
    """(project, workspace path) of a new run: one of the user's projects,
    sometimes a worktree of it, now and then a folder bound to none."""
    if rng.random() < 0.03:
        return None, f"/home/{user.handle}"
    project = rng.choices(
        user.projects, [1 / (k + 1) for k in range(len(user.projects))]
    )[0]
    path = f"/home/{user.handle}/src/{project[1]}"
    if rng.random() < 0.2:
        path += f"-wt{rng.randint(1, 3)}"
    return project, path


def project_key(name: str, owner: str) -> str:
    if rng.random() < 0.3:
        return f"folder:{rng.getrandbits(128):032x}"
    return f"github.com/{owner}/{name}"


def make_projects(users: list[BenchUser]) -> list[tuple]:
    """The project rows, and each user's share of them."""
    created = NOW - SPAN - timedelta(days=1)
    rows = []
    org_projects = []
    for n in range(ORG_PROJECTS):
        name = f"{PROJECT_WORDS[n % len(PROJECT_WORDS)]}-{n}"
        owner = users[rng.randrange(ORG_MEMBERS)]
        project = (short_id("prj_"), name, project_key(name, "bench-org"))
        org_projects.append(project)
        rows.append(
            (
                project[0],
                ORG,
                ORG,
                owner.id,
                project[2],
                name,
                None,
                "none",
                created,
                created,
            )
        )
    popularity = [1 / (k + 1) for k in range(ORG_PROJECTS)]
    for user in users:
        if user.org:
            count = POWER_PROJECTS if user.power else rng.randint(2, 8)
            user.projects = list(
                {
                    p[0]: p for p in rng.choices(org_projects, popularity, k=count)
                }.values()
            )
            continue
        for k in range(rng.randint(1, 4)):
            name = f"{rng.choice(PROJECT_WORDS)}-{k}"
            project = (short_id("prj_"), name, project_key(name, user.handle))
            user.projects.append(project)
            rows.append(
                (
                    project[0],
                    user.id,
                    None,
                    user.id,
                    project[2],
                    name,
                    None,
                    "none",
                    created,
                    created,
                )
            )
    return rows


def task_counts(users: list[BenchUser]) -> list[int]:
    """How many tasks each user has: skewed, as usage is."""
    counts = [0] * len(users)
    counts[0] = POWER_TASKS
    for first, last, total in (
        (1, ORG_MEMBERS, MEMBER_TASKS),
        (ORG_MEMBERS, USERS, SOLO_TASKS),
    ):
        weights = [rng.lognormvariate(0, 1.0) for _ in range(first, last)]
        scale = total / sum(weights)
        for offset, weight in enumerate(weights):
            counts[first + offset] = max(1, round(weight * scale))
    return counts


def make_tasks(user: BenchUser, count: int) -> list[BenchTask]:
    """The user's runs, and their subtasks under a few of them."""
    roots = [BenchTask(user) for _ in range(max(1, round(count * ROOT_SHARE)))]
    subtasks = count - len(roots)
    tasks = list(roots)
    if subtasks:
        delegating = rng.sample(roots, max(1, round(len(roots) * DELEGATING_SHARE)))
        open_nodes = {id(run): [run] for run in delegating}
        weights = [rng.lognormvariate(0, 1.2) for _ in delegating]
        for run in rng.choices(delegating, weights, k=subtasks):
            nodes = open_nodes[id(run)]
            parent = run if rng.random() < 0.55 else rng.choice(nodes)
            child = BenchTask(user, parent)
            tasks.append(child)
            if child.depth < MAX_DEPTH:
                nodes.append(child)
        for task in tasks:
            if task.children and rng.random() < 0.5:
                task.mode = "orchestrator"
    return tasks


def place(task: BenchTask, start: datetime) -> None:
    """Start the task at ``start``; its subtasks run one after another inside it."""
    task.start = start
    # Live: a median of 3 minutes, a 99th percentile of about 5 hours.
    own = timedelta(minutes=lognormal(3, 1.8))
    at = start + timedelta(seconds=rng.uniform(5, 60))
    for child in task.children:
        place(child, at)
        at = child.end + timedelta(seconds=rng.uniform(5, 60))
    task.end = max(start + own, at)


def shift(task: BenchTask, by: timedelta) -> None:
    task.start -= by
    task.end -= by
    for child in task.children:
        shift(child, by)


def completion_count() -> int:
    if rng.random() < NO_COMPLETIONS:
        return 0
    return min(
        COMPLETIONS_MAX, max(1, round(lognormal(COMPLETIONS_MEDIAN, COMPLETIONS_SIGMA)))
    )


def common_props(client: str, start: datetime) -> dict:
    """The keys every event of the client carries, in the live order."""
    props = {
        "appName": "tumble-code",
        "appVersion": "1.1.2" if start > NOW - timedelta(days=200) else "1.0.0",
        "vscodeVersion": "1.143.1",
        "platform": "linux",
        "editorName": "wrapper|cli|cli|1.0.0"
        if client == "cli"
        else "Visual Studio Code",
    }
    # Older extensions did not say which client they were.
    if client == "cli" or start > NOW - timedelta(days=500):
        props["clientKind"] = client
    if client == "cli":
        props["clientVersion"] = "0.2.0"
    props["language"] = "en"
    return props


def repository(task: BenchTask) -> dict:
    """What the extension says about the folder's git repository."""
    if not task.project or task.project[2].startswith("folder:"):
        return {}
    return {
        "repositoryUrl": f"https://{task.project[2]}.git",
        "repositoryName": task.project[2].split("/", 1)[1],
    }


def completion_prefixes(task: BenchTask) -> tuple[dict, bool]:
    """Per model the task ran on, its events' payload up to the token figures
    (the same for every completion of the task, so dumped once), and whether
    the events name no model."""
    out = {}
    no_model = rng.random() < 0.027
    no_provider = rng.random() < 0.005
    for model in {task.model, task.second_model} - {None}:
        props = common_props(task.client, task.start)
        props.update(mode=task.mode, cloudIsAuthenticated=True, taskId=task.id)
        if not no_provider:
            props["apiProvider"] = MODELS[model][0]
        if not no_model:
            props["modelId"] = MODELS[model][1]
        props["isSubtask"] = task.parent is not None
        if task.parent is not None:
            props["parentTaskId"] = task.parent.id
        if task.start < NOW - timedelta(days=365):
            props["diffStrategy"] = "MultiSearchReplace"
        props.update(repository(task))
        if rng.random() < 0.84:
            props["defaultBranch"] = "main"
        if rng.random() < 0.36:
            props["todos"] = {"total": 4, "completed": 2, "inProgress": 1, "pending": 1}
        out[model] = json.dumps(props)[:-1]
    return out, no_model


def completion(prefix: str, model: int, memory: bool, free: bool, timed: bool) -> tuple:
    """(payload, input, output, cache read, cache write, cost, duration ms)."""
    _, _, _, price_in, price_cached, price_out = MODELS[model]
    tin = min(900_000, int(lognormal(75_000, 0.72)))
    tout = min(60_000, int(lognormal(350, 1.68)))
    cread = int(tin * rng.uniform(0.8, 0.99)) if rng.random() < 0.85 else 0
    cwrite = (
        int(tin * rng.uniform(0, 0.1)) if price_in >= 1 and rng.random() < 0.3 else 0
    )
    cost = (
        0.0
        if free
        else (
            (tin - cread) * price_in
            + cread * price_cached
            + tout * price_out
            + cwrite * price_in * 1.25
        )
        / 1e6
    )
    ttft = int(lognormal(1400, 1.2))
    duration = ttft + int(tout * rng.uniform(15, 40)) if timed else 0
    figures = f', "inputTokens": {tin}, "outputTokens": {tout}, "cacheReadTokens": {cread}, "cacheWriteTokens": {cwrite}'
    if memory:
        figures += ', "completionKind": "memory", "usageReported": true'
    else:
        reasoning = int(lognormal(300, 2.0)) if rng.random() < 0.5 else 0
        tools = 1 if rng.random() < 0.8 else rng.randint(2, 4)
        usage = "false" if rng.random() < 0.0005 else "true"
        figures += (
            f', "cost": {cost!r}, "ttftMs": {ttft}, "reasoningChars": {reasoning}, '
            f'"toolCount": {tools}, "completionKind": "task", "usageReported": {usage}'
        )
    if timed:
        figures += f', "durationMs": {duration}'
    return (
        prefix + figures + "}",
        tin,
        tout,
        cread,
        cwrite,
        0.0 if memory else cost,
        duration,
    )


def at(task: BenchTask) -> datetime:
    return task.start + (task.end - task.start) * rng.random()


EVENT_COLUMNS = """
    id user_id organization_id event_type task_id client_kind properties created_at
""".split()
TASK_COLUMNS = """
    id user_id organization_id workspace_path client_kind parent_task_id project_id
    recall_excluded title prompt_excerpt message_count tokens_in tokens_out
    cache_reads cache_writes cost duration_ms first_ts last_ts models q_requests
    q_errors q_retries q_interventions q_completion_replies q_condense q_tools
    q_tool_paths q_distinct_tool_paths q_completed created_at updated_at
""".split()
MESSAGE_COLUMNS = """
    id task_id message_data message_ts created_at tokens_in tokens_out cache_reads
    cache_writes cost duration_ms q_kind tool_path
""".split()
REPORT_COLUMNS = """
    id user_id organization_id task_id category provider model_id mode app_version
    client_kind tool_name summary signature occurred_at created_at payload
""".split()


class Rows:
    """Rows waiting for their COPY, per table."""

    def __init__(self):
        self.tables = {
            "telemetry_events": [],
            "tasks": [],
            "task_relations": [],
            "task_messages": [],
            "error_reports": [],
        }
        self.copied = dict.fromkeys(self.tables, 0)


def emit(task: BenchTask, rows: Rows) -> None:
    """The task's row and everything recorded about it."""
    user = task.user
    events = rows.tables["telemetry_events"]
    prefixes, no_model = completion_prefixes(task)
    timed = task.start >= DURATIONS_SINCE
    free = rng.random() < 0.004
    count = completion_count()
    totals = [0, 0, 0, 0, 0.0, 0]
    used: dict[int, int] = {}
    requests = []
    for when in sorted(at(task) for _ in range(count)):
        model = (
            task.second_model
            if task.second_model is not None and rng.random() < 0.3
            else task.model
        )
        memory = rng.random() < 0.006
        payload, *figures = completion(prefixes[model], model, memory, free, timed)
        events.append(
            (
                short_id("evt_"),
                user.id,
                user.org,
                "LLM Completion",
                task.id,
                task.client,
                payload,
                when,
            )
        )
        for k, value in enumerate(figures):
            totals[k] += value
        if not memory:
            used[model] = used.get(model, 0) + 1
            requests.append((when, figures))

    # Indexing runs beside the task; it belongs to no task.
    rate = EMBEDDINGS_PER_COMPLETION * (1 if user.power else OTHERS_EMBEDDING_FACTOR)
    if count:
        prefix = json.dumps(
            {
                **common_props(task.client, task.start),
                "mode": task.mode,
                "cloudIsAuthenticated": True,
                "apiProvider": "openai-compatible",
                **repository(task),
            }
        )[:-1]
        for _ in range(scattered(count * rate)):
            source, _, median = rng.choices(
                EMBEDDING_SOURCES, [s[1] for s in EMBEDDING_SOURCES]
            )[0]
            tokens = int(lognormal(median, 0.8))
            payload = f'{prefix}, "promptTokens": {tokens}, "totalTokens": {tokens}, "source": "{source}"}}'
            events.append(
                (
                    short_id("evt_"),
                    user.id,
                    user.org,
                    "Embedding Usage",
                    None,
                    task.client,
                    payload,
                    at(task),
                )
            )

    q_errors = 1 + int(rng.expovariate(1 / 1.5)) if rng.random() < 0.13 else 0
    q_retries = 1 + int(rng.expovariate(1 / 2)) if rng.random() < 0.04 else 0
    q_tools = int(len(requests) * rng.uniform(0.8, 1.6))
    q_tool_paths = int(q_tools * rng.uniform(0.2, 0.6))
    q_distinct = (
        int(q_tool_paths * rng.uniform(0.5, 0.95))
        if rng.random() < 0.36
        else q_tool_paths
    )
    if user.power:
        problems(task, requests, q_errors, q_retries, rows)

    # Most-used first, then by name (services/model_attribution.models_label).
    names = sorted(used.items(), key=lambda item: (-item[1], MODELS[item[0]][1]))
    models = (
        None if no_model or not names else ", ".join(MODELS[m][1] for m, _ in names)
    )
    prompt = text(rng.randint(60, 140))
    title = prompt[:100] + ("…" if len(prompt) > 100 else "")
    rows.tables["tasks"].append(
        (
            task.id,
            user.id,
            user.org,
            task.workspace,
            task.client,
            task.parent.id if task.parent else None,
            task.project[0] if task.project else None,
            False,
            title,
            prompt[:1000],
            5 * count + rng.randint(1, 12),
            totals[0],
            totals[1],
            totals[2],
            totals[3],
            totals[4],
            totals[5],
            int(task.start.timestamp() * 1000),
            int(task.end.timestamp() * 1000),
            models,
            len(requests),
            q_errors,
            q_retries,
            1 + int(rng.expovariate(1 / 1.5)) if rng.random() < 0.09 else 0,
            1 + int(rng.expovariate(1.0)) if rng.random() < 0.3 else 0,
            1 if rng.random() < 0.003 else 0,
            q_tools,
            q_tool_paths,
            q_distinct,
            rng.random() < 0.85,
            task.start,
            task.end,
        )
    )
    if task.parent is not None:
        rows.tables["task_relations"].append(
            (task.id, task.parent.id, user.id, task.start)
        )


SIGNATURES = []
for category, weight, tools in REPORT_CATEGORIES:
    for k in range(18):
        tool = tools[k % len(tools)]
        SIGNATURES.append(
            (
                category,
                tool,
                f"{tool or category}: failure number {k} at line 12 of the request",
                weight / 18,
            )
        )
ERROR_TEXTS = [
    (
        "error",
        "error",
        "Error reading file src/{w}.rs: ENOENT: no such file or directory",
    ),
    (
        "error",
        "diff_error",
        "Unable to apply diff to src/{w}.ts: no match found for the search block",
    ),
    (
        "retry",
        "api_req_retry_delayed",
        "Unexpected API Response: The language model did not provide any assistant messages.",
    ),
]


def problems(
    task: BenchTask, requests: list, q_errors: int, q_retries: int, rows: Rows
) -> None:
    """What the power user's problem report reads about the task."""
    user = task.user
    if task.start >= REPORTS_SINCE:
        for _ in range(scattered(REPORTS_PER_TASK)):
            category, tool, signature, _ = rng.choices(
                SIGNATURES, [s[3] for s in SIGNATURES]
            )[0]
            when = at(task)
            summary = signature.replace("12", str(rng.randint(1, 900)))
            payload = json.dumps(
                {
                    "category": category,
                    "summary": summary,
                    "taskId": task.id,
                    "request": text(300),
                    "response": text(150),
                }
            )
            model = MODELS[task.model]
            rows.tables["error_reports"].append(
                (
                    str(uuid.UUID(int=rng.getrandbits(128))),
                    user.id,
                    user.org,
                    task.id,
                    category,
                    model[0],
                    model[1],
                    task.mode,
                    "1.1.2",
                    task.client,
                    tool,
                    summary,
                    signature,
                    when,
                    when + timedelta(seconds=2),
                    payload,
                )
            )
        return

    for _ in range(scattered(ERROR_EVENTS_PER_TASK)):
        event_type = rng.choices(ERROR_EVENTS, ERROR_EVENT_WEIGHTS)[0]
        props = {
            **common_props(task.client, task.start),
            "mode": task.mode,
            "cloudIsAuthenticated": True,
        }
        if event_type == "Code Index Error":
            props["error"] = (
                f"ENOENT: no such file or directory, open '/home/{user.handle}/src/.gitignore'"
            )
            props["stack"] = (
                "Error: ENOENT\n\tat async open (node:internal/fs/promises:1346:25)" * 4
            )
            props["location"] = "_recreateServices"
        else:
            props.update(taskId=task.id, consecutiveMistakeCount=1)
        rows.tables["telemetry_events"].append(
            (
                short_id("evt_"),
                user.id,
                user.org,
                event_type,
                props.get("taskId"),
                task.client,
                json.dumps(props),
                at(task),
            )
        )

    # The conversation's errors and the requests the model of each is read from.
    if not (q_errors or q_retries) or not requests:
        return
    messages = rows.tables["task_messages"]
    seen = set()
    for when, (tin, tout, cread, cwrite, cost, duration) in requests:
        ts = int(when.timestamp() * 1000)
        while ts in seen:
            ts += 1
        seen.add(ts)
        info = {
            "apiProtocol": "openai",
            "tokensIn": tin,
            "tokensOut": tout,
            "cacheWrites": cwrite,
            "cacheReads": cread,
            "cost": cost,
        }
        data = {
            "ts": ts,
            "type": "say",
            "say": "api_req_started",
            "text": json.dumps(info),
        }
        messages.append(
            (
                short_id("msg_"),
                task.id,
                json.dumps(data),
                ts,
                when,
                tin,
                tout,
                cread,
                cwrite,
                cost,
                duration,
                "request",
                None,
            )
        )
    for kind_count, kind in ((q_errors, "error"), (q_retries, "retry")):
        for _ in range(kind_count):
            ts = rng.choice(sorted(seen)) + rng.randint(200, 900)
            while ts in seen:
                ts += 1
            seen.add(ts)
            _, say, template = rng.choice([t for t in ERROR_TEXTS if t[0] == kind])
            data = {
                "ts": ts,
                "type": "say",
                "say": say,
                "text": template.format(w=rng.choice(VOCABULARY)),
            }
            when = datetime.fromtimestamp(ts / 1000, timezone.utc)
            messages.append(
                (
                    short_id("msg_"),
                    task.id,
                    json.dumps(data),
                    ts,
                    when,
                    0,
                    0,
                    0,
                    0,
                    0.0,
                    0,
                    kind,
                    None,
                )
            )


COLUMNS = {
    "telemetry_events": EVENT_COLUMNS,
    "tasks": TASK_COLUMNS,
    "task_relations": ["child_task_id", "parent_task_id", "user_id", "created_at"],
    "task_messages": MESSAGE_COLUMNS,
    "error_reports": REPORT_COLUMNS,
}


async def flush(conn, rows: Rows, everything: bool) -> None:
    for table in (
        "tasks",
        "task_relations",
        "telemetry_events",
        "task_messages",
        "error_reports",
    ):
        pending = rows.tables[table]
        if not pending or (not everything and len(pending) < BATCH):
            continue
        if table == "telemetry_events":
            # In arrival order, as the live heap holds them.
            pending.sort(key=lambda row: row[7])
        await conn.copy_records_to_table(table, records=pending, columns=COLUMNS[table])
        rows.copied[table] += len(pending)
        pending.clear()


async def create_schema() -> None:
    admin = await asyncpg.connect(
        URL.replace("+asyncpg", "").rsplit("/", 1)[0] + "/postgres"
    )
    await admin.execute(f"DROP DATABASE IF EXISTS {DATABASE} WITH (FORCE)")
    await admin.execute(f"CREATE DATABASE {DATABASE}")
    await admin.close()
    engine = create_async_engine(URL)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await engine.dispose()


async def load() -> None:
    started = time.monotonic()
    users = [BenchUser(n) for n in range(USERS)]
    project_rows = make_projects(users)
    tasks: list[BenchTask] = []
    for user, count in zip(users, task_counts(users)):
        user_tasks = make_tasks(user, count)
        for root in user_tasks:
            if root.parent is not None:
                continue
            place(root, NOW - SPAN + (SPAN - timedelta(hours=2)) * rng.random())
            if root.end > NOW:
                shift(root, root.end - NOW + timedelta(minutes=1))
        tasks += user_tasks
    tasks.sort(key=lambda t: t.start)
    for task in tasks:
        task.id = task_uuid(task.start)
    print(
        f"planned {len(tasks)} tasks in {time.monotonic() - started:.0f} s", flush=True
    )

    conn = await asyncpg.connect(URL.replace("+asyncpg", ""))
    # Every row is consistent by construction: no foreign key checks, and
    # the event indexes are built once at the end instead of row by row.
    await conn.execute("SET session_replication_role = replica")
    await conn.execute("SET maintenance_work_mem = '1GB'")
    event_indexes = await conn.fetch(
        "SELECT indexname, indexdef FROM pg_indexes "
        "WHERE tablename = 'telemetry_events' AND indexname <> 'telemetry_events_pkey'"
    )
    for index in event_indexes:
        await conn.execute(f"DROP INDEX {index['indexname']}")

    created = NOW - SPAN - timedelta(days=1)
    await conn.copy_records_to_table(
        "users",
        records=[
            (
                u.id,
                f"ak_{u.n}",
                u.email,
                rng.choice(FIRST_NAMES),
                rng.choice(LAST_NAMES),
                None,
                "{}",
                created,
                created,
            )
            for u in users
        ],
        columns="id authentik_id email first_name last_name image_url public_metadata created_at updated_at".split(),
    )
    await conn.execute(
        "INSERT INTO organizations (id, name, slug, has_image, created_at, updated_at) VALUES ($1, 'Bench Org', 'bench', false, $2, $2)",
        ORG,
        created,
    )
    await conn.copy_records_to_table(
        "memberships",
        records=[
            (
                short_id("mem_"),
                u.id,
                ORG,
                ROLE_ADMIN if u.n < ORG_ADMINS else "org:member",
                "[]",
                created,
                created,
            )
            for u in users
            if u.org
        ],
        columns="id user_id organization_id role permissions created_at updated_at".split(),
    )
    await conn.copy_records_to_table(
        "projects",
        records=project_rows,
        columns="id tenant_id organization_id user_id key name wanted_name recall_scope created_at updated_at".split(),
    )

    rows = Rows()
    for done, task in enumerate(tasks, 1):
        emit(task, rows)
        await flush(conn, rows, everything=False)
        if done % 20_000 == 0:
            events = rows.copied["telemetry_events"]
            took = time.monotonic() - started
            print(f"{done} tasks, {events} events in {took:.0f} s", flush=True)
    await flush(conn, rows, everything=True)
    print(f"loaded in {time.monotonic() - started:.0f} s: {rows.copied}", flush=True)

    for index in event_indexes:
        await conn.execute(index["indexdef"])
    print(f"event indexes built in {time.monotonic() - started:.0f} s", flush=True)
    await conn.execute("VACUUM ANALYZE")
    print(f"vacuumed in {time.monotonic() - started:.0f} s", flush=True)

    for table, size in await conn.fetch(
        "SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) FROM pg_stat_user_tables "
        "ORDER BY pg_total_relation_size(relid) DESC LIMIT 8"
    ):
        print(f"  {table:20} {size}")
    total = await conn.fetchval(
        "SELECT pg_size_pretty(pg_database_size(current_database()))"
    )
    print(f"{DATABASE}: {total}")
    await conn.close()


if __name__ == "__main__":
    started = time.monotonic()
    asyncio.run(create_schema())
    command.stamp(Config("alembic.ini"), "head")
    asyncio.run(load())
    print(f"seeded in {time.monotonic() - started:.0f} s")
