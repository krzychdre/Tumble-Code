"""Tests for JWT issuance and validation."""

import pytest
from src.auth.jwt_issuer import issue_session_token, decode_token


def test_issue_session_token_basic():
    """Test that a session token is issued with correct claims."""
    token = issue_session_token(user_id="user_123", org_id="org_456")
    payload = decode_token(token)

    assert payload is not None
    assert payload["iss"] == "rcc"
    assert payload["sub"] == "user_123"
    assert payload["v"] == 1
    assert payload["r"]["u"] == "user_123"
    assert payload["r"]["o"] == "org_456"
    assert payload["r"]["t"] == "auth"
    assert "exp" in payload
    assert "iat" in payload


def test_issue_session_token_no_org():
    """Test that a session token without org omits the r.o claim."""
    token = issue_session_token(user_id="user_123", org_id=None)
    payload = decode_token(token)

    assert payload is not None
    assert payload["r"]["u"] == "user_123"
    assert "o" not in payload["r"]  # Should be absent, not None


def test_decode_invalid_token():
    """Test that decoding an invalid token returns None."""
    payload = decode_token("invalid.token.here")
    assert payload is None


def test_token_expiry():
    """Test that a token with short expiry is still valid immediately."""
    token = issue_session_token(user_id="user_123", expires_in=60)
    payload = decode_token(token)
    assert payload is not None
    assert payload["exp"] > payload["iat"]
