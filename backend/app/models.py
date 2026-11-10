from datetime import datetime, date
from sqlalchemy import String, Text, Integer, Boolean, ForeignKey, DateTime, Date, JSON, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .db import Base

def now(): return datetime.utcnow()

class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    first_name: Mapped[str] = mapped_column(String(80))
    last_name: Mapped[str] = mapped_column(String(80))
    email: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    role: Mapped[str] = mapped_column(String(10), default="member")  # admin | member
    password_hash: Mapped[str] = mapped_column(String(300))
    title: Mapped[str] = mapped_column(String(120), default="")  # shown as "Designation"
    onboarding_notes: Mapped[str] = mapped_column(Text, default="")
    # Profile fields. Rows that existed before these columns carry NULL and the
    # serializer shows them as empty; the API requires them on create.
    department: Mapped[str | None] = mapped_column(String(120), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(40), nullable=True)           # private
    linkedin_url: Mapped[str | None] = mapped_column(String(400), nullable=True)   # private
    vpn_id: Mapped[str | None] = mapped_column(String(80), nullable=True)          # private
    github_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    website_url: Mapped[str | None] = mapped_column(String(400), nullable=True)
    # Accounts are deactivated, never deleted: components, comments and the
    # audit log point at them.
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, default=now, nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, default=now, onupdate=now, nullable=True)

class Repository(Base):
    __tablename__ = "repositories"
    id: Mapped[int] = mapped_column(primary_key=True)
    full_name: Mapped[str] = mapped_column(String(200), unique=True)  # org/repo
    url: Mapped[str] = mapped_column(String(400))
    description: Mapped[str] = mapped_column(Text, default="")
    default_branch: Mapped[str] = mapped_column(String(80), default="main")
    docs_md: Mapped[str] = mapped_column(Text, default="")  # README / docs mirrored from GitHub
    last_synced: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

class Component(Base):
    __tablename__ = "components"
    id: Mapped[int] = mapped_column(primary_key=True)
    # Decision 1: `code` is the canonical, human-readable identity (C015,
    # ADD-A28, PN-A21, P-01). It is what our URLs, the source sheet and every
    # cross-reference use. `id` stays as the integer primary key for joins and
    # is an internal detail that must not appear in a URL or a document.
    code: Mapped[str] = mapped_column(String(40), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(80), index=True)
    layer: Mapped[str] = mapped_column(String(120), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    spec_md: Mapped[str] = mapped_column(Text, default="")
    docs_md: Mapped[str] = mapped_column(Text, default="")
    architecture_md: Mapped[str] = mapped_column(Text, default="")
    acceptance_criteria: Mapped[str] = mapped_column(Text, default="")
    # Decision 2: approval and development are different questions and are
    # recorded as different columns. The MVP overloaded one `status` column
    # with both, which is why "proposed" and "not started" looked
    # interchangeable. They are not: a component can be approved and not
    # started, or rejected while half-built.
    #
    #   approval_state  proposed | approved | rejected
    #   status          not_started | in_progress | blocked | in_review | completed
    #
    # Existing rows are NOT transformed silently. Migration 0002 backfills
    # approval_state from the old vocabulary and leaves `status` holding the
    # legacy value until a reviewed data migration moves it; the mapping is
    # written down in docs/status-vocabulary.md.
    approval_state: Mapped[str] = mapped_column(String(20), default="proposed", index=True)
    status: Mapped[str] = mapped_column(String(30), default="proposed", index=True)
    priority: Mapped[str] = mapped_column(String(20), default="P2")  # P0..P3
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    reviewer_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    qa_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    repo_id: Mapped[int | None] = mapped_column(ForeignKey("repositories.id"), nullable=True)
    milestone_id: Mapped[int | None] = mapped_column(ForeignKey("milestones.id"), nullable=True)
    # readiness gates are independent from each other and from GitHub CI
    gate_checks_passed: Mapped[bool] = mapped_column(Boolean, default=False)
    gate_qa_accepted: Mapped[bool] = mapped_column(Boolean, default=False)
    gate_ready_for_deploy: Mapped[bool] = mapped_column(Boolean, default=False)
    review_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    links: Mapped[dict] = mapped_column(JSON, default=dict)  # github, erpnext, slack, drive, sheets
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)
    owner = relationship("User", foreign_keys=[owner_id], lazy="joined")
    reviewer = relationship("User", foreign_keys=[reviewer_id], lazy="joined")
    qa = relationship("User", foreign_keys=[qa_id], lazy="joined")
    repo = relationship("Repository", lazy="joined")

