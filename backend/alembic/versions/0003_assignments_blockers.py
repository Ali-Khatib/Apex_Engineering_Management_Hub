"""persist reviewer/QA assignments and structured blocker ownership details

Revision ID: 0003_assignments_blockers
Revises: 0002_provenance_approval
"""
from alembic import op
import sqlalchemy as sa

revision = "0003_assignments_blockers"
down_revision = "0002_provenance_approval"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("components") as batch_op:
        batch_op.add_column(sa.Column("reviewer_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key("fk_components_reviewer_id_users", "users", ["reviewer_id"], ["id"])
        batch_op.add_column(sa.Column("qa_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key("fk_components_qa_id_users", "users", ["qa_id"], ["id"])

    with op.batch_alter_table("blockers") as batch_op:
        batch_op.add_column(sa.Column("title", sa.String(300), nullable=True))
        batch_op.add_column(sa.Column("category", sa.String(80), nullable=True))
        batch_op.add_column(sa.Column("severity", sa.String(20), nullable=True))
        batch_op.add_column(sa.Column("responsible_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key("fk_blockers_responsible_id_users", "users", ["responsible_id"], ["id"])
        batch_op.add_column(sa.Column("next_action", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("target_date", sa.Date(), nullable=True))
        batch_op.add_column(sa.Column("slack", sa.String(400), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("blockers") as batch_op:
        batch_op.drop_column("slack")
        batch_op.drop_column("target_date")
        batch_op.drop_column("next_action")
        batch_op.drop_constraint("fk_blockers_responsible_id_users", type_="foreignkey")
        batch_op.drop_column("responsible_id")
        batch_op.drop_column("severity")
        batch_op.drop_column("category")
        batch_op.drop_column("title")

    with op.batch_alter_table("components") as batch_op:
        batch_op.drop_constraint("fk_components_qa_id_users", type_="foreignkey")
        batch_op.drop_constraint("fk_components_reviewer_id_users", type_="foreignkey")
        batch_op.drop_column("qa_id")
        batch_op.drop_column("reviewer_id")
