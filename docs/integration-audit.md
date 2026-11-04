# Integration audit: apex-erp-mvp into the Apex Engineering Management Hub

Date: 4 November 2026
Source inspected: `apex-erp-mvp/apex-erp` (3,482 files)
Target: this repository

This report is the audit the integration brief asks for, written before any
import. It separates what was inspected from what was reused, and it marks
every claim as verified or unverified.

Nothing in the teammate's project has been copied into this repository. One
thing was taken: an algorithm, reimplemented against our own records. Where
this report says a requirement is met, it is met by code in this repository
that was run against our data, not by the existence of code in theirs.

---

## 1. What the two codebases are

| | This repository | apex-erp-mvp |
|---|---|---|
| Frontend | React 18 + TypeScript, Vite 5 | React + Vite, JavaScript, 7 files |
| Backend | **None** | FastAPI, 13 Python files, 1,095 lines |
| Database | **None.** A React context store persisted to `localStorage` | PostgreSQL 16 via SQLAlchemy 2 |
| Auth | Demo account switching in the client | PBKDF2-SHA256 passwords, HS256 JWT, 12h TTL |
| Authorization | `isAdmin` in the store, enforced in the UI | `require_admin` FastAPI dependency |
| Live updates | None | Server-Sent Events over in-process pub/sub |
| Deployment | Vercel static build | Docker Compose: app + Postgres |
| Queue / Redis | None | **None** |

This asymmetry decides most of what follows. The two projects do not share a
stack at any layer below the component model. The brief anticipated this: *"If
the two applications use incompatible stacks, reuse the underlying algorithms,
requirements and documentation rather than forcing incompatible code into our
application."* That is what was done.

---

## 2. Reconciliation of the 127-component design library

### 2.1 What the source holds

| Namespace | Prefix | Entries |
|---|---|---|
| Catalog | `C001`–`C085` | 85 |
| Component additions | `ADD-A21`–`ADD-A48` | 28 |
| Platform Next | `PN-A21`–`PN-A29` (no `PN-A26`) | 8 |
| App generation | `P-01`–`P-06` | 6 |
| **Total** | | **127** |

Verified three ways and they agree: 127 rows in `designs/coverage.csv`, 127
entries in `designs/design_manifest.json`, 127 design-pack directories.

Each pack holds eight architecture views as Mermaid source, SVG and PNG
(`01_context` through `08_lifecycle`), a `README.md`, an `index.html` and a
`request.schema.json`.

### 2.2 Against our catalogue

Our `src/data/library.json` holds **127 components whose IDs match the source
exactly**: no ID in ours that is missing from theirs, none in theirs missing
from ours, no duplicates on either side. The library in this application was
already derived from this source. There is nothing to import and no risk of a
second catalogue, which was the brief's main concern.

Provenance preserved on all 127: namespace (`group`), layer, planning wave,
SP mapping text, source sheet URL, overlap note, design-pack folder, acceptance
text, test, metric, and the eight diagrams. SP module IDs are parsed into a
list on 92 of 127.

### 2.3 The validation rules the source warns about

| Rule from the brief | Status in this application |
|---|---|
| Not 127 approved implementations | **Held.** All 127 rows carry state *"Design proposal — unassigned; architecture review required"*, and the application says so rather than presenting them as approved work. |
| ADD and Platform Next overlap | **Held and now specific.** `coverage.csv` flags exactly 8 overlaps: `PN-A21`–`PN-A25` and `PN-A27`–`PN-A29`, each marked *"reconcile before assignment"* against its `ADD-A2x` counterpart. The remaining 119 carry *"Reuse mapped SP / catalog capability before a new build"*. |
| C components may extend existing work | **Held.** 92 of 127 carry parsed SP module IDs. |
| Designs are first-draft proposals | **Held.** No component is presented as built or tested. |
| Contracts and dependencies not approved | **Held.** The Dependencies page states that nothing on it changes a dependency and that no approved schedule exists. |
| Implementations not tested | **Held.** The three readiness gates all read not-started for unworked components. |

### 2.4 One correction made during this audit

The 35 components with no parsed SP list carry the mapping text *"Not yet
mapped in Platform Bridge"*. A sentence in `situation()` had been reading that
as *"No platform module is mapped to it, so it would be built from scratch"*.
The source says the first thing and not the second. Corrected to *"No platform
module is mapped to it yet."* Commit `702905f`.

---

## 3. Dependency engine

### 3.1 The claim, checked

The brief states: *"The source library identifies four dependency cycles, with
the largest involving 41 components. Verify this against the actual source
data."*

Verified by running Tarjan's strongly connected components over our own
`library.json`:

```
components                        127
dependency edges                  389
self-dependencies                   0
edges to unknown ids                0
SCCs with more than one node        4
  SCC 1: 41 components
  SCC 2:  3 components
  SCC 3:  2 components
  SCC 4:  2 components
components inside an SCC           48
components with no prerequisite     0
```

