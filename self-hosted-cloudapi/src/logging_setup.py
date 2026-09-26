"""Configure stdlib logging once for the whole service."""

import logging

_FORMAT = "%(asctime)s %(levelname)s %(name)s: %(message)s"
_HANDLER_NAME = "cloudapi"


def configure_logging(level: str) -> None:
    """Set the root logger's level and give it the service's stream handler.

    Idempotent: a second call only changes the level. Uvicorn configures its
    own loggers (uvicorn, uvicorn.access) and leaves the root alone, so the
    service's modules log through this handler.
    """
    root = logging.getLogger()
    root.setLevel(level)
    if not any(handler.name == _HANDLER_NAME for handler in root.handlers):
        handler = logging.StreamHandler()
        handler.set_name(_HANDLER_NAME)
        handler.setFormatter(logging.Formatter(_FORMAT))
        root.addHandler(handler)
