"""component templates, Engineering Constitution and compliance reviews

Revision ID: 0005_governance
Revises: 0004_user_profiles

Only new tables. No existing table or row is changed. The default template and
the first Constitution version are inserted by the application at startup
(seed_governance), which is idempotent and also covers databases that were
created before this migration.
"""
from alembic import op
import sqlalchemy as sa

revision = "0005_governance"
down_revision = "0004_user_profiles"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "component_templates",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False, unique=True),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("current_version", sa.Integer(), nullable=False),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "component_template_versions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("template_id", sa.Integer(), sa.ForeignKey("component_templates.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("sections", sa.JSON(), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("template_id", "version"),
    )
    op.create_index("ix_component_template_versions_template_id", "component_template_versions", ["template_id"])
    op.create_table(
        "component_specs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("component_id", sa.Integer(), sa.ForeignKey("components.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("template_id", sa.Integer(), sa.ForeignKey("component_templates.id"), nullable=True),
        sa.Column("template_version", sa.Integer(), nullable=True),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.Column("updated_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "constitution_versions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("version", sa.Integer(), nullable=False, unique=True),
        sa.Column("rules", sa.JSON(), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "compliance_reviews",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("component_id", sa.Integer(), sa.ForeignKey("components.id", ondelete="CASCADE"), nullable=False),
        sa.Column("contract_hash", sa.String(64), nullable=False),
        sa.Column("constitution_version", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("checks", sa.JSON(), nullable=False),
        sa.Column("criteria", sa.JSON(), nullable=False),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("decided_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("decided_at", sa.DateTime(), nullable=True),
        sa.Column("decision_note", sa.Text(), nullable=False),
    )
    op.create_index("ix_compliance_reviews_component_id", "compliance_reviews", ["component_id"])


def downgrade() -> None:
    op.drop_index("ix_compliance_reviews_component_id", table_name="compliance_reviews")
    op.drop_table("compliance_reviews")
    op.drop_table("constitution_versions")
    op.drop_table("component_specs")
    op.drop_index("ix_component_template_versions_template_id", table_name="component_template_versions")
    op.drop_table("component_template_versions")
    op.drop_table("component_templates")
