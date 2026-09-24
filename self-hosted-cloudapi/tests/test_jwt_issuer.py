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


# --- Library-independent guards (DEP-5) --------------------------------------
#
# The JWT library is swapped (python-jose to PyJWT), so the tests below pin
# what the tokens look like on the wire and which tokens are refused without
# using any JWT library: tokens are built by hand with hmac and base64.

import base64
import hashlib
import hmac
import json
import time

from config.settings import settings

# A long-lived static token issued by python-jose 3.5.0 before the swap, with
# the test-suite secret below. Static tokens live for a year in users'
# ROO_CODE_CLOUD_TOKEN, so tokens issued by the old library must keep verifying.
LEGACY_SECRET = "test-jwt-secret-please-ignore-0123456789"
LEGACY_TOKEN = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJyY2MiLCJzdWIiOiJ1c2VyX2xlZ2FjeSIsImV4cCI6NDEwMjQ0NDgwMCwiaWF0IjoxNzkwMDAwMDAwLCJuYmYiOjE3OTAwMDAwMDAsInYiOjEsInIiOnsidSI6InVzZXJfbGVnYWN5IiwibyI6Im9yZ19sZWdhY3kiLCJ0IjoiYXV0aCJ9fQ."
    "Z2XcbGL5UNApj-Pv3Vz0LYG1SnUQO72czHufxcGJDck"
)


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(part: str) -> dict:
    return json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))


def _hand_signed(claims: dict, secret: str, alg: str = "HS256") -> str:
    digest = {"HS256": hashlib.sha256, "HS512": hashlib.sha512}[alg]
    signing_input = (
        _b64(json.dumps({"alg": alg, "typ": "JWT"}).encode())
        + "."
        + _b64(json.dumps(claims).encode())
    )
    sig = hmac.new(secret.encode(), signing_input.encode(), digest).digest()
    return signing_input + "." + _b64(sig)


def _claims(**overrides) -> dict:
    now = int(time.time())
    claims = {"iss": "rcc", "sub": "u1", "exp": now + 60, "iat": now, "nbf": now, "v": 1,
              "r": {"u": "u1", "t": "auth"}}
    claims.update(overrides)
    return claims


@pytest.fixture
def legacy_secret(monkeypatch):
    monkeypatch.setattr(settings, "jwt_algorithm", "HS256")
    monkeypatch.setattr(settings, "jwt_secret", LEGACY_SECRET)


def test_token_header_and_signature_on_the_wire(legacy_secret):
    token = issue_session_token(user_id="user_123", org_id="org_456", expires_in=60)
    header_part, payload_part, sig_part = token.split(".")

    assert _unb64(header_part) == {"alg": "HS256", "typ": "JWT"}
    payload = _unb64(payload_part)
    assert set(payload) == {"iss", "sub", "exp", "iat", "nbf", "v", "r"}
    assert payload["r"] == {"u": "user_123", "o": "org_456", "t": "auth"}
    assert payload["exp"] - payload["iat"] == 60
    assert payload["nbf"] == payload["iat"]

    expected = hmac.new(
        LEGACY_SECRET.encode(), f"{header_part}.{payload_part}".encode(), hashlib.sha256
    ).digest()
    assert sig_part == _b64(expected)


def test_static_token_claims_on_the_wire(legacy_secret):
    from src.auth.jwt_issuer import issue_static_token

    token = issue_static_token(user_id="u9", token_type="cj", expires_in=100)
    payload = _unb64(token.split(".")[1])
    assert payload["sub"] == "cj_u9"
    assert payload["r"] == {"u": "u9", "t": "cj"}
    assert payload["exp"] - payload["iat"] == 100


def test_a_token_issued_by_python_jose_still_verifies(legacy_secret):
    assert decode_token(LEGACY_TOKEN) == {
        "iss": "rcc",
        "sub": "user_legacy",
        "exp": 4102444800,
        "iat": 1790000000,
        "nbf": 1790000000,
        "v": 1,
        "r": {"u": "user_legacy", "o": "org_legacy", "t": "auth"},
    }


def test_a_hand_signed_token_verifies(legacy_secret):
    claims = _claims()
    assert decode_token(_hand_signed(claims, LEGACY_SECRET)) == claims


@pytest.mark.parametrize(
    "token_factory",
    [
        pytest.param(lambda: _hand_signed(_claims(exp=int(time.time()) - 10), LEGACY_SECRET), id="expired"),
        pytest.param(lambda: _hand_signed(_claims(nbf=int(time.time()) + 3600), LEGACY_SECRET), id="not-yet-valid"),
        pytest.param(lambda: _hand_signed(_claims(), "another-secret-of-sufficient-length-000"), id="wrong-key"),
        pytest.param(lambda: _hand_signed(_claims(), LEGACY_SECRET, alg="HS512"), id="other-algorithm"),
        pytest.param(
            lambda: _b64(json.dumps({"alg": "none", "typ": "JWT"}).encode())
            + "."
            + _b64(json.dumps(_claims()).encode())
            + ".",
            id="alg-none",
        ),
        pytest.param(lambda: LEGACY_TOKEN[:-2] + "AA", id="tampered-signature"),
        pytest.param(lambda: "", id="empty"),
    ],
)
def test_bad_tokens_are_refused(legacy_secret, token_factory):
    assert decode_token(token_factory()) is None


def test_rs256_round_trip(monkeypatch):
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    public_pem = key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    ).decode()
    monkeypatch.setattr(settings, "jwt_algorithm", "RS256")
    monkeypatch.setattr(settings, "jwt_private_key", private_pem)
    monkeypatch.setattr(settings, "jwt_public_key", public_pem)

    token = issue_session_token(user_id="u_rs", org_id=None)

    assert _unb64(token.split(".")[0]) == {"alg": "RS256", "typ": "JWT"}
    payload = decode_token(token)
    assert payload is not None and payload["r"] == {"u": "u_rs", "t": "auth"}

    # The HS256 secret must not verify an RS256 deployment's tokens.
    assert decode_token(_hand_signed(_claims(), LEGACY_SECRET)) is None
