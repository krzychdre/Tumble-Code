"""Tests for Clerk-compatible auth endpoints."""

import pytest
from fastapi.testclient import TestClient
from src.main import app


@pytest.fixture
def client():
    return TestClient(app)


def test_sign_in_missing_strategy(client):
    """Test that sign-in without strategy parameter returns error."""
    response = client.post("/v1/client/sign_ins", data={})
    assert response.status_code == 422


def test_sign_in_invalid_ticket(client):
    """Test that sign-in with invalid ticket returns 401."""
    response = client.post(
        "/v1/client/sign_ins",
        data={"strategy": "ticket", "ticket": "invalid_ticket"},
    )
    assert response.status_code == 401


def test_me_without_auth(client):
    """Test that /v1/me without auth returns 401."""
    response = client.get("/v1/me")
    assert response.status_code == 401


def test_org_memberships_without_auth(client):
    """Test that /v1/me/organization_memberships without auth returns 401."""
    response = client.get("/v1/me/organization_memberships")
    assert response.status_code == 401
