"""Rate limiting middleware."""

from slowapi import Limiter
from slowapi.util import get_remote_address
from config.settings import settings


limiter = None

if settings.rate_limit_enabled:
    limiter = Limiter(
        key_func=get_remote_address,
        default_limits=[f"{settings.rate_limit_requests_per_minute}/minute"],
    )
