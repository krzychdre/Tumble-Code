"""Marketplace router.

Implements endpoints:
- GET /api/marketplace/modes
- GET /api/marketplace/mcps
"""

from fastapi import APIRouter

from src.schemas.marketplace import MarketplaceModesResponse, MarketplaceMcpsResponse
from src.services.marketplace_service import load_modes_from_yaml, load_mcps_from_yaml

router = APIRouter(prefix="/api/marketplace", tags=["marketplace"])


@router.get("/modes")
async def get_modes() -> MarketplaceModesResponse:
    """Fetch mode marketplace items. Unauthenticated."""
    modes = load_modes_from_yaml()
    return MarketplaceModesResponse(modes=modes)


@router.get("/mcps")
async def get_mcps() -> MarketplaceMcpsResponse:
    """Fetch MCP marketplace items. Unauthenticated."""
    mcps = load_mcps_from_yaml()
    return MarketplaceMcpsResponse(mcps=mcps)
