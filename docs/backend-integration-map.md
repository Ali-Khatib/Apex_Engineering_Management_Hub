# Backend/API integration map

Branch: `feature/apex-backend-integration`
Date: 4 November 2026
Status: **audit only. No application code has been modified.**

Reference: `ApexAI-Arabia/engineering-management-platform`, supplied as an
archive and extracted read-only to `/tmp/claude-0/ref/`.
Our frontend: this repository, `/home/claude/apex_engineering_management_hub`.

---

## 0. First finding: this is the same codebase I already audited

The reference repository is **byte-identical** to the `apex-erp-mvp` archive
audited on 4 November (`docs/integration-audit.md`). Verified by diffing both
trees: the 13 backend Python files match exactly; the only differences are a
`.pytest_cache` directory and a `static/` folder present in the earlier copy.

So the earlier audit's conclusions hold unchanged, and this document adds what
that one did not have: the endpoint-level contract map this brief requires.

| | Reference | Ours |
|---|---|---|
| Backend | FastAPI, 13 files, 1,023 lines in `app/` | **None** |
| Database | PostgreSQL 16, SQLAlchemy 2 | **None.** React context persisted to `localStorage` |
| Migrations | **None.** `Base.metadata.create_all(engine)` at startup (`main.py:15`) | n/a |
| Auth | PBKDF2-SHA256 + HS256 JWT, 12h (`security.py`) | Demo account switching |
| Tests | 2 (`tests/test_workflow.py`) | 5 Playwright audit scripts |
| Queue / Redis | **None** | None |
| Frontend | React + Vite, 7 JS files | React 18 + TS, 25 pages — **the product** |

Locations: reference frontend `…/frontend`, backend `…/backend`, design library
`…/designs`, deployment `docker-compose.yml` (app + db only, no cache, no worker).

---

## 1. Every endpoint that actually exists

41 routes, extracted from `backend/app/api.py` and `main.py`. Nothing below is
inferred. All require `Authorization: Bearer <jwt>` except `/auth/login` and
`/api/health`; `require_admin` is noted where the source enforces it.

| Method | Path | Admin | Notes from source |
|---|---|---|---|
| POST | `/auth/login` | — | `{email, password}` → token |
| GET | `/me` | — | current user |
| GET | `/users` | — | list |
| POST | `/users` | yes | `NewUser` |
| PATCH | `/users/{uid}` | yes | `UserPatch` |
| GET | `/components` | — | list, `component_out` |
| POST | `/components` | yes | `CompIn` |
| GET | `/components/{cid}` | — | `component_out(detail=True)` |
| PATCH | `/components/{cid}` | — | `CompPatch`, including reviewer/QA assignments |
| DELETE | `/components/{cid}` | yes | |
| POST | `/components/{cid}/comments` | — | `{body, parent_id?}` |
| POST | `/components/{cid}/acceptances` | — | `{decision, evidence, evidence_url}` |
| POST | `/components/{cid}/gates` | — | `{gate: str, value: bool}` |
| POST | `/components/{cid}/request-review` | — | |
| GET | `/blockers` | — | authenticated blocker list |
| POST | `/components/{cid}/blockers` | — | blocker title, details, category, severity, responsible person, next action, date, and Slack reference |
| POST | `/blockers/{bid}/resolve` | — | owner or admin resolves |
| POST | `/components/{cid}/checklist` | — | `{text}` |
| POST | `/checklist/{iid}/toggle` | — | |
| GET | `/graph` | — | `{cycles, nodes, edges}` |
| POST | `/dependencies` | yes | `{component_id, depends_on_id}`, 409 on cycle |
| DELETE | `/dependencies/{did}` | yes | |
| GET | `/portfolio` | — | aggregate counts |
| GET | `/categories` | — | distinct categories |
| GET | `/milestones` · POST · PATCH `/{mid}` | mixed | `{name, description, target_date}` |
| GET | `/repos` · `/repos/{rid}` · POST | mixed | |
| POST | `/repos/{rid}/sync` | — | REST pull; **returns `skipped` without `GITHUB_TOKEN`** |
| POST | `/repos/{rid}/simulate` | — | **fabricates events.** Do not expose |
| POST | `/github/webhook` | — | signature-verified, synchronous |
| GET | `/audit` · `/notifications` · POST `/notifications/read` | — | |
| GET | `/kb` · `/kb/{slug}` · PUT `/kb/{slug}` | — | best practices / vision |
| GET | `/events` | — | Server-Sent Events stream |
| GET | `/config` · `/api/health` | — | |

---

## 2. Integration map, area by area

Each row: our surface → the real endpoint → what has to be built. "Adapter"
means a typed translation layer in our frontend; "**MISSING**" means no backend
support exists and it must be written.

### 2.1 Authentication
- **Ours:** demo account switcher (`shell.tsx`), `state.me`, `isAdmin`.
- **Backend:** `POST /auth/login` → `{token}`; `GET /me`.
- **Adapter:** store the JWT, attach `Authorization` on every call, map
  `{first_name,last_name}` → our `{first,last}`.
