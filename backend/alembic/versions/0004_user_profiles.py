"""user profile fields and account status

Revision ID: 0004_user_profiles
Revises: 0003_assignments_blockers

Adds the profile columns and an active flag. Existing users keep every value
they have: new text columns are NULL until someone fills them in, accounts
stay active, and passwords are untouched. Nothing is dropped or rewritten.
"""
from datetime import datetime
from alembic import op
import sqlalchemy as sa

revision = "0004_user_profiles"
down_revision = "0003_assignments_blockers"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as b:
        b.add_column(sa.Column("department", sa.String(120), nullable=True))
        b.add_column(sa.Column("phone", sa.String(40), nullable=True))
        b.add_column(sa.Column("linkedin_url", sa.String(400), nullable=True))
        b.add_column(sa.Column("vpn_id", sa.String(80), nullable=True))
        b.add_column(sa.Column("github_id", sa.String(80), nullable=True))
        b.add_column(sa.Column("website_url", sa.String(400), nullable=True))
        # NOT NULL needs a value for the rows that already exist; the default is
        # dropped again below so the model stays the single source of defaults.
        b.add_column(sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()))
        b.add_column(sa.Column("created_at", sa.DateTime(), nullable=True))
        b.add_column(sa.Column("updated_at", sa.DateTime(), nullable=True))
    with op.batch_alter_table("users") as b:
        b.alter_column("is_active", existing_type=sa.Boolean(), server_default=None)
    now = datetime.utcnow()
    op.get_bind().execute(sa.text("UPDATE users SET created_at = :n, updated_at = :n WHERE created_at IS NULL"), {"n": now})


def downgrade() -> None:
    with op.batch_alter_table("users") as b:
        for c in ("updated_at", "created_at", "is_active", "website_url", "github_id", "vpn_id",
                  "linkedin_url", "phone", "department"):
            b.drop_column(c)
