"""The OpenAI-compatible LLM proxy is gone (DEF-S5, owner decision 8).

The proxy forwarded /v1/models, /v1/chat/completions and
/v1/images/generations to upstream providers with the server's own API keys
and accepted anonymous callers, so anyone who could reach the API could spend
the owner's provider credit. Nothing in the extension, the CLI or the web
panel calls these paths any more (the Roo cloud provider was removed from the
fork), so the endpoints were removed instead of being put behind a login.

These tests pin the removal: the paths must not answer, with or without a
body, so a later merge cannot quietly bring the proxy back.
"""

import pytest

from config.settings import settings


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/v1/models"),
        ("POST", "/v1/chat/completions"),
        ("POST", "/v1/images/generations"),
    ],
)
def test_former_proxy_paths_return_404(client, method, path):
    body = {"model": "openai/gpt-4o", "messages": [{"role": "user", "content": "hi"}], "prompt": "a cat"}
    response = client.request(method, path, json=body if method == "POST" else None)
    assert response.status_code == 404


def test_streaming_chat_completion_is_not_served(client):
    response = client.post(
        "/v1/chat/completions",
        json={"model": "openai/gpt-4o", "messages": [{"role": "user", "content": "hi"}], "stream": True},
    )
    assert response.status_code == 404
    assert "text/event-stream" not in response.headers.get("content-type", "")


@pytest.mark.parametrize(
    "name",
    ["default_llm_provider", "openai_api_key", "anthropic_api_key", "google_api_key", "xai_api_key"],
)
def test_proxy_only_settings_are_gone(name):
    # Settings uses extra="ignore", so a leftover OPENAI_API_KEY in an old .env
    # is simply ignored instead of breaking startup, but the field must not exist.
    assert not hasattr(settings, name)
