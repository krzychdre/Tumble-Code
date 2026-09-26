"""Which clients may open the web panel.

The panel is served on every interface, so any machine that can reach the port
can load it. ``WEB_ALLOWED_NETWORKS`` narrows that to the networks listed; left
empty, nothing changes and every client is allowed, as before.

What an allowlist has to let through besides the listed networks
-----------------------------------------------------------------
* **Loopback**, always: a browser on the machine running uvicorn directly.
* **The container's default gateway**, when running in a container. Docker
  publishes a port through ``docker-proxy``, so a browser on the host opening
  ``localhost:8085`` reaches the container from the bridge gateway (measured on
  the bundled compose stack: ``192.168.0.1``), not from 127.0.0.1. Leaving the
  gateway out would lock the host's own browser out of its own panel the moment
  a LAN range is added. Traffic from other machines keeps its real source
  address through Docker's DNAT, so it is still checked against the list.

  The flip side: where every connection is proxied (rootless Docker, or a
  userland proxy for all traffic), every client appears as the gateway and the
  list cannot tell them apart. The startup log names what is allowed so that is
  visible.

What is gated
-------------
Everything under ``/app`` (the panel, its login and logout) answers 403 to a
client outside the list. The session cookie is also ignored for such a client
(``get_web_user_optional``) and refused on the live bridge, so a cookie obtained
on an allowed network does not keep working from elsewhere. Public share links
(``/shared/<id>``) stay public: they are meant for people outside, and a
private share needs a sign-in, which is gated. The extension's API is not the
panel and is not gated.

The client address is the TCP peer, or the ``X-Forwarded-For`` value when
uvicorn trusts the proxy that sent it (``FORWARDED_ALLOW_IPS``, 127.0.0.1 by
default). A client cannot choose its own address by sending the header.
"""

from __future__ import annotations

import ipaddress
import logging
import socket
import struct
from functools import lru_cache
from pathlib import Path
from typing import Optional, Union

from starlette.requests import Request
from starlette.types import ASGIApp, Receive, Scope, Send

from config.settings import settings
from src.web.templating import templates

logger = logging.getLogger(__name__)

IPNetwork = Union[ipaddress.IPv4Network, ipaddress.IPv6Network]

_CONTAINER_MARKERS = (Path("/.dockerenv"), Path("/run/.containerenv"))
_ROUTE_TABLE = Path("/proc/net/route")


def parse_networks(raw: str) -> list[IPNetwork]:
    """The comma-separated list as networks; a bare address is a /32 (or /128)."""
    return [
        ipaddress.ip_network(entry.strip(), strict=False)
        for entry in raw.split(",")
        if entry.strip()
    ]


@lru_cache(maxsize=1)
def container_gateway() -> Optional[str]:
    """The default gateway when running in a container, else None.

    Read from the kernel's routing table rather than guessed from the network
    name: the compose network's subnet is whatever Docker assigned it.
    """
    if not any(marker.exists() for marker in _CONTAINER_MARKERS):
        return None
    try:
        lines = _ROUTE_TABLE.read_text().splitlines()[1:]
    except OSError:
        return None
    for line in lines:
        fields = line.split()
        # Iface Destination Gateway ...; the default route has destination 0.
        if len(fields) > 2 and fields[1] == "00000000":
            return socket.inet_ntoa(struct.pack("<L", int(fields[2], 16)))
    return None


def _allowed_networks() -> Optional[list[IPNetwork]]:
    """The effective allowlist, or None when the panel is open to everybody."""
    listed = parse_networks(settings.web_allowed_networks)
    if not listed:
        return None
    gateway = container_gateway()
    if gateway:
        listed.append(ipaddress.ip_network(gateway))
    return listed


def client_allowed(host: Optional[str]) -> bool:
    """May a client at ``host`` open the web panel?"""
    networks = _allowed_networks()
    if networks is None:
        return True
    try:
        address = ipaddress.ip_address(host or "")
    except ValueError:
        # Not an address at all (a unix socket, a test client's placeholder
        # name): nothing to match against a list of networks.
        return False
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
        address = address.ipv4_mapped
    if address.is_loopback:
        return True
    return any(address in network for network in networks)


def scope_client(scope: Scope) -> Optional[str]:
    """The client address of an ASGI connection, or None."""
    client = scope.get("client")
    return client[0] if client else None


def describe_policy() -> str:
    """One line for the startup log: who can open the panel."""
    listed = parse_networks(settings.web_allowed_networks)
    if not listed:
        return "any client (WEB_ALLOWED_NETWORKS is empty)"
    parts = ["loopback"]
    gateway = container_gateway()
    if gateway:
        parts.append(f"{gateway} (container gateway, i.e. this host)")
    parts.extend(str(network) for network in listed)
    return ", ".join(parts)


def _is_panel_path(path: str) -> bool:
    return path == "/app" or path.startswith("/app/")


class WebAccessMiddleware:
    """Answer 403 on the panel's paths to a client outside the allowlist.

    Plain ASGI rather than ``BaseHTTPMiddleware``: it only has to look at the
    scope and either pass the connection through untouched or answer it.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not _is_panel_path(scope.get("path", "")):
            await self.app(scope, receive, send)
            return
        client = scope_client(scope)
        if client_allowed(client):
            await self.app(scope, receive, send)
            return

        logger.warning("[web-access] refused %s %s from %s", scope.get("method"), scope["path"], client)
        response = templates.TemplateResponse(
            Request(scope),
            "forbidden.html",
            {"user": None, "client": client or "this address", "hide_sign_in": True},
            status_code=403,
        )
        await response(scope, receive, send)