**The claim holds exactly.** Four cycles, largest 41.

### 3.2 The 55 against the 4

This application had been reporting *55 loops*. Both numbers are right and they
count different things:

- **4** is the number of strongly connected components: tangles in which every
  member can reach every other through its prerequisites.
- **55** is the number of distinct minimal loops, which live inside those
  tangles — 51 of them inside the 41-component tangle alone.

Reporting only one of the two was a real cause of confusion on that page. Both
are now stated, with the distinction, and the tangles are shown above the
decision list so 55 decisions read as four problems. Commit `702905f`.

### 3.3 A finding neither project had surfaced

**Every one of the 127 components names at least one prerequisite, and none of
those prerequisites is complete.** There is therefore no step 1, and a build
order does not merely stall part-way — it never starts. The Plan view had been
printing an empty step list; it now says this plainly.

This is a fact about the records, not a defect in them, and it is the single
most consequential thing in the library: on the data as it stands, no component
in the portfolio can be built first.

### 3.4 Their implementation against ours

| | apex-erp-mvp | This repository |
|---|---|---|
| Cycle detection | Recursive Tarjan, `api.py:284`, raises the recursion limit to 5,000 | Iterative Tarjan, `src/depmath.ts`, no recursion limit to raise |
| Minimal loops | Not computed | Shortest loop per member set, `analyse()` |
| Cycle prevention | `_has_path` before insert, HTTP 409 | `wouldCycle()` in `src/logic.ts` |
| Self-dependency | HTTP 422 | Same check; verified 0 in the data |
| Build order | Not implemented | Level-by-level over the acyclic remainder |
| Parallel work | Not implemented | Each step of the order is a parallel set |
| Upstream/downstream | `graph` endpoint returns edges | `deps` and `neededBy` maps, plus the ego-network graph view |

Their recursive Tarjan would be at risk on a deeper graph; ours is iterative
for that reason. Their algorithm was the reference, their code was not copied.

---

## 4. GitHub integration

Inspected: `backend/app/github.py` (123 lines), the `/api/github/webhook`
endpoint at `api.py:388`, and `models.py:111` (`GitHubEvent`).

**Worth reusing as a pattern:**

- `verify_signature` — HMAC-SHA256 over the raw body, compared with
  `hmac.compare_digest`. Correct, and correctly placed before any parsing.
- Normalising six event types (push, pull_request, pull_request_review,
  issue_comment, issues, workflow_run) into one `GitHubEvent` mirror row rather
  than storing raw payloads.
- The source-of-truth boundary is respected: GitHub owns repository facts, the
  application owns ownership, reviewers and component associations.
- `sync_repo` degrades honestly when `GITHUB_TOKEN` is absent, returning
  *"skipped"* rather than pretending.

**Defects found, which the Redis work has to fix:**

1. **Duplicate protection is not enforced.** `delivery_id` is indexed but
   **not unique** (`models.py:122`). The check is a read followed by a write,
   so two concurrent deliveries of the same ID both pass it.
2. **Push events largely bypass the check.** `delivery_id` is stored only on
   the first commit of a push (`delivery_id if n == 0 else None`), so a
   redelivered push is only partly deduplicated.
3. **Processing is synchronous inside the request.** The endpoint verifies,
   parses, writes rows, sends notifications and commits before responding. A
   burst of deliveries goes straight at the database.
4. **No acknowledgement contract.** Every outcome returns 200, including
   *"ignored: unknown repository"*. There is no 202, no 503, and no way for
   GitHub's redelivery to help.
5. **No retries, no dead-letter, no idempotent reprocessing.**
6. **No GitHub App authentication.** `GITHUB_TOKEN` is a bare PAT. The brief's
   warning is accurate: this is not production-ready, and it is not presented
   as such anywhere in this application.

**Not connected.** This repository has no backend, so no webhook is received
and no GitHub integration is live. The Repositories page shows recorded
metadata only.

---

## 5. Readiness gates

