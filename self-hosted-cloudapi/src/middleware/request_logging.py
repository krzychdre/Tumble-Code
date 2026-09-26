"""Request logging middleware."""

import logging
import time
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger(__name__)


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Log request method, path, and duration."""

    async def dispatch(self, request, call_next):
        start_time = time.time()
        response = await call_next(request)
        duration = time.time() - start_time
        # DEBUG: uvicorn's access log already records every request at INFO;
        # this line adds the duration (LOG_LEVEL=DEBUG shows it).
        logger.debug(
            "%s %s -> %s (%.3fs)", request.method, request.url.path, response.status_code, duration
        )
        return response
