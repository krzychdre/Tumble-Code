"""Grouping occurrences by signature and the page's figures.

``aggregate_problems`` is the pure core: occurrences in, the page's numbers
out, no database. A group is one closed row of the list (its view is built
here from ``problems/views``); the model fit table puts problems next to the
period's LLM Completion requests per model.

The classes in the order the page lists their totals, and each group's rule
(catalogue, ``services/problem_catalogue``), are decided by its latest
occurrence over the whole period before any filter, so a filter never changes
which class a problem is in.
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime
from typing import Optional, Sequence

from src.services.metrics_service import PERIOD_LABELS
from src.services.problem_catalogue import (
    CLASS_KEYS,
    UNCLASSIFIED,
    Rule,
    classify,
)
from src.services.problems.base import (
    CLASS_ORDER,
    MAX_GROUPS,
    NOT_MODEL_CATEGORIES,
    SOURCE_LABELS,
    UNKNOWN_MODEL,
    Occurrence,
    fmt_when,
)
from src.services.problems.filters import (
    SORT_COUNT,
    SORT_IMPACT,
    SORT_RECENT,
    ProblemFilter,
)
from src.services.problems.views import _group_view, group_key

_SORTS = {
    SORT_IMPACT: lambda g: (-g["reach"], -g["count"], -g["last_ts"], g["signature"]),
    SORT_COUNT: lambda g: (-g["count"], -g["reach"], -g["last_ts"], g["signature"]),
    SORT_RECENT: lambda g: (-g["last_ts"], -g["reach"], -g["count"], g["signature"]),
}


def rules_by_signature(occurrences: Sequence[Occurrence]) -> dict[str, Rule]:
    """Each signature's catalogue rule, decided by its latest occurrence.

    Computed over the whole period before any filter, so a filter never
    changes which class a problem is in.
    """
    latest: dict[str, Occurrence] = {}
    for o in occurrences:
        if o.signature not in latest or o.when > latest[o.signature].when:
            latest[o.signature] = o
    return {sig: classify(o.category, o.tool, o.text) for sig, o in latest.items()}


def group_occurrences(
    occurrences: Sequence[Occurrence], rules: Optional[dict[str, Rule]] = None, sort: str = SORT_IMPACT
) -> list[dict]:
    """Groups by signature, the most far-reaching first.

    Ranked by reach (see ``_group_view``), then by count, then by how recently
    the problem was last seen; ``sort`` puts count or recency first instead.
    ``rules`` fixes each signature's rule (see ``rules_by_signature``); without
    it the group's latest occurrence decides.
    """
    by_signature: dict[str, list[Occurrence]] = {}
    for occurrence in occurrences:
        by_signature.setdefault(occurrence.signature, []).append(occurrence)
    groups = [
        _group_view(signature, members, (rules or {}).get(signature)) for signature, members in by_signature.items()
    ]
    groups.sort(key=_SORTS.get(sort, _SORTS[SORT_IMPACT]))
    return groups


def model_fit(occurrences: Sequence[Occurrence], groups: Sequence[dict], requests: Counter) -> list[dict]:
    """Per provider and model: requests, problems, problems per 100 requests.

    ``requests`` counts the period's LLM Completion events by
    ``(provider, model)``. A model with many problems per request on one kind
    of problem (a tool call without its parameters) is a model that does not
    fit the protocol; the same problem spread evenly over every model is ours.
    """
    class_of = {g["signature"]: g["classification"] for g in groups}
    rows: dict[tuple[str, str], dict] = {}

    def slot(provider: str, model: str) -> dict:
        return rows.setdefault(
            (provider, model),
            {"provider": provider, "model": model, "requests": 0, "problems": 0,
             "categories": Counter(), "classes": Counter()},
        )

    for (provider, model), count in requests.items():
        slot(provider, model)["requests"] += count
    for o in occurrences:
        if o.category in NOT_MODEL_CATEGORIES:
            continue
        row = slot(o.provider or "", o.model or UNKNOWN_MODEL)
        row["problems"] += 1
        row["categories"][o.category] += 1
        row["classes"][class_of.get(o.signature, UNCLASSIFIED)] += 1

    # A problem without a provider is attributed to the model alone; when that
    # model ran under exactly one provider in the period, fold it in there.
    providers_of: dict[str, list[str]] = {}
    for provider, model in rows:
        if provider:
            providers_of.setdefault(model, []).append(provider)
    for (provider, model) in list(rows):
        if provider or len(providers_of.get(model, [])) != 1:
            continue
        lone = rows.pop((provider, model))
        target = rows[(providers_of[model][0], model)]
        target["requests"] += lone["requests"]
        target["problems"] += lone["problems"]
        target["categories"].update(lone["categories"])
        target["classes"].update(lone["classes"])

    out = []
    for row in rows.values():
        if not row["problems"] and not row["requests"]:
            continue
        top_category = row["categories"].most_common(1)
        top_class = row["classes"].most_common(1)
        out.append(
            {
                "provider": row["provider"],
                "model": row["model"],
                "requests": row["requests"],
                "problems": row["problems"],
                "per_100": round(row["problems"] * 100.0 / row["requests"], 1) if row["requests"] else None,
                "top_category": top_category[0][0] if top_category else "",
                "top_category_count": top_category[0][1] if top_category else 0,
                "top_class": top_class[0][0] if top_class else "",
            }
        )
    out.sort(key=lambda r: (-r["problems"], -(r["per_100"] or 0), -r["requests"], r["model"]))
    return out


def _options(occurrences: Sequence[Occurrence], rules: dict[str, Rule]) -> dict[str, list[dict]]:
    """What each filter can be set to in the period, with how many occurrences.

    From the unfiltered period, so every choice stays visible after one is
    made; the most frequent first, classes and sources in their fixed order.
    """
    counters = {name: Counter() for name in ("category", "model", "provider", "tool")}
    classes: Counter = Counter()
    sources: Counter = Counter()
    for o in occurrences:
        counters["category"][o.category] += 1
        counters["model"][o.model or UNKNOWN_MODEL] += 1
        if o.provider:
            counters["provider"][o.provider] += 1
        if o.tool:
            counters["tool"][o.tool] += 1
        classes[CLASS_KEYS[rules[o.signature].classification]] += 1
        sources[o.source] += 1
    options = {
        name: [{"value": v, "label": v, "count": n} for v, n in sorted(c.items(), key=lambda kv: (-kv[1], kv[0]))]
        for name, c in counters.items()
    }
    options["class"] = [
        {"value": CLASS_KEYS[name], "label": name, "count": classes.get(CLASS_KEYS[name], 0)}
        for name in CLASS_ORDER
        if classes.get(CLASS_KEYS[name])
    ]
    options["source"] = [
        {"value": key, "label": label, "count": sources[key]} for key, label in SOURCE_LABELS.items() if sources.get(key)
    ]
    return options


def aggregate_problems(
    occurrences: Sequence[Occurrence],
    requests: Counter,
    period: str,
    legacy_until: Optional[datetime],
    filters: Optional[ProblemFilter] = None,
    key: Optional[str] = None,
) -> dict:
    """The page's figures from the occurrences; pure, no database.

    With ``filters`` the totals, the groups and the model fit count only the
    matching occurrences. The class tiles count everything the other filters
    let through, so each tile says what clicking it would show. The model
    fit's request counts are the period's, narrowed only by a model or
    provider filter (a request has no category or tool). ``key`` keeps the
    one group with that ``group_key`` (a group's own brief).
    """
    filters = filters or ProblemFilter(period=period)
    rules = rules_by_signature(occurrences)
    unclassed = [o for o in occurrences if filters.matches(o, rules[o.signature], ignore_class=True)]
    if key is not None:
        unclassed = [o for o in unclassed if group_key(o.signature) == key]
    selected = [o for o in unclassed if filters.matches(o, rules[o.signature])]
    groups = group_occurrences(selected, rules, filters.sort)
    by_class = Counter()
    for o in unclassed:
        by_class[rules[o.signature].classification] += 1
    if filters.model or filters.provider:
        requests = Counter(
            {
                (provider, model): count
                for (provider, model), count in requests.items()
                if (not filters.model or model == filters.model) and (not filters.provider or provider == filters.provider)
            }
        )
    return {
        "period": period,
        "period_label": PERIOD_LABELS.get(period, period),
        "has_data": bool(occurrences),
        "period_total": len(occurrences),
        "filtered": filters.active,
        "total": len(selected),
        "tasks": len({o.task_id for o in selected if o.task_id}),
        "by_class": [
            {"name": name, "key": CLASS_KEYS[name], "count": by_class.get(name, 0)} for name in CLASS_ORDER
        ],
        "groups": groups[:MAX_GROUPS],
        "hidden_groups": max(0, len(groups) - MAX_GROUPS),
        "model_fit": model_fit(selected, groups, requests),
        "sources": dict(Counter(o.source for o in selected)),
        "legacy_until": fmt_when(legacy_until) if legacy_until else None,
        "options": _options(occurrences, rules),
        "sort": filters.sort,
    }
