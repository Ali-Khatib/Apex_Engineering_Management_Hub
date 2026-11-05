# Migrations and rollback

Branch: `feature/apex-backend-integration`
Status: **SQLite cycle and ORM drift verified; PostgreSQL and production are
not verified.** Read §1 before applying this to an existing database.

---

## 1. Verification status

| Check | Status |
|---|---|
| Alembic availability | Installed in the project environment and declared in `backend/requirements.txt`. |
| Baseline comparison | `0001_baseline` was applied to scratch SQLite and compared to the original checked-in ORM models; zero drift operations. |
| Full migration cycle | `upgrade head`, `alembic check`, `downgrade base`, and a second `upgrade head` all passed on scratch SQLite. |
| Current ORM comparison | `alembic check` reported no new upgrade operations after the full cycle. |
| Existing database inspection | **Not done.** The configured application database was not read or modified. |
| PostgreSQL verification | **Not done.** Docker daemon access and a local PostgreSQL client/server were unavailable in this environment. |
| Production verification | **Not done.** No production database was accessed. |

SQLite verifies migration mechanics, not PostgreSQL-specific behavior. Run the
PostgreSQL check in §3 before applying these revisions to a PostgreSQL
environment.

---

## 2. The revisions

```
0001_baseline                        the original backend ORM schema
   └── 0002_provenance_approval
       └── 0003_assignments_blockers
```

**`0001_baseline`** creates the original backend ORM schema. It can be adopted
by an existing database only after confirming that database has exactly this
schema; see §3. The app no longer calls `create_all()` at startup.

**`0002_provenance_approval`** applies the decisions:

- `components.approval_state` added beside `status`. Approval and development
  are separate questions and now separate columns.
- `components.code` remains the canonical identity from the baseline.
- `component_provenance` created, keyed by `code`, holding the library record:
  wave, SP mappings, source, mapping, overlap, folder, `diagrams[]` and the
  rest of `LibInfo`.

**`0003_assignments_blockers`** adds nullable reviewer and QA
contacts to components, plus structured title, category, severity, responsible
person, next action, target date, and Slack reference fields to blockers.
Existing blocker rows retain their descriptions; new fields are nullable so
the migration does not invent data for existing records.

### What the backfill does and does not do

It derives `approval_state` only:

```sql
UPDATE components
   SET approval_state = CASE WHEN status = 'proposed' THEN 'proposed'
                             ELSE 'approved' END
 WHERE approval_state IS NULL
```

**`status` is not touched.** Moving it onto the new development vocabulary is a
separate, reviewed data migration that is deliberately not included, because
the legacy values and the new ones do not correspond one to one. The mapping is
in `docs/status-vocabulary.md`.

---

## 3. Reproducing verification

Do this against a scratch database, never a shared one.

```bash
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt

# Use a new throwaway database. Never point this check at an application DB.
export DATABASE_URL="sqlite:///./verify.db"

alembic upgrade head
alembic check
alembic downgrade base
alembic upgrade head
alembic check

# Repeat against a disposable PostgreSQL database before using PostgreSQL.
export DATABASE_URL="postgresql+psycopg2://apex:apex@localhost:5432/apex_verify"
alembic upgrade head && alembic downgrade base && alembic upgrade head
```

`alembic check` must report no new upgrade operations. The SQLite cycle passed;
the PostgreSQL check remains outstanding.

### Adopting a database that already exists

Do not stamp an existing database based on its age or the fact that its tables
look familiar. First take and verify a backup, inspect its complete schema, and
compare it with the target revision. Only then stamp the matching revision:

```bash
alembic stamp 0001_baseline  # only if it exactly matches the original ORM schema
# OR:
alembic stamp head           # only if it exactly matches the current ORM schema
```

If the schema does not exactly match either state, stop and prepare a reviewed
adoption migration; do not stamp or run `upgrade head`. Startup executes
`alembic upgrade head`, so existing unversioned databases must be safely
adopted before starting the application.

**Production is the exception.** With `APEX_ENV=production` the app does not
migrate at startup. Run `alembic upgrade head` by hand after a verified backup,
or set `APEX_AUTO_MIGRATE=1` for that one deploy and unset it afterwards.

---

## 4. Rollback

### 4.1 Before running anything

```bash
# Postgres
pg_dump --format=custom --file=pre-migration-$(date +%Y%m%dT%H%M%S).dump "$DATABASE_URL"
# verify the dump is readable before relying on it
pg_restore --list pre-migration-*.dump | head
```

A dump nobody has listed is not a backup.

### 4.2 Reversing 0003

```bash
alembic downgrade 0002_provenance_approval
```

This drops reviewer/QA assignments and the structured blocker fields added by
0003. Blocker descriptions, reporter, resolution state, and timestamps remain.
Export any assignments and structured blocker details that must be retained
before downgrading.

### 4.3 Reversing 0002

```bash
alembic downgrade 0001_baseline
```

Reverses cleanly. **It drops `component_provenance`**, which destroys the
imported library metadata. That is recoverable: `src/data/library.json` is the
source of truth for it and is in version control. Re-import after upgrading
again.

`approval_state` is dropped with its data. Nothing is lost that cannot be
re-derived, because the backfill only read `status`, which is untouched.

### 4.4 Reversing 0001

```bash
alembic downgrade base
```

**Drops all 13 tables.** This is destructive and is for a scratch database
only. On anything with real data, restore the dump instead:

```bash
pg_restore --clean --if-exists --dbname="$DATABASE_URL" pre-migration-*.dump
```

### 4.5 If a migration fails part-way

Postgres runs DDL transactionally, so a failed `upgrade` rolls back to the
previous revision on its own. Confirm with `alembic current`. If it reports a
revision you did not expect, stop and restore from the dump rather than
stamping over it — stamping asserts a state rather than reaching it.

SQLite does not give the same guarantee. A failed migration there can leave a
half-applied schema; delete the file and start again.

---

## 5. Production

No production database was accessed. Any production migration requires
explicit approval, a verified backup, and successful verification against a
production-like copy before rollout.