class Dependency(Base):
    __tablename__ = "dependencies"
    __table_args__ = (UniqueConstraint("component_id", "depends_on_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    component_id: Mapped[int] = mapped_column(ForeignKey("components.id", ondelete="CASCADE"), index=True)
    depends_on_id: Mapped[int] = mapped_column(ForeignKey("components.id", ondelete="CASCADE"), index=True)

class Milestone(Base):
    __tablename__ = "milestones"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    target_date: Mapped[date | None] = mapped_column(Date, nullable=True)

class Comment(Base):
    __tablename__ = "comments"
    id: Mapped[int] = mapped_column(primary_key=True)
    component_id: Mapped[int] = mapped_column(ForeignKey("components.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    body: Mapped[str] = mapped_column(Text)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("comments.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    author = relationship("User", lazy="joined")

class Acceptance(Base):
    """Reviewer decision + evidence, recorded separately from CI."""
    __tablename__ = "acceptances"
    id: Mapped[int] = mapped_column(primary_key=True)
    component_id: Mapped[int] = mapped_column(ForeignKey("components.id", ondelete="CASCADE"), index=True)
    reviewer_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    decision: Mapped[str] = mapped_column(String(20))  # accepted | rejected | changes_requested
    evidence: Mapped[str] = mapped_column(Text, default="")
    evidence_url: Mapped[str] = mapped_column(String(400), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    reviewer = relationship("User", lazy="joined")

class Blocker(Base):
    __tablename__ = "blockers"
    id: Mapped[int] = mapped_column(primary_key=True)
    component_id: Mapped[int] = mapped_column(ForeignKey("components.id", ondelete="CASCADE"), index=True)
    title: Mapped[str | None] = mapped_column(String(300), nullable=True)
    description: Mapped[str] = mapped_column(Text)
    category: Mapped[str | None] = mapped_column(String(80), nullable=True)
    severity: Mapped[str | None] = mapped_column(String(20), nullable=True)
    responsible_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    next_action: Mapped[str | None] = mapped_column(Text, nullable=True)
    target_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    slack: Mapped[str | None] = mapped_column(String(400), nullable=True)
    raised_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    resolved: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    component = relationship("Component", lazy="joined")
    raised_by = relationship("User", foreign_keys=[raised_by_id], lazy="joined")

class ChecklistItem(Base):
    __tablename__ = "checklist_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    component_id: Mapped[int] = mapped_column(ForeignKey("components.id", ondelete="CASCADE"), index=True)
    text: Mapped[str] = mapped_column(String(300))
    done: Mapped[bool] = mapped_column(Boolean, default=False)

class GitHubEvent(Base):
    __tablename__ = "github_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    repo_id: Mapped[int] = mapped_column(ForeignKey("repositories.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(30), index=True)  # push|pull_request|review|pr_comment|issue|workflow
    ref_id: Mapped[str] = mapped_column(String(80), default="")  # sha / PR number / run id
    title: Mapped[str] = mapped_column(String(400), default="")
    state: Mapped[str] = mapped_column(String(40), default="")  # open|merged|closed|success|failure|...
    author: Mapped[str] = mapped_column(String(120), default="")
    url: Mapped[str] = mapped_column(String(400), default="")
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    delivery_id: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now, index=True)

class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(primary_key=True)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    component_id: Mapped[int | None] = mapped_column(ForeignKey("components.id", ondelete="SET NULL"), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(60))
    detail: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now, index=True)
    actor = relationship("User", lazy="joined")

class Notification(Base):
    __tablename__ = "notifications"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    component_id: Mapped[int | None] = mapped_column(ForeignKey("components.id", ondelete="CASCADE"), nullable=True)
    message: Mapped[str] = mapped_column(String(400))
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

class KBPage(Base):
    __tablename__ = "kb_pages"
    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(80), unique=True)
    section: Mapped[str] = mapped_column(String(40))  # vision | practices
    title: Mapped[str] = mapped_column(String(200))
    body_md: Mapped[str] = mapped_column(Text, default="")
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)
    owner = relationship("User", lazy="joined")


