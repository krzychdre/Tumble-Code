#!/usr/bin/env python3
"""Collect agent-loop efficiency metrics from Roo/Tumble Code task storage.

Usage:
    python3 scripts/agent-bench/collect.py <taskId> [<taskId> ...]
    python3 scripts/agent-bench/collect.py --recent 5

Reads api_conversation_history.json + ui_messages.json + history_item.json for
each task and prints a per-task markdown table plus aggregate row. See
scripts/agent-bench/README.md for the benchmark protocol.
"""

import argparse
import glob
import json
import os
import re
import statistics
import sys

STORAGE_CANDIDATES = [
    "~/.config/Code/User/globalStorage/qub-it.tumble-code/tasks",
    "~/.config/Code/User/globalStorage/rooveterinaryinc.roo-cline/tasks",
]

ENV_RE = re.compile(r"<environment_details>.*?</environment_details>", re.S)


def storage_dir():
    for c in STORAGE_CANDIDATES:
        p = os.path.expanduser(c)
        if os.path.isdir(p):
            return p
    sys.exit("no task storage directory found")


def load(path):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def block_texts(content):
    """Yield text payloads from a message content list."""
    if isinstance(content, str):
        yield content
        return
    if not isinstance(content, list):
        return
    for b in content:
        if not isinstance(b, dict):
            continue
        if b.get("type") == "text":
            yield b.get("text", "")
        elif b.get("type") == "tool_result":
            inner = b.get("content")
            if isinstance(inner, str):
                yield inner
            elif isinstance(inner, list):
                for x in inner:
                    if isinstance(x, dict) and x.get("type") == "text":
                        yield x.get("text", "")


def analyze(task_dir):
    api = load(os.path.join(task_dir, "api_conversation_history.json"))
    ui = load(os.path.join(task_dir, "ui_messages.json"))
    hist = load(os.path.join(task_dir, "history_item.json")) or {}
    if not api or not ui:
        return None

    m = {
        "id": os.path.basename(task_dir),
        "config": hist.get("apiConfigName", "?"),
        "tokensIn": hist.get("tokensIn", 0),
        "tokensOut": hist.get("tokensOut", 0),
        "cacheReads": hist.get("cacheReads", 0),
        "cost": hist.get("totalCost", 0.0),
        "turns": 0,
        "tool_calls": 0,
        "tool_turns": 0,
        "multi_tool_turns": 0,
        "env_bytes": 0,
        "reasoning_chars": 0,
        "text_chars": 0,
    }

    for msg in api:
        content = msg.get("content")
        if msg.get("role") == "assistant":
            m["turns"] += 1
            tools = [
                b
                for b in (content if isinstance(content, list) else [])
                if isinstance(b, dict) and b.get("type") in ("tool_use", "mcp_tool_use")
            ]
            m["tool_calls"] += len(tools)
            if tools:
                m["tool_turns"] += 1
            if len(tools) >= 2:
                m["multi_tool_turns"] += 1
            for t in block_texts(content):
                m["text_chars"] += len(t)
        else:
            for t in block_texts(content):
                for env in ENV_RE.finditer(t):
                    m["env_bytes"] += len(env.group(0))

    reqs = [u for u in ui if u.get("say") == "api_req_started"]
    ttfts, decodes = [], []
    for i, u in enumerate(ui):
        if u.get("say") == "reasoning":
            m["reasoning_chars"] += len(u.get("text", ""))
        if u.get("say") != "api_req_started":
            continue
        first = last = None
        for n in ui[i + 1 :]:
            if n.get("say") == "api_req_started":
                break
            if n.get("say") in ("reasoning", "text") or n.get("type") == "ask":
                if first is None:
                    first = n["ts"]
                last = n["ts"]
        if first is not None:
            ttft = (first - u["ts"]) / 1000
            if 0 <= ttft < 300:
                ttfts.append(ttft)
            decode = (last - first) / 1000
            if 0 <= decode < 600:
                decodes.append(decode)

    wall = (ui[-1]["ts"] - ui[0]["ts"]) / 1000 if len(ui) >= 2 else 0
    m["ttft_med"] = statistics.median(ttfts) if ttfts else 0
    m["decode_mean"] = statistics.mean(decodes) if decodes else 0
    m["wall_s"] = wall
    m["req_count"] = len(reqs)
    return m


def fmt_row(m):
    turns = max(m["turns"], 1)
    tool_turns = max(m["tool_turns"], 1)
    return (
        f"| {m['id'][-8:]} | {m['config']} | {m['turns']} | {m['tool_calls']} "
        f"| {m['tool_calls'] / tool_turns:.2f} | {100 * m['multi_tool_turns'] / tool_turns:.0f}% "
        f"| {m['tokensIn'] // turns:,} | {m['tokensOut'] // turns:,} | {m['cacheReads']:,} "
        f"| {m['reasoning_chars'] // turns:,} | {m['ttft_med']:.1f} | {m['decode_mean']:.1f} "
        f"| {m['wall_s']:.0f} | {m['env_bytes'] // 1024} |"
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("task_ids", nargs="*")
    ap.add_argument("--recent", type=int, default=0, help="analyze N most recent tasks")
    args = ap.parse_args()

    base = storage_dir()
    if args.recent:
        dirs = sorted(
            (d for d in glob.glob(os.path.join(base, "*")) if os.path.isdir(d)),
            key=os.path.getmtime,
            reverse=True,
        )[: args.recent]
    else:
        if not args.task_ids:
            ap.error("pass task ids or --recent N")
        dirs = [os.path.join(base, t) for t in args.task_ids]

    header = (
        "| task | config | turns | tools | tools/turn | multi% | in/turn | out/turn "
        "| cacheReads | reason/turn | ttft_med_s | decode_mean_s | wall_s | env_KiB |"
    )
    sep = "|" + "---|" * 14
    print(header)
    print(sep)
    rows = []
    for d in dirs:
        m = analyze(d)
        if m is None:
            print(f"| {os.path.basename(d)[-8:]} | (unreadable) |" + " |" * 12, file=sys.stderr)
            continue
        rows.append(m)
        print(fmt_row(m))

    if len(rows) > 1:
        agg = {
            "id": "TOTAL",
            "config": "-",
            "turns": sum(r["turns"] for r in rows),
            "tool_calls": sum(r["tool_calls"] for r in rows),
            "tool_turns": sum(r["tool_turns"] for r in rows),
            "multi_tool_turns": sum(r["multi_tool_turns"] for r in rows),
            "tokensIn": sum(r["tokensIn"] for r in rows),
            "tokensOut": sum(r["tokensOut"] for r in rows),
            "cacheReads": sum(r["cacheReads"] for r in rows),
            "reasoning_chars": sum(r["reasoning_chars"] for r in rows),
            "ttft_med": statistics.median([r["ttft_med"] for r in rows]),
            "decode_mean": statistics.mean([r["decode_mean"] for r in rows]),
            "wall_s": sum(r["wall_s"] for r in rows),
            "env_bytes": sum(r["env_bytes"] for r in rows),
        }
        print(fmt_row(agg))


if __name__ == "__main__":
    main()
