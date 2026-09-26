"""Marketplace service for loading mode/MCP data.

Both lists come from YAML files in ``MARKETPLACE_YAML_DIR``. They are parsed
once per file version, not per request: the parsed items are kept with the
file's modification time and size, and a request that finds either changed
parses the file again. An edited file therefore shows up on the next request
without a restart, while the requests in between cost one ``stat``.
"""

import os
from typing import List, NamedTuple, TypeVar

import yaml
from pydantic import BaseModel

from config.settings import settings
from src.schemas.marketplace import ModeMarketplaceItem, McpMarketplaceItem

Item = TypeVar("Item", bound=BaseModel)


class _Parsed(NamedTuple):
    mtime_ns: int
    size: int
    items: tuple


# Path -> the items parsed from it and the file version they came from.
_cache: dict[str, _Parsed] = {}


def _load_yaml_items(filename: str, model: type[Item]) -> List[Item]:
    """The items in ``MARKETPLACE_YAML_DIR/<filename>``, parsed at most once per version."""
    if settings.marketplace_source != "yaml":
        return []

    path = os.path.join(settings.marketplace_yaml_dir, filename)
    try:
        stat = os.stat(path)
    except FileNotFoundError:
        return []

    cached = _cache.get(path)
    if cached is not None and (cached.mtime_ns, cached.size) == (stat.st_mtime_ns, stat.st_size):
        return list(cached.items)

    with open(path, "r") as f:
        data = yaml.safe_load(f)
    items = tuple(model(**item) for item in data or [])

    _cache[path] = _Parsed(stat.st_mtime_ns, stat.st_size, items)
    # A fresh list per call: a caller that changes it cannot change the cache.
    return list(items)


def load_modes_from_yaml() -> List[ModeMarketplaceItem]:
    """Load mode marketplace items from YAML files."""
    return _load_yaml_items("modes.yaml", ModeMarketplaceItem)


def load_mcps_from_yaml() -> List[McpMarketplaceItem]:
    """Load MCP marketplace items from YAML files."""
    return _load_yaml_items("mcps.yaml", McpMarketplaceItem)