class ComponentProvenance(Base):
    """Decision 3: the design library's own record, kept beside the component.

    Keyed by the component CODE rather than its integer id, because the code is
    what the source sheet, the design packs and our URLs use, and because a
    provenance row can exist for a library entry before anybody creates a
    component for it.

    Nothing here is execution state. These fields come from the component
    design library of 20 October and are never rewritten by the application:
    they record what was proposed, not what has happened since. Flattening them
    into the components table would have lost the planning wave, the SP
    mapping and the eight architecture diagrams per entry.
    """
    __tablename__ = "component_provenance"
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True, index=True, nullable=False)

    namespace: Mapped[str] = mapped_column(String(40), default="")   # Catalog | Component additions | Platform Next | App generation
    group: Mapped[str] = mapped_column(String(120), default="")
    layer: Mapped[str] = mapped_column(String(120), default="")
    wave: Mapped[str] = mapped_column(String(40), default="", index=True)  # the eight source classifications, never rewritten
    sps: Mapped[list] = mapped_column(JSON, default=list)            # mapped platform modules, SP-01..SP-20
    source: Mapped[str] = mapped_column(String(80), default="")
    source_url: Mapped[str] = mapped_column(String(600), default="")
    mapping: Mapped[str] = mapped_column(Text, default="")           # the sheet's own mapping prose
    overlap: Mapped[str] = mapped_column(Text, default="")           # e.g. "PN-A21 - reconcile before assignment"
    folder: Mapped[str] = mapped_column(String(300), default="")     # the design pack on disk
    diagrams: Mapped[list] = mapped_column(JSON, default=list)       # [{n, title, caption}] - the eight views
    users: Mapped[str] = mapped_column(Text, default="")
    op: Mapped[str] = mapped_column(Text, default="")
    inputs: Mapped[list] = mapped_column(JSON, default=list)
    outputs: Mapped[list] = mapped_column(JSON, default=list)
    entities: Mapped[list] = mapped_column(JSON, default=list)
    trigger: Mapped[str] = mapped_column(Text, default="")
    constraints: Mapped[str] = mapped_column(Text, default="")
    metric: Mapped[str] = mapped_column(Text, default="")
    test: Mapped[str] = mapped_column(Text, default="")

    # Every entry in the library is a design proposal awaiting architecture
    # review. Recorded here so the frontend can say so without inferring it.
    library_state: Mapped[str] = mapped_column(String(80), default="Design proposal - architecture review required")
    imported_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class ComponentTemplate(Base):
    """Head row of a reusable component specification template.

    The sections live in immutable ComponentTemplateVersion rows. Editing a
    template appends a version, so a component can always say which version of
    the template it was written against.
    """
    __tablename__ = "component_templates"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    description: Mapped[str] = mapped_column(Text, default="")
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    current_version: Mapped[int] = mapped_column(Integer, default=1)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)

class ComponentTemplateVersion(Base):
    __tablename__ = "component_template_versions"
    __table_args__ = (UniqueConstraint("template_id", "version"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    template_id: Mapped[int] = mapped_column(ForeignKey("component_templates.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    sections: Mapped[list] = mapped_column(JSON, default=list)
    note: Mapped[str] = mapped_column(Text, default="")
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

class ComponentSpec(Base):
    """Structured specification text for sections that have no component column.

    Sections that already live on the component (description, architecture,
    API spec, acceptance criteria, docs) stay there; see governance.LEGACY_COLUMNS.
    """
    __tablename__ = "component_specs"
    id: Mapped[int] = mapped_column(primary_key=True)
    component_id: Mapped[int] = mapped_column(ForeignKey("components.id", ondelete="CASCADE"), unique=True)
    template_id: Mapped[int | None] = mapped_column(ForeignKey("component_templates.id"), nullable=True)
    template_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    updated_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)

class ConstitutionVersion(Base):
    """Append-only. The highest version is the one in force."""
    __tablename__ = "constitution_versions"
    id: Mapped[int] = mapped_column(primary_key=True)
    version: Mapped[int] = mapped_column(Integer, unique=True)
    rules: Mapped[list] = mapped_column(JSON, default=list)
    note: Mapped[str] = mapped_column(Text, default="")
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

class ComplianceReview(Base):
    """An advisory evaluation of one component against its Build Contract.

    It becomes binding only when a human reviewer approves it.
    """
    __tablename__ = "compliance_reviews"
    id: Mapped[int] = mapped_column(primary_key=True)
    component_id: Mapped[int] = mapped_column(ForeignKey("components.id", ondelete="CASCADE"), index=True)
    contract_hash: Mapped[str] = mapped_column(String(64))
    constitution_version: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20), default="advisory")  # advisory | approved | rejected
    checks: Mapped[list] = mapped_column(JSON, default=list)
    criteria: Mapped[list] = mapped_column(JSON, default=list)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    decided_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    decision_note: Mapped[str] = mapped_column(Text, default="")
