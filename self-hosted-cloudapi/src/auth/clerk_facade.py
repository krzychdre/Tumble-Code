"""Clerk-compatible API response formatting."""

from typing import Optional, List, Tuple
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.user import User
from src.models.organization import Organization as OrganizationModel, Membership as MembershipModel
from src.schemas.auth import (
    ClerkSignInResponse,
    ClerkSessionTokenResponse,
    ClerkMeResponse,
    ClerkOrgMembershipsResponse,
    EmailAddress,
    ClerkOrganization,
    ClerkMembership,
)


def format_sign_in_response(session_id: str, client_token: str) -> Tuple[dict, str]:
    """Format a Clerk-compatible sign-in response.

    Returns a tuple of (response body dict, Authorization header value).
    """
    return ({
        "response": {
            "created_session_id": session_id,
        }
    }, client_token)


def format_session_token_response(jwt: str) -> dict:
    """Format a Clerk-compatible session token response."""
    return {"jwt": jwt}


def format_me_response(
    user: User,
    email: str,
    email_id: str = "email_primary",
) -> dict:
    """Format a Clerk-compatible /v1/me response."""
    return {
        "response": {
            "id": user.id,
            "first_name": user.first_name or None,
            "last_name": user.last_name or None,
            "image_url": user.image_url,
            "primary_email_address_id": email_id,
            "email_addresses": [
                {
                    "id": email_id,
                    "email_address": email,
                }
            ],
            "public_metadata": {},
        }
    }


def format_org_memberships_response(memberships: list) -> dict:
    """Format a Clerk-compatible /v1/me/organization_memberships response."""
    return {
        "response": [
            {
                "id": m.id,
                "role": m.role,
                "permissions": [],
                "organization": {
                    "id": m.organization.id,
                    "name": m.organization.name,
                    "slug": m.organization.slug,
                    "image_url": m.organization.image_url,
                    "has_image": m.organization.has_image,
                    "created_at": int(m.organization.created_at.timestamp()) if m.organization.created_at else None,
                    "updated_at": int(m.organization.updated_at.timestamp()) if m.organization.updated_at else None,
                },
            }
            for m in memberships
        ]
    }