- **Risk:** our roles are enforced in the UI only. The backend enforces them
  server-side, which is stricter and correct. Expect currently-visible admin
  actions to start returning 403 for members. That is the fix, not a bug.

### 2.2 Users and roles
- **Ours:** Team page, `Person` with `skills[]`, `team`, `hue`, `joined`,
  `active`, `prefs`.
- **Backend:** `User` has `first_name, last_name, email, role, title,
  onboarding_notes`.
- **MISSING:** `skills`, `team`, `hue`, `joined`, `active`, notification
  preferences. Six fields with no column.
- Two global roles only (admin/member) matches the brief and both sides.

### 2.3 Portfolio dashboard
- **Ours:** Overview — ownership split, delivery pipeline, workload.
- **Backend:** `GET /portfolio` returns `total, by_status, by_priority,
  by_category, by_owner, by_due_month, unassigned, at_risk, ready_for_review,
  gates{…}`.
- **Adapter:** our four ownership states are derived client-side from
  `owner_id` + status; `/portfolio` gives `unassigned` only. Either derive ours
  from `GET /components`, or extend the endpoint.
- **Risk:** their `at_risk` is a one-line rule (`services.py:22`): blocked, or
  overdue, or status blocked. Ours (`risk()`) weighs seven signals. **Do not
  replace ours with theirs** — it is a downgrade, and the Roadmap's "At risk"
  filter depends on the richer version.

### 2.4 Components — the largest mismatch
- **Ours:** 127 records keyed by **string** IDs (`C015`, `ADD-A28`, `PN-A21`,
  `P-01`), routed as `#c-C015`.
- **Backend:** integer PK `id`, with the string in `code` (unique, indexed).
- **Adapter required:** every route, link and lookup resolves `code` → `id`.
  A client-side index built once from `GET /components`.
- **MISSING — the provenance.** Their `Component` has no column for `wave`,
  `sps[]`, `source`, `mapping`, `overlap`, `folder`, `diagrams[]`, `users`,
  `metric`, `test`, `op`, `inputs`, `outputs`, `entities`, `trigger`,
  `constraints`. That is the entire `LibInfo` record — the planning wave, the
  SP mapping and the eight architecture diagrams per component. Migrating into
  this schema as it stands would **lose the provenance** the earlier audit
  confirmed is intact, and the Roadmap's planning-wave axis would stop working.
- **Vocabulary mismatch:**

| Field | Theirs | Ours |
|---|---|---|
| status | `proposed, in_review, done, deployed, blocked` | `not_started, in_progress, blocked, under_review, completed` |
| priority | `P0, P1, P2, P3` | `critical, high, medium, low` |

  Both need a bidirectional map. Their `proposed` and our `not_started` are not
  the same idea, so this needs a decision, not a lookup table.

### 2.5 Assignments
- **Ours:** owner, reviewer, QA contact, with a handoff when the owner changes.
- **Backend:** `owner_id`, `reviewer_id`, and `qa_id` on the component. Review
  requests notify the assigned reviewer; QA decisions are restricted to the
  assigned QA contact or an admin when a QA contact is set.
- **MISSING:** handoff records and acknowledgement. Reassignment history is
  not yet persisted as a handoff workflow.

### 2.6 Dependencies
- **Backend:** `GET /graph` → `{cycles, nodes, edges}`; Tarjan at `api.py:284`;
  `_has_path` guard on insert (409).
- **Ours:** iterative Tarjan in `src/depmath.ts`, plus minimal-loop detection,
  build-order levels, and the cycle-decision record.
- **Decision:** keep ours client-side. Theirs returns SCCs only, has no build
  order, and recurses (it raises the recursion limit to 5,000 to cope).
  Consume `edges` from `/graph`, compute the rest here.
- **MISSING:** `CycleDecision` — our resolution record (status, chosen way out,
  decision owner, note, timestamp) has no table.

### 2.7 Readiness gates
- **Backend:** three booleans + `POST /gates {gate, value}`.
- **Ours:** three state machines — checks (6 states), QA (6), deploy (7) — each
  with actor, timestamp, note and commit.
- **Assessment:** the **principle** is right on both sides and independence is
  preserved. The **model** is a regression. Keep ours; the backend needs columns
  added, not ours collapsed to booleans.

### 2.8 Acceptance evidence
- **Backend:** `Acceptance` is **component-level**: `{decision, evidence,
  evidence_url, reviewer, created_at}`.
- **Ours:** evidence attaches to an **individual criterion**, with kind,
  version, reviewer decision and review timestamp per item.
- **MISSING:** `criterion_id` on `acceptances`, and a `criteria` table. Phase
  5.5 explicitly requires per-criterion evidence; the backend cannot express it.

### 2.9 Blockers and handoffs
- **Backend `Blocker`:** title, description, category, severity, responsible
  user, next action, target date, Slack reference, reporter, and resolved
  timestamps. `GET /blockers`, create, and resolve are connected to the UI.