The principle is right in their project and is stated in the model
(`models.py:47`, *"readiness gates are independent from each other and from
GitHub CI"*), as three booleans: `gate_checks_passed`, `gate_qa_accepted`,
`gate_ready_for_deploy`.

Ours is already further along, and the booleans would be a regression:

| Requirement | apex-erp-mvp | This repository |
|---|---|---|
| Checks separate from QA | Boolean | `Gate<ChecksState>` with 6 states, timestamp, actor, commit |
| QA decision | Boolean | `Gate<QAState>` with 6 states including `changes_requested` and `rejected`, plus reviewer and note |
| Deployment readiness | Boolean | `Gate<DeployState>` with 7 states including `rolled_back` |
| Evidence per criterion | `Acceptance` table, not per criterion | `Criterion.evidence[]`, each with kind, reviewer, decision, timestamp and version |
| Checks cannot approve QA | Enforced by their being separate columns | Same, and `deployBlockers()` requires all three independently |

**Action: reject their model, keep the principle.** Verified in ours: a passing
check never sets QA, and QA acceptance alone never yields deployment readiness
— `stage()` and `deployBlockers()` in `src/logic.ts` require each gate on its
own.

---

## 6. Audit history, notifications, comments

Inspected `services.py`, `events.py`, `models.py:125–143`.

- `audit()` and `notify()` are called from the handler that makes each change,
  so notifications come from real events. Sound, and the same pattern ours uses
  via `store.notify()`.
- `events.py` is in-process pub/sub feeding SSE, with its own comment: *"Swap
  for Redis pub/sub when running >1 worker."* Correct, and unfinished.
- Their notification set is narrower than the brief's 13 required events.

Ours covers 6 notification kinds with per-person preferences honoured. Neither
project covers all 13 events the brief lists. **Incomplete in both.**

---

## 7. Integration matrix

| Feature | Source files | Our equivalent | Action | Risk |
|---|---|---|---|---|
| 127-design library | `designs/*`, `coverage.csv`, `design_manifest.json` | `src/data/library.json` | **Already imported, 1:1, verified** | None. No duplicate catalogue. |
| Cycle detection | `api.py:284` | `src/depmath.ts` | **Reimplemented**, iterative, verified against the data | Low |
| Build order | not present | `proposedOrder()` in `src/pages/graph.tsx` | **Built here** | Low |
| Cycle prevention on insert | `api.py:318` | `wouldCycle()` | Already present | Low |
| Webhook signature check | `github.py:13` | none | **Adapt** — specified, not built | Needs a backend |
| Webhook idempotency | `github.py:38`, `models.py:122` | none | **Adapt with fixes** — the uniqueness defect must not be carried over | Needs a backend |
| Event normalisation | `github.py:33` | none | **Adapt** | Needs a backend |
| GitHub REST sync | `github.py:80` | none | **Adapt** | Needs a backend and a GitHub App |
| Readiness gates | `models.py:47` | `Component.gates` | **Reject the model, keep the principle** | None |
| Evidence and acceptance | `models.py:82` | `Criterion.evidence[]` | **Reject** — ours is richer | None |
| Audit history | `services.py:6` | `state.history` | **Reject** — ours is equivalent | None |
| Notifications | `services.py:10` | `store.notify()` | **Reject the code, adopt the event list** | Both incomplete |
| SSE live updates | `events.py` | none | **Defer** — no backend to stream from | Needs a backend |
| Auth (JWT, PBKDF2) | `security.py` | demo switching | **Adapt when a backend exists** | Ours is not real auth |
| Component data model | `models.py:29` | `src/types.ts` | **Reject** — ours carries more | None |
| Frontend | `frontend/*` | this app | **Reject**, per the brief | None |
| Redis queue | **not present in either** | none | **Specified only** | See §9 |

### A. Reuse directly
Nothing. No file was copied. The stacks do not meet.

### B. Adapt before integration
Tarjan SCC (done, §3). Webhook signature verification, delivery-ID idempotency
with the uniqueness defect fixed, event normalisation, and the GitHub App
token flow — all specified in `docs/webhook-queue-architecture.md`, none built.

### C. Do not integrate
Their frontend, component model, gate booleans, acceptance model, audit table,
notification table and SQLAlchemy schema. Each either duplicates something this
application already does better, or would introduce a second source of truth.

---

## 8. Safety rules

| Rule | Status |
|---|---|
| Do not overwrite our files | No file from the teammate's project was copied |
| Do not delete existing functionality | Nothing removed |
| Do not copy credentials | None copied. Their compose file has defaults (`JWT_SECRET: change-me…`, `GITHUB_WEBHOOK_SECRET: demo-webhook-secret`) which are **not** carried anywhere |
| Do not import demo users as real users | None imported |
| Do not import placeholder repositories | None imported |
| Do not import fake activity | None imported. `github.py:simulate()` generates fabricated commits and PRs; deliberately left behind |
| Do not import proposed dependencies as approved | All 127 remain *design proposal* |
| Do not claim GitHub is connected | No backend exists, so no integration is live, and the app does not claim one |
| No destructive migrations | No database exists |
| Do not redesign the frontend | Two pages changed, on the user's instruction |
| Keep the teammate's project intact | Extracted read-only to `/tmp`; never modified |

---

## 9. What remains incomplete

1. **No backend.** This is a frontend application with a `localStorage` store.
   Every webhook, queue, worker and database item is a specification, not an
   implementation.
2. **No GitHub connection**, and no GitHub App authentication flow in either
   project.
3. **Notifications** cover 6 of the brief's 13 events.
4. **Authentication** here is demo account switching, not authentication.
5. **The Redis architecture is designed, not built.** See
   `docs/webhook-queue-architecture.md`. None of its failure or recovery
   scenarios has been tested, because none of it is running. It is not
   production-ready and is not described as such.
6. **Accessibility** has been checked with a contrast and accessible-name pass
   written for this repository. No screen reader has been used, and axe has not
   been run; the npm registry is unreachable from this environment.
