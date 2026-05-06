"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | None}
Create Date: ${create_date}

"""
from alembic import op
import sqlalchemy as sa
${imports if imports else ""}

# revision identifiers, used by Alembic.
revision = ${up_revision}
down_revision = ${down_revision | None}
branch_labels = ${branch_labels | None}
depends_on = ${depends_on | None}


def upgrade() -> None:
    ${upgrades if upgrades else "pass"}


def downgrade() -> None:
    ${downgrades if downgrades else "pass"}
