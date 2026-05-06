"""Tests for browser auth flow router - specifically the callback redirect URL format."""

import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from fastapi.testclient import TestClient

from src.main import app


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def mock_auth_flow():
    """Mock all external dependencies for the auth callback flow."""
    with patch("src.routers.browser.exchange_code_for_tokens") as mock_exchange, \
         patch("src.routers.browser.get_userinfo") as mock_userinfo, \
         patch("src.routers.browser.get_oauth_state") as mock_get_state, \
         patch("src.routers.browser.get_or_create_user") as mock_create_user, \
         patch("src.routers.browser.create_session_and_token") as mock_session, \
         patch("src.routers.browser.create_ticket") as mock_ticket:

        mock_get_state.return_value = MagicMock(
            auth_redirect="vscode://RooVeterinaryInc.roo-cline",
            code_verifier="test-code-verifier",
        )
        mock_exchange.return_value = {
            "access_token": "test-access-token",
            "id_token": "test-id-token",
        }
        mock_userinfo.return_value = {
            "sub": "authentik-123",
            "email": "test@example.com",
            "name": "Test User",
            "given_name": "Test",
            "family_name": "User",
            "picture": "https://example.com/photo.jpg",
        }
        mock_create_user.return_value = MagicMock(id="user-123")
        mock_session.return_value = (MagicMock(id="session-123"), "raw-token")
        mock_ticket.return_value = "test-ticket-code"

        yield {
            "exchange": mock_exchange,
            "userinfo": mock_userinfo,
            "get_state": mock_get_state,
            "create_user": mock_create_user,
            "session": mock_session,
            "ticket": mock_ticket,
        }


class TestAuthCallbackRedirect:
    """Test that the auth callback redirects to the correct VS Code URI."""

    def test_callback_redirect_includes_clerk_callback_path(self, client, mock_auth_flow):
        """The redirect URL must include /auth/clerk/callback path for VS Code handleUri() to route correctly."""
        response = client.get(
            "/auth/clerk/callback",
            params={"code": "test-code", "state": "test-state"},
            follow_redirects=False,
        )

        assert response.status_code in (302, 303, 307)
        redirect_url = response.headers["location"]

        assert "/auth/clerk/callback" in redirect_url, (
            f"Redirect URL must include /auth/clerk/callback path for VS Code to handle the callback. "
            f"Got: {redirect_url}"
        )

    def test_callback_redirect_format_vscode_uri(self, client, mock_auth_flow):
        """The redirect URL should be: vscode://publisher.extension/auth/clerk/callback?code=...&state=..."""
        response = client.get(
            "/auth/clerk/callback",
            params={"code": "test-code", "state": "test-state"},
            follow_redirects=False,
        )

        redirect_url = response.headers["location"]

        assert redirect_url.startswith("vscode://RooVeterinaryInc.roo-cline/auth/clerk/callback?"), (
            f"Redirect URL should start with vscode://publisher.name/auth/clerk/callback?. "
            f"Got: {redirect_url}"
        )
        assert "code=test-ticket-code" in redirect_url
        assert "state=test-state" in redirect_url

    def test_callback_redirect_with_org_id(self, client, mock_auth_flow):
        """When org_id is present, it should be included in the redirect URL."""
        response = client.get(
            "/auth/clerk/callback",
            params={"code": "test-code", "state": "test-state"},
            follow_redirects=False,
        )

        redirect_url = response.headers["location"]

        assert "code=" in redirect_url
        assert "state=test-state" in redirect_url
        assert "organizationId=" not in redirect_url

    def test_callback_redirect_uses_query_separator_for_simple_uri(self, client, mock_auth_flow):
        """When auth_redirect has no query string, use '?' as separator."""
        response = client.get(
            "/auth/clerk/callback",
            params={"code": "test-code", "state": "test-state"},
            follow_redirects=False,
        )

        redirect_url = response.headers["location"]

        assert "vscode://RooVeterinaryInc.roo-cline/auth/clerk/callback?code=" in redirect_url, (
            f"Expected '?' separator for simple URI. Got: {redirect_url}"
        )

    def test_callback_invalid_state_returns_error(self, client, mock_auth_flow):
        """When state is invalid (not found in store), should redirect to error page."""
        mock_auth_flow["get_state"].return_value = None

        response = client.get(
            "/auth/clerk/callback",
            params={"code": "test-code", "state": "invalid-state"},
            follow_redirects=False,
        )

        assert response.status_code in (302, 303, 307)
        redirect_url = response.headers["location"]
        assert "invalid_state" in redirect_url or "error" in redirect_url.lower()


class TestSignInPageRedirect:
    """Test that sign-in and sign-up pages store auth_redirect correctly."""

    @patch("src.routers.browser.store_oauth_state", new_callable=AsyncMock)
    @patch("src.routers.browser.generate_pkce_pair")
    @patch("src.routers.browser.get_authorize_url")
    def test_sign_in_stores_auth_redirect(
        self, mock_get_authorize, mock_pkce, mock_store, client
    ):
        """Sign-in page should store the auth_redirect parameter for later use in callback."""
        mock_pkce.return_value = ("verifier", "challenge")
        mock_get_authorize.return_value = "https://auth.example.com/authorize?params"
        mock_store.return_value = AsyncMock()

        response = client.get(
            "/extension/sign-in",
            params={"state": "test-state", "auth_redirect": "vscode://RooVeterinaryInc.roo-cline"},
            follow_redirects=False,
        )

        mock_store.assert_called_once()
        call_args = mock_store.call_args
        assert call_args[0][1] == "test-state"
        assert call_args[0][2] == "vscode://RooVeterinaryInc.roo-cline"
        assert call_args[0][3] == "verifier"

    @patch("src.routers.browser.store_oauth_state", new_callable=AsyncMock)
    @patch("src.routers.browser.generate_pkce_pair")
    @patch("src.routers.browser.get_authorize_url")
    def test_provider_sign_up_stores_auth_redirect(
        self, mock_get_authorize, mock_pkce, mock_store, client
    ):
        """Provider sign-up page should store the auth_redirect parameter for later use in callback."""
        mock_pkce.return_value = ("verifier", "challenge")
        mock_get_authorize.return_value = "https://auth.example.com/authorize?params"
        mock_store.return_value = AsyncMock()

        response = client.get(
            "/extension/provider-sign-up",
            params={"state": "test-state", "auth_redirect": "vscode://RooVeterinaryInc.roo-cline"},
            follow_redirects=False,
        )

        mock_store.assert_called_once()
        call_args = mock_store.call_args
        assert call_args[0][2] == "vscode://RooVeterinaryInc.roo-cline"
