"""Marketplace service for loading mode/MCP data."""

import os
from typing import List

import yaml

from config.settings import settings
from src.schemas.marketplace import ModeMarketplaceItem, McpMarketplaceItem


def load_modes_from_yaml() -> List[ModeMarketplaceItem]:
    """Load mode marketplace items from YAML files."""
    if settings.marketplace_source != "yaml":
        return []

    yaml_dir = settings.marketplace_yaml_dir
    modes_path = os.path.join(yaml_dir, "modes.yaml")

    if not os.path.exists(modes_path):
        return []

    with open(modes_path, "r") as f:
        data = yaml.safe_load(f)

    if not data:
        return []

    return [ModeMarketplaceItem(**item) for item in data]


def load_mcps_from_yaml() -> List[McpMarketplaceItem]:
    """Load MCP marketplace items from YAML files."""
    if settings.marketplace_source != "yaml":
        return []

    yaml_dir = settings.marketplace_yaml_dir
    mcps_path = os.path.join(yaml_dir, "mcps.yaml")

    if not os.path.exists(mcps_path):
        return []

    with open(mcps_path, "r") as f:
        data = yaml.safe_load(f)

    if not data:
        return []

    return [McpMarketplaceItem(**item) for item in data]
