"""The canonical conversation as OpenAI chat messages (the dataset's format).

Mirrors src/api/transform/openai-format.ts ``convertToOpenAiMessages``: a
user message's tool_result blocks become ``tool`` messages placed before its
own text; an assistant message's tool_use blocks become ``tool_calls`` with
the input serialized like JSON.stringify. Differences, for a training file:

* text parts are joined into one string ("\\n\\n" between parts; chat templates
  differ on lists, every one takes a string);
* images are replaced by ``[image]`` (an image cannot be anonymized);
* reasoning (an assistant ``reasoning``/``thinking`` block) goes to
  ``reasoning_content`` when asked for, the field DeepSeek, Qwen and GLM
  templates read; encrypted reasoning and standalone reasoning items are
  dropped.
"""

from __future__ import annotations

import json
from typing import Any, Callable, Optional

IMAGE_PLACEHOLDER = "[image]"

Text = Callable[[str], str]
Args = Callable[[str], str]


def _identity(value: str) -> str:
    return value


def _tool_result_text(block: dict) -> str:
    content = block.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for part in content:
            if not isinstance(part, dict):
                continue
            if part.get("type") == "text":
                parts.append(part.get("text") or "")
            elif part.get("type") == "image":
                parts.append(IMAGE_PLACEHOLDER)
        return "\n".join(parts)
    return ""


def convert_message(
    message: Any, *, reasoning: bool, text: Text = _identity, args: Args = _identity
) -> list[dict]:
    """One canonical message as OpenAI messages (none, one, or a tool message per result)."""
    if not isinstance(message, dict) or message.get("role") not in ("user", "assistant"):
        return []
    role = message["role"]
    content = message.get("content")
    if isinstance(content, str):
        return [{"role": role, "content": text(content)}]
    if not isinstance(content, list):
        return []

    if role == "user":
        out: list[dict] = []
        parts: list[str] = []
        for block in content:
            if not isinstance(block, dict):
                continue
            kind = block.get("type")
            if kind == "tool_result":
                out.append({
                    "role": "tool",
                    "tool_call_id": str(block.get("tool_use_id") or ""),
                    "content": text(_tool_result_text(block)) or "(empty)",
                })
            elif kind == "text" and block.get("text"):
                parts.append(text(block["text"]))
            elif kind == "image":
                parts.append(IMAGE_PLACEHOLDER)
        if parts:
            out.append({"role": "user", "content": "\n\n".join(parts)})
        return out

    texts: list[str] = []
    thoughts: list[str] = []
    calls: list[dict] = []
    for block in content:
        if not isinstance(block, dict):
            continue
        kind = block.get("type")
        if kind == "text" and isinstance(block.get("text"), str):
            texts.append(text(block["text"]))
        elif kind in ("reasoning", "thinking"):
            thought = block.get("text") if isinstance(block.get("text"), str) else block.get("thinking")
            if isinstance(thought, str) and thought:
                thoughts.append(text(thought))
        elif kind == "tool_use":
            raw = json.dumps(block.get("input") or {}, ensure_ascii=False, separators=(",", ":"))
            calls.append({
                "id": str(block.get("id") or ""),
                "type": "function",
                "function": {"name": str(block.get("name") or ""), "arguments": args(raw)},
            })
    return [assistant_message("\n".join(texts), "\n".join(thoughts) if reasoning else None, calls)]


def assistant_message(content: str, reasoning: Optional[str], calls: list[dict]) -> dict:
    message: dict = {"role": "assistant", "content": content}
    if reasoning:
        message["reasoning_content"] = reasoning
    if calls:
        message["tool_calls"] = calls
    return message


def response_message(response: dict, *, reasoning: bool, text: Text = _identity, args: Args = _identity) -> dict:
    """An exchange's answer exactly as the model produced it (raw tool arguments)."""
    calls = [
        {
            "id": str(call.get("id") or ""),
            "type": "function",
            "function": {"name": str(call.get("name") or ""), "arguments": args(call.get("arguments") or "")},
        }
        for call in response.get("toolCalls") or []
        if isinstance(call, dict)
    ]
    thought = response.get("reasoning") if reasoning else None
    return assistant_message(
        text(response.get("text") or ""), text(thought) if isinstance(thought, str) and thought else None, calls
    )