- **Ours:** title, description, category, severity, responsible person,
  reported by, next action, target date, and a 7-value status.
- **MISSING:** a multi-state blocker lifecycle and blocker edit/reopen
  endpoints. Existing records remain readable when optional structured fields
  are absent. **Handoffs do not exist at all.**

### 2.10 Repositories and GitHub
- **Backend:** repo registry, `POST /repos/{rid}/sync` (REST pull),
  `POST /github/webhook` (HMAC-SHA256 verified, `github.py:13`).
- **Reusable:** signature verification and the six-event normaliser.
- **Defects carried from the earlier audit, confirmed again here:**
  `delivery_id` is indexed but **not unique** (`models.py:122`), so dedupe is a
  read-then-write race; push events store the delivery ID on the first commit
  row only; processing is synchronous inside the request; every outcome returns
  200; there is no GitHub App flow, only a PAT.
- **`POST /repos/{rid}/simulate` fabricates commits, PRs and CI runs.** It must
  not be reachable in any environment our UI talks to — Phase 5.7 forbids
  showing simulated activity as real.

### 2.11 Comments, notifications, audit
- **Backend:** `POST /components/{cid}/comments`, `GET /audit`,
  `GET /notifications`, `POST /notifications/read`, `GET /events` (SSE).
- **Ours:** comments, history and 6 notification kinds with per-person prefs.
- **Adapter:** straightforward. SSE replaces nothing we have, it adds live
  updates.
- **MISSING:** notification preferences; their `Notification` has no type
  column, only `message`, so our six kinds cannot be filtered server-side.

### 2.12 Best practices and knowledge
- **Backend:** `KBPage {slug, section, title, body_md, owner_id, updated_at}`.
- **Ours:** `Practice` adds `category`, `summary`, `technologies[]`,
  `reviewedAt`, `nextReview`, `override` — the review lifecycle that drives the
  "review due / outdated / under revision" flags.
- **MISSING:** the four lifecycle fields.

---

## 3. Summary lists

**Reusable close to as-is (4):** webhook signature verification; the six-event
GitHub normaliser; JWT + PBKDF2 auth; the SSE event stream.

**Reusable with changes (3):** component CRUD and `/portfolio` (after the code
→ id adapter and the vocabulary map); `/graph` edges (we keep our own
analysis); KB pages (after the lifecycle fields are added).

**Remaining backend gaps:** handoff records with acknowledgement; per-criterion
acceptance evidence; gate state machines with actor and timestamp; cycle
decision records; notification preferences; practice review lifecycle; richer
user profile fields; and blocker lifecycle edits beyond resolve.

**Frontend unchanged (all of it).** No page, component, token or interaction
needs replacing. The work is a service layer plus adapters behind the existing
store, so the UI keeps reading the same shapes.

**Frontend requiring adaptation (4 files, none visual):** `src/store.tsx`
(fetch instead of localStorage), a new `src/api.ts` (client, auth, adapters),
`src/types.ts` (optional server ids alongside our string ids), `shell.tsx`
(real login in place of account switching).

---

## 4. Proposed architecture

```
Our React frontend  ──► src/api.ts (typed client + adapters)
                              │  JWT in Authorization
                              ▼
                     FastAPI (the reference backend, extended)
                              ├── PostgreSQL  (one database, one source of truth)
                              ├── Redis + workers   ← new, per docs/webhook-queue-architecture.md
                              └── GitHub App        ← new, replacing the PAT
```

One database, one auth system, one component record, one API layer. The
adapters live in our frontend so no working UI component is rewritten, which is
what Phase 3 asks for.

**Three decisions I cannot take alone, because each changes stored data:**

1. **Component identity.** Keep our string IDs as `code` and carry their
   integer `id` internally, or migrate to integer IDs and rewrite our routing?
   I recommend the first: it preserves `#c-C015` links and the library's
   provenance.
2. **Status and priority vocabulary.** Theirs, ours, or a mapping layer? Their
   `proposed` and our `not_started` are not the same concept.
3. **Where the 127-component provenance lives.** Add 15 columns to their
   `components` table, or a sidecar `component_library` table keyed by `code`?
   I recommend the sidecar: it leaves their schema intact and keeps the source
   sheet's record separable from execution state.

---

## 5. Migration readiness

**There is no migration framework.** The backend calls
`Base.metadata.create_all(engine)` at startup, which creates missing tables and
silently ignores changed columns. Phase 6 requires schema comparison, explicit
mappings, a tested migration and a documented rollback. None of that is
possible until Alembic (or equivalent) is introduced and the current schema is
captured as a baseline revision. **That is step one of any implementation**, and
no data should be migrated before it exists.

---

## 6. What has not been done

No application code has been modified. No file has been copied from the
reference repository. The branch `feature/apex-backend-integration` holds this
document only. Nothing has been deployed, and `main` is untouched.

Implementation needs the three decisions in §4 and your approval to proceed.
