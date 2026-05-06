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
    """Test that the auth callback returns HTML with the correct VS Code URI."""

    def test_callback_html_includes_clerk_callback_path(self, client, mock_auth_flow):
        """The HTML response must include /auth/clerk/callback path for VS Code handleUri() to route correctly."""
        response = client.get(
            "/auth/clerk/callback",
            params={"code": "test-code", "state": "test-state"},
        )

        assert response.status_code == 200
        body = response.text

        assert "/auth/clerk/callback" in body, (
            f"HTML response must include /auth/clerk/callback path for VS Code to handle the callback. "
            f"Got: {body[:200]}"
        )

    def test_callback_html_contains_vscode_uri(self, client, mock_auth_flow):
        """The HTML response should contain the vscode:// URI with code and state params."""
        response = client.get(
            "/auth/clerk/callback",
            params={"code": "test-code", "state": "test-state"},
        )

        assert response.status_code == 200
        body = response.text

        assert "vscode://RooVeterinaryInc.roo-cline/auth/clerk/callback?" in body, (
            f"HTML response should contain vscode://publisher.name/auth/clerk/callback?. "
            f"Got: {body[:200]}"
        )
        # URL-encoded params: urllib.parse.urlencode uses + for spaces and %XX for special chars
        assert "code=test-ticket-code" in body or "code=test-ticket-code" in body
        assert "state=test-state" in body

    def test_callback_html_no_org_id_when_absent(self, client, mock_auth_flow):
        """When org_id is absent, it should NOT appear in the VS Code URI."""
        response = client.get(
            "/auth/clerk/callback",
            params={"code": "test-code", "state": "test-state"},
        )

        assert response.status_code == 200
        body = response.text

        assert "code=" in body
        assert "state=test-state" in body
        assert "organizationId=" not in body

    def test_callback_html_uses_query_separator_for_simple_uri(self, client, mock_auth_flow):
        """When auth_redirect has no query string, use '?' as separator in the vscode URI."""
        response = client.get(
            "/auth/clerk/callback",
            params={"code": "test-code", "state": "test-state"},
        )

        assert response.status_code == 200
        body = response.text

        assert "vscode://RooVeterinaryInc.roo-cline/auth/clerk/callback?code=" in body, (
            f"Expected '?' separator for simple URI in HTML. Got: {body[:200]}"
        )

    def test_callback_html_is_success_page(self, client, mock_auth_flow):
        """The HTML response should be a success page with JavaScript redirect."""
        response = client.get(
            "/auth/clerk/callback",
            params={"code": "test-code", "state": "test-state"},
        )

        assert response.status_code == 200
        body = response.text
        assert "Authentication Successful" in body
        assert "window.location.assign" in body

    def test_callback_invalid_state_returns_error_html(self, client, mock_auth_flow):
        """When state is invalid (not found in store), should return an error HTML page."""
        mock_auth_flow["get_state"].return_value = None

        response = client.get(
            "/auth/clerk/callback",
            params={"code": "test-code", "state": "invalid-state"},
        )

        assert response.status_code == 400
        body = response.text
        assert "Authentication Failed" in body or "Invalid or expired" in body


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
