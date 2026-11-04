# Status and priority vocabulary

Decision 2: approval and development are different questions and are recorded
in different columns. This file is the mapping between the three vocabularies
now in play, so nothing has to be inferred later.

**No existing record is silently transformed.** Migration 0002 derives
`approval_state` and leaves `status` holding its legacy value. Moving `status`
onto the development vocabulary is a separate, reviewed data migration that has
not been written.

---

## 1. Approval state — `components.approval_state`

Where a component stands with architecture review. New column.

| Value | Meaning |
|---|---|
| `proposed` | In the library, awaiting architecture review. **All 127 entries are here today.** |
| `approved` | Review agreed the approach. It may be built. |
| `rejected` | Review declined it. It stays in the library with its provenance intact. |

## 2. Development status — `components.status`

How far the work has actually got. Existing column, vocabulary unchanged until
a reviewed data migration moves it.

| Target value | Meaning |
|---|---|
| `not_started` | Approved, nobody has begun. |
| `in_progress` | Being built. |
| `blocked` | Stopped by something outside the work. |
| `in_review` | Submitted, waiting on a reviewer or QA. |
| `completed` | Checks passed, QA accepted, deployment approved. |

## 3. The legacy column, and why it is not just renamed

The MVP overloaded one `status` column with both ideas:

| Legacy `status` | → `approval_state` | → `status` (after the data migration) | Note |
|---|---|---|---|
| `proposed` | `proposed` | `not_started` | **The ambiguous one.** `proposed` is an approval fact; `not_started` is a development fact. A component can be approved and not started, which the old column could not express. |
| `in_review` | `approved` | `in_review` | Code review, not architecture review. Two different reviews shared one word. |
| `blocked` | `approved` | `blocked` | |
| `done` | `approved` | `completed` | |
| `deployed` | `approved` | `completed` | Deployment is a readiness gate, not a status. `gates.ready_for_deploy` already carries it. |

Two legacy values collapse into `completed`, and one splits across both
columns. That is why this is a reviewed migration rather than a rename.

### Our frontend's vocabulary

Our `Component.status` already uses `not_started | in_progress | blocked |
under_review | completed`. One difference remains: we say `under_review`, the
target above says `in_review`. **Pick one before the data migration runs.** I
recommend `in_review`, matching the backend and the `review_requested` flag.

---

## 4. Priority

Kept as its own field, unchanged, in both systems.

| Backend | Ours |
|---|---|
| `P0` | `critical` |
| `P1` | `high` |
| `P2` | `medium` |
| `P3` | `low` |

A straight four-to-four mapping with no ambiguity, applied in the frontend
adapter. Neither side's stored values change.

---

## 5. Planning wave is none of these

The eight source classifications — Now, P0, Next, P1, Later, Gated,
Architecture decision, Not selected — live in `component_provenance.wave` and
are never rewritten by the application. The wave records what the source sheet
of 20 October decided. It is not an approval state and not a development
status, and the roadmap shows it as its own axis.

Note the collision: the sheet's wave `P0` and the backend's priority `P0` are
unrelated. Do not join on them.
