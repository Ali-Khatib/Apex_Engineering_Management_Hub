"""People / HR: candidates, assessment access, onboarding and offboarding cases

Revision ID: 0006_people_hr
Revises: 0005_governance

Adds tables and one nullable column (users.manager_id). No existing row is
changed. Default checklist templates are inserted by the application at startup
(seed_hr), which is idempotent. Downgrade drops only what this revision added.
"""
from alembic import op
import sqlalchemy as sa

revision = "0006_people_hr"
down_revision = "0005_governance"
branch_labels = None
depends_on = None


def _id():
    return sa.Column("id", sa.Integer(), primary_key=True)


def upgrade() -> None:
    with op.batch_alter_table("users") as b:
        b.add_column(sa.Column("manager_id", sa.Integer(), nullable=True))
        b.create_foreign_key("fk_users_manager_id", "users", ["manager_id"], ["id"])

    op.create_table(
        "hr_candidates", _id(),
        sa.Column("name", sa.String(160), nullable=False), sa.Column("email", sa.String(200), nullable=False),
        sa.Column("role_title", sa.String(160), nullable=False), sa.Column("linkedin_url", sa.String(500), nullable=False),
        sa.Column("stage", sa.String(20), nullable=False), sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("assessment_title", sa.String(200), nullable=False), sa.Column("assessment_brief", sa.Text(), nullable=False),
        sa.Column("assessment_instructions", sa.Text(), nullable=False), sa.Column("assessment_hours", sa.Integer(), nullable=False),
        sa.Column("first_sign_in_at", sa.DateTime(), nullable=True), sa.Column("deadline_at", sa.DateTime(), nullable=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("decided_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("decided_at", sa.DateTime(), nullable=True), sa.Column("decision_reason", sa.Text(), nullable=False),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False), sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_hr_candidates_email", "hr_candidates", ["email"])
    op.create_index("ix_hr_candidates_stage", "hr_candidates", ["stage"])

    op.create_table(
        "hr_candidate_access", _id(),
        sa.Column("candidate_id", sa.Integer(), sa.ForeignKey("hr_candidates.id", ondelete="CASCADE"), nullable=False),
        sa.Column("invitation_hash", sa.String(64), nullable=False, unique=True), sa.Column("code_hash", sa.String(64), nullable=False),
        sa.Column("issued_at", sa.DateTime(), nullable=False), sa.Column("code_expires_at", sa.DateTime(), nullable=False),
        sa.Column("failed_attempts", sa.Integer(), nullable=False), sa.Column("used_at", sa.DateTime(), nullable=True),
        sa.Column("revoked", sa.Boolean(), nullable=False), sa.Column("issued_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
    )
    op.create_index("ix_hr_candidate_access_candidate_id", "hr_candidate_access", ["candidate_id"])

    op.create_table(
        "hr_candidate_sessions", _id(),
        sa.Column("candidate_id", sa.Integer(), sa.ForeignKey("hr_candidates.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True), sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("revoked", sa.Boolean(), nullable=False), sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_hr_candidate_sessions_candidate_id", "hr_candidate_sessions", ["candidate_id"])

    op.create_table(
        "hr_submissions", _id(),
        sa.Column("candidate_id", sa.Integer(), sa.ForeignKey("hr_candidates.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("operation_id", sa.String(80), nullable=False), sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("repository_url", sa.String(500), nullable=False), sa.Column("linkedin_url", sa.String(500), nullable=False),
        sa.Column("checksum", sa.String(64), nullable=False), sa.Column("receipt_id", sa.String(40), nullable=False, unique=True),
        sa.Column("received_at", sa.DateTime(), nullable=False),
    )

    op.create_table(
        "hr_templates", _id(),
        sa.Column("kind", sa.String(20), nullable=False, unique=True), sa.Column("name", sa.String(160), nullable=False),
        sa.Column("tasks", sa.JSON(), nullable=False), sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("updated_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True), sa.Column("updated_at", sa.DateTime(), nullable=False),
    )

    op.create_table(
        "hr_cases", _id(),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("person_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("candidate_id", sa.Integer(), sa.ForeignKey("hr_candidates.id"), nullable=True),
        sa.Column("display_name", sa.String(200), nullable=False), sa.Column("role_title", sa.String(160), nullable=False),
        sa.Column("department", sa.String(120), nullable=False),
        sa.Column("manager_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("anchor_date", sa.Date(), nullable=True), sa.Column("stage", sa.String(20), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False), sa.Column("template_version", sa.Integer(), nullable=True),
        sa.Column("reason_category", sa.String(80), nullable=False), sa.Column("restricted_notes", sa.Text(), nullable=False),
        sa.Column("approved_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True), sa.Column("approved_at", sa.DateTime(), nullable=True),
        sa.Column("completed_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True), sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("closed_reason", sa.Text(), nullable=False),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False), sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    for col in ("kind", "person_user_id", "candidate_id", "owner_id", "stage"):
        op.create_index(f"ix_hr_cases_{col}", "hr_cases", [col])

    op.create_table(
        "hr_tasks", _id(),
        sa.Column("case_id", sa.Integer(), sa.ForeignKey("hr_cases.id", ondelete="CASCADE"), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False), sa.Column("key", sa.String(40), nullable=False),
        sa.Column("title", sa.String(200), nullable=False), sa.Column("instructions", sa.Text(), nullable=False),
        sa.Column("category", sa.String(80), nullable=False), sa.Column("required", sa.Boolean(), nullable=False),
        sa.Column("owner_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True), sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False), sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("integration", sa.String(20), nullable=False), sa.Column("confirmation", sa.String(24), nullable=False),
        sa.Column("confirmed_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True), sa.Column("confirmed_at", sa.DateTime(), nullable=True),
        sa.Column("evidence_note", sa.Text(), nullable=False), sa.Column("blocked_reason", sa.Text(), nullable=False),
        sa.Column("skip_reason", sa.Text(), nullable=False),
        sa.Column("completed_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True), sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("system_key", sa.String(20), nullable=True), sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_hr_tasks_case_id", "hr_tasks", ["case_id"])
    op.create_index("ix_hr_tasks_owner_id", "hr_tasks", ["owner_id"])

    op.create_table(
        "hr_handover_items", _id(),
        sa.Column("case_id", sa.Integer(), sa.ForeignKey("hr_cases.id", ondelete="CASCADE"), nullable=False),
        sa.Column("component_id", sa.Integer(), sa.ForeignKey("components.id"), nullable=False),
        sa.Column("blocker_id", sa.Integer(), sa.ForeignKey("blockers.id"), nullable=True),
        sa.Column("role", sa.String(10), nullable=False),
        sa.Column("from_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("to_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("status", sa.String(12), nullable=False), sa.Column("exception_reason", sa.Text(), nullable=False),
        sa.Column("decided_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True), sa.Column("decided_at", sa.DateTime(), nullable=True),
        sa.Column("accepted_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True), sa.Column("accepted_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_hr_handover_items_case_id", "hr_handover_items", ["case_id"])
    op.create_index("ix_hr_handover_items_component_id", "hr_handover_items", ["component_id"])

    op.create_table(
        "hr_events", _id(),
        sa.Column("case_id", sa.Integer(), sa.ForeignKey("hr_cases.id", ondelete="CASCADE"), nullable=True),
        sa.Column("candidate_id", sa.Integer(), sa.ForeignKey("hr_candidates.id", ondelete="CASCADE"), nullable=True),
        sa.Column("actor_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("action", sa.String(40), nullable=False), sa.Column("from_stage", sa.String(20), nullable=True),
        sa.Column("to_stage", sa.String(20), nullable=True), sa.Column("detail", sa.Text(), nullable=False),
        sa.Column("sensitive", sa.Boolean(), nullable=False), sa.Column("request_id", sa.String(80), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("case_id", "request_id"), sa.UniqueConstraint("candidate_id", "request_id"),
    )
    op.create_index("ix_hr_events_case_id", "hr_events", ["case_id"])
    op.create_index("ix_hr_events_candidate_id", "hr_events", ["candidate_id"])
    op.create_index("ix_hr_events_created_at", "hr_events", ["created_at"])


def downgrade() -> None:
    for t in ("hr_events", "hr_handover_items", "hr_tasks", "hr_cases", "hr_templates", "hr_submissions",
              "hr_candidate_sessions", "hr_candidate_access", "hr_candidates"):
        op.drop_table(t)
    with op.batch_alter_table("users") as b:
        b.drop_constraint("fk_users_manager_id", type_="foreignkey")
        b.drop_column("manager_id")
