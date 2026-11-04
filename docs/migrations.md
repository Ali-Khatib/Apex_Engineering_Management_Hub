# Migrations and rollback

Branch: `feature/apex-backend-integration`
Status: **written, not executed.** Read §1 before trusting anything here.

---

## 1. What could not be done, and why

Three of the steps requested for Step 1 have no object in this environment.
Saying so is the point; a migration reported as tested when it was not is worse
than no migration.

| Step | Status |
|---|---|
| Inspect the current database and schema | **Nothing to inspect.** No application database exists. No Postgres server, no cluster in `/var/lib/postgresql`, no Docker daemon, nothing listening on 5432, `DATABASE_URL` unset, and no SQLite file anywhere on the machine. The backend has never been run. |
| Create and verify a backup | **Nothing to back up.** See above. The only data that needs protecting is `src/data/library.json`, the 127-component library, which is already in version control. |
| Configure Alembic against the models | **Done** — `backend/alembic.ini`, `backend/alembic/env.py`. |
| Generate and inspect the initial migration | **Written, not generated.** `pip install alembic` fails: PyPI does not resolve from this container, the same DNS restriction that blocks npm. `alembic revision --autogenerate` could not be run. `0001_baseline.py` was instead derived *mechanically* by parsing `models.py`, not transcribed by eye, and every file compiles under `py_compile` — but compiling is not running. |
| Test upgrades and downgrades | **Not done.** No Alembic, no database. |
| Document rollback | **Done** — §4 below. |
| Run against production | **Not done, and not possible.** No production database exists. |

**Consequence:** treat `0001_baseline.py` as a careful draft that must be
verified by §3 before it is run anywhere, including a laptop.

---

## 2. The two revisions

```
0001_baseline                        the schema create_all() has been producing
   └── 0002_provenance_and_approval_state    the three architecture decisions
```

**`0001_baseline`** creates the 13 MVP tables exactly as they stand. It exists
so that a development database already created by `create_all()` can be adopted
with `alembic stamp 0001_baseline` instead of being dropped.

**`0002_provenance_and_approval_state`** applies the decisions:

- `components.approval_state` added beside `status`. Approval and development
  are separate questions and now separate columns.
- `components.code` becomes `NOT NULL` — it is the canonical identity.
- `component_provenance` created, keyed by `code`, holding the library record:
  wave, SP mappings, source, mapping, overlap, folder, `diagrams[]` and the
  rest of `LibInfo`.

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

## 3. Verification, to run when Alembic is installable

Do this against a scratch database, never a shared one.

```bash
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt

# A throwaway database. SQLite is enough to prove the mechanics; env.py turns
# on batch mode so ALTER COLUMN behaves as it does on Postgres.
export DATABASE_URL="sqlite:///./verify.db"

alembic upgrade head          # 1. both revisions apply cleanly
alembic downgrade base        # 2. both reverse cleanly
alembic upgrade head          # 3. and re-apply

# 4. The baseline must match the models. This must print NOTHING.
#    Anything printed is drift between 0001+0002 and models.py.
alembic revision --autogenerate -m "drift check" --rev-id drift_check
cat alembic/versions/drift_check_*.py   # upgrade() must be `pass`
rm alembic/versions/drift_check_*.py

# 5. Repeat 1-3 against Postgres before going near a real environment.
export DATABASE_URL="postgresql+psycopg2://apex:apex@localhost:5432/apex_verify"
alembic upgrade head && alembic downgrade base && alembic upgrade head
```

**Step 4 is the one that matters.** It is the check that replaces the
autogenerate I could not run. If it emits any operations, `0001_baseline.py` is
wrong and must be corrected before use.

### Adopting a database that already exists

```bash
alembic stamp 0001_baseline   # assert it is already at the MVP schema
alembic upgrade head          # then apply 0002 only
```

Never run `upgrade head` on a database created by `create_all()` without
stamping first — `0001` would try to create tables that are already there.

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

### 4.2 Reversing 0002

```bash
alembic downgrade 0001_baseline
```

Reverses cleanly. **It drops `component_provenance`**, which destroys the
imported library metadata. That is recoverable: `src/data/library.json` is the
source of truth for it and is in version control. Re-import after upgrading
again.

`approval_state` is dropped with its data. Nothing is lost that cannot be
re-derived, because the backfill only read `status`, which is untouched.

### 4.3 Reversing 0001

```bash
alembic downgrade base
```

**Drops all 13 tables.** This is destructive and is for a scratch database
only. On anything with real data, restore the dump instead:

```bash
pg_restore --clean --if-exists --dbname="$DATABASE_URL" pre-migration-*.dump
```

### 4.4 If a migration fails part-way

Postgres runs DDL transactionally, so a failed `upgrade` rolls back to the
previous revision on its own. Confirm with `alembic current`. If it reports a
revision you did not expect, stop and restore from the dump rather than
stamping over it — stamping asserts a state rather than reaching it.

SQLite does not give the same guarantee. A failed migration there can leave a
half-applied schema; delete the file and start again.

---

## 5. Production

Nothing here has run against production, because no production database
exists. When one does, it needs explicit approval before any migration, a
verified dump first, and §3 passing against a copy of production data rather
than an empty schema.
