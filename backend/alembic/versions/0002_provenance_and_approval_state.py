"""provenance sidecar, approval state separated from development status

Implements the three architecture decisions recorded in
docs/backend-integration-map.md §4.

  1. `components.code` is the canonical identity and becomes NOT NULL.
  2. `approval_state` is added alongside `status`. The two are different
     questions and are no longer one overloaded column.
  3. `component_provenance` holds the design library's own record, keyed by
     component code.

No existing row is silently transformed. The backfill below only *derives*
`approval_state` from the legacy vocabulary and leaves `status` untouched;
moving `status` onto the new development vocabulary is a separate, reviewed
data migration that is deliberately not performed here. The mapping is written
out in docs/status-vocabulary.md.

NOT EXECUTED. Alembic cannot be installed in this environment (PyPI is
unreachable) and no database exists to run it against. See docs/migrations.md
before running it anywhere.

Revision ID: 0002_provenance_and_approval_state
Revises: 0001_baseline
"""
from alembic import op
import sqlalchemy as sa

revision = "0002_provenance_and_approval_state"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ---- Decision 2 --------------------------------------------------------
    # Nullable first, backfilled, then made NOT NULL. Adding a NOT NULL column
    # with a default in one step rewrites the table and locks it; on a table
    # this small it would not matter, but the pattern is the one to keep.
    op.add_column(
        "components",
        sa.Column("approval_state", sa.String(20), nullable=True),
    )

    # Derive approval from the legacy status vocabulary. Every legacy value
    # except "proposed" implies the component got past review, so it is
    # recorded as approved. Nothing is guessed beyond that, and `status` keeps
    # its original value.
    op.execute(
        """
        UPDATE components
           SET approval_state = CASE
                 WHEN status = 'proposed' THEN 'proposed'
                 ELSE 'approved'
               END
         WHERE approval_state IS NULL
        """
    )
    op.alter_column(
        "components",
        "approval_state",
        existing_type=sa.String(20),
        nullable=False,
        server_default="proposed",
    )
    op.create_index("ix_components_approval_state", "components", ["approval_state"])

    # ---- Decision 1 --------------------------------------------------------
    # The code is the identity every URL and document uses, so the database
    # should refuse a component without one.
    op.alter_column(
        "components",
        "code",
        existing_type=sa.String(40),
        nullable=False,
    )

    # ---- Decision 3 --------------------------------------------------------
    op.create_table(
        "component_provenance",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("code", sa.String(40), nullable=False),
        sa.Column("namespace", sa.String(40), nullable=False, server_default=""),
        sa.Column("group", sa.String(120), nullable=False, server_default=""),
        sa.Column("layer", sa.String(120), nullable=False, server_default=""),
        sa.Column("wave", sa.String(40), nullable=False, server_default=""),
        sa.Column("sps", sa.JSON(), nullable=True),
        sa.Column("source", sa.String(80), nullable=False, server_default=""),
        sa.Column("source_url", sa.String(600), nullable=False, server_default=""),
        sa.Column("mapping", sa.Text(), nullable=False, server_default=""),
        sa.Column("overlap", sa.Text(), nullable=False, server_default=""),
        sa.Column("folder", sa.String(300), nullable=False, server_default=""),
        sa.Column("diagrams", sa.JSON(), nullable=True),
        sa.Column("users", sa.Text(), nullable=False, server_default=""),
        sa.Column("op", sa.Text(), nullable=False, server_default=""),
        sa.Column("inputs", sa.JSON(), nullable=True),
        sa.Column("outputs", sa.JSON(), nullable=True),
        sa.Column("entities", sa.JSON(), nullable=True),
        sa.Column("trigger", sa.Text(), nullable=False, server_default=""),
        sa.Column("constraints", sa.Text(), nullable=False, server_default=""),
        sa.Column("metric", sa.Text(), nullable=False, server_default=""),
        sa.Column("test", sa.Text(), nullable=False, server_default=""),
        sa.Column(
            "library_state",
            sa.String(80),
            nullable=False,
            server_default="Design proposal - architecture review required",
        ),
        sa.Column("imported_at", sa.DateTime(), nullable=False),
    )
    # Unique on code, not a foreign key to components.id: a library entry can
    # have provenance before anyone creates a component for it, and the code
    # outlives any particular row.
    op.create_index(
        "ix_component_provenance_code", "component_provenance", ["code"], unique=True
    )


def downgrade() -> None:
    """Reverses everything 0002 added.

    Dropping `component_provenance` destroys the imported library metadata.
    That is recoverable only from src/data/library.json, which is the source of
    truth for it and is in version control. Re-import after downgrading.
    """
    op.drop_index("ix_component_provenance_code", table_name="component_provenance")
    op.drop_table("component_provenance")

    op.alter_column(
        "components",
        "code",
        existing_type=sa.String(40),
        nullable=True,
    )
    op.drop_index("ix_components_approval_state", table_name="components")
    op.drop_column("components", "approval_state")
