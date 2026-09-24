"""CORS middleware configuration.

The allowed origins are the trusted origins of src/auth/origins.py, looked up
on every request (DEF-S8). Starlette's own ``allow_origins`` list is left empty
on purpose: with ``"*"`` and credentials it echoes whatever ``Origin`` a request
carries, which let any page read the panel's answers with the reader's cookie.
"""

from fastapi.middleware.cors import CORSMiddleware

from src.auth.origins import is_trusted_origin


class TrustedOriginsCORSMiddleware(CORSMiddleware):
    """CORSMiddleware that grants exactly the configured trusted origins.

    Same-origin requests need no CORS grant, so the request's own ``Host`` is
    deliberately not consulted here.
    """

    def is_allowed_origin(self, origin: str) -> bool:
        return is_trusted_origin(origin)


def setup_cors(app):
    """Configure CORS middleware."""
    app.add_middleware(
        TrustedOriginsCORSMiddleware,
        allow_origins=[],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
