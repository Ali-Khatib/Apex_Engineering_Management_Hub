# Apex HQ: governance, templates and people

Apex HQ is the Apex Engineering Management Hub with three additions: a
user-profile model with private fields, versioned component templates and
specifications, and an Engineering Constitution that is compiled into an AI
Build Contract for every component, with an advisory compliance review in front
of completion.

Nothing in this document is a claim about behaviour that was not tested. The
last section lists what has and has not been run.

## What is enforced and what is advice

An AI builder receives text. Text cannot force a model to comply, so the design
separates what the **server** enforces from what the contract **asks**.

Enforced by the server, regardless of any prompt:

- Authorization on every endpoint. A contract cannot grant or widen permissions.
- Who may edit which section of a specification (see below).
- Who may approve a compliance review: the assigned reviewer or an admin, never
  the component's owner.
- Optionally, that a component cannot be marked `done` or `deployed` without a
  human-approved review of its current contract (`APEX_REQUIRE_COMPLIANCE_REVIEW=1`,
  off by default).

Asked of the builder through the contract:

- Follow the Constitution, stay in scope, report honestly.

## Users and profiles

Fields: first name, last name, designation, department, email, phone, LinkedIn
URL, VPN ID (all required on create); GitHub ID and personal website (optional);
plus role, `is_active`, `created_at`, `updated_at`.

`designation` is the existing `users.title` column. It is not duplicated.

| Field | Who can read it |
|---|---|
| name, designation, department, email, GitHub ID, website, role, status | any signed-in user |
| phone, VPN ID, LinkedIn URL | admins and the person themselves |

Private fields never appear in `GET /api/users`, in the owner/reviewer objects
embedded in components, or in `GET /api/users/{id}` for anyone else. An admin
reading another person's record is written to the audit log (`user.view_private`).

Validation: email shape and uniqueness, https-only URLs, LinkedIn must be on
linkedin.com, phone is 7 to 25 digits, VPN ID is letters, digits and `. _ @ -`,
GitHub ID follows GitHub's character rules. Errors come back as
`422 {"detail": {"message", "fields": {name: message}}}`.

Retention: accounts are **deactivated, never deleted**. Components, comments and
the audit trail refer to users, and deleting one would orphan them. A
deactivated account cannot sign in or use an existing token, disappears from the
directory and from pickers, and keeps its history. An admin cannot deactivate
themselves, and the last active admin cannot be demoted. There is no initial
password default: creating a user needs a password of at least 12 characters.

| Endpoint | Who |
|---|---|
| `GET /api/users[?include_inactive=true]` | signed in (inactive list: admin) |
| `GET /api/users/{id}` | signed in; private fields for admin or self |
| `POST /api/users` | admin |
| `PATCH /api/users/{id}` | admin |
| `PATCH /api/me` | self: phone, LinkedIn, GitHub, website only |
| `POST /api/users/{id}/deactivate`, `/reactivate` | admin |

## Component specifications and templates

A template is a list of sections: `key`, `label`, `required`, `hint`. The
standard template has ten, and **these cannot be removed** from any template:
purpose, functional requirements, technical architecture, API contracts,
dependencies, guardrails, acceptance criteria, testing requirements,
documentation references, AI instructions. Admins may relabel them, change
whether they are required, and add sections.

Editing a template appends a version. A component keeps the version it was
written against until an admin moves it.

Existing component content is **not copied or overwritten**. Sections that
already live on a component stay in that column:

| Section | Stored in |
|---|---|
| purpose | `components.description` |
| technical_architecture | `components.architecture_md` |
| api_contracts | `components.spec_md` |
| acceptance_criteria | `components.acceptance_criteria` |
| documentation_refs | `components.docs_md` |
| dependencies | derived from the dependency graph, never stored |
| everything else | `component_specs.data` |

Who may edit a section: the owner or an admin, except `purpose`,
`acceptance_criteria`, `guardrails` and `ai_instructions`, which are admin-only.
Those define what done means and what the builder must never do, so the person
being judged does not write them. Edits are audited by section name, never by
content.

| Endpoint | Who |
|---|---|
| `GET/POST /api/templates`, `GET/PATCH /api/templates/{id}` | read: signed in; write: admin |
| `GET /api/components/{id}/spec` | signed in |
| `PUT /api/components/{id}/spec` | owner or admin, section rules above |

## Apex Engineering Constitution

Fourteen engineering rules (R01 to R14) and twelve company-wide AI slop blockers
(R15 to R26, `group: "ai_slop"`), versioned and append-only. Publishing a
new version is admin-only. Removing a rule needs a written reason of at least 10
characters. Old versions stay readable.

`GET /api/constitution`, `GET /api/constitution/{version}`, `PUT /api/constitution`.

### AI slop blockers

R15 to R26 apply to every engineer and every AI builder on every component:
no filler or placeholder content, no invented references, no decorative code,
no swallowed failures, no theatre tests, no unverifiable claims, no generic
output, no unrequested rewrites, no duplicated logic, no unvetted dependencies,
no silent guessing, and no AI-written change the owner has not read.

These are drafted as proposed defaults for Apex admins to review and edit. They
are not a statement of an existing Apex policy. A new database is seeded with
all 26 rules as version 1. A database still on the untouched original
fourteen is moved to version 2 on startup, and the history records it. A
Constitution an admin has already changed is left alone.

## Component AI baseline and slop defender

The default template has two further sections, **Component AI baseline** and
**Component AI slop defender**. A section can carry `boilerplate` text, owned by
admins and versioned with the template. Every contract copies it into
`trusted.template_baseline`, and the rendered prompt places it before the
component content. A component cannot edit or remove it. What the component
writes in those sections (the files to read first, the slop likely on that
component) stays in the untrusted block beside it. The baseline text is part of
the contract fingerprint, so editing it makes earlier reviews stale.

A component explicitly pinned to an older template version keeps that version
until an admin moves it. The default template is upgraded the same way as the
Constitution: only if it is still the untouched version 1.

## AI Build Contract

`GET /api/components/{id}/build-contract[?format=prompt]`

The contract has two blocks that are never mixed:

- `trusted`: the current Constitution, a fixed platform policy and the template baseline. Written by
  the server from code and the Constitution table. No component field can edit
  or remove them.
- `untrusted`: the component's own content (requirements, guardrails, AI
  instructions, dependencies). Passed as data.

In the rendered prompt, trusted text comes first as plain text. Component text
is wrapped in `<component_content>` with angle brackets neutralised, so it
cannot close the block or forge a trusted one, and the prompt states that the
block is data that cannot change the rules above it.

The contract reports `complete` and `missing_required_sections`, and
`context_errors` if something a builder must have is absent. `warnings` flags
instruction text that looks like an override attempt ("ignore previous
instructions", "disable authorization"). That check is a smell test, not a
security control. The control is the structure above.

`content_hash` fingerprints the specification a review was written against: the
Constitution version, template version, every section's text and the set of
dependencies. It deliberately leaves out status, so progress does not
invalidate an approval, and changes whenever the specification or Constitution
changes, so an edit does.

## Compliance review

`POST /api/components/{id}/compliance-reviews` evaluates the component and
stores an **advisory** result. It checks only what the platform can see:

| Check | Source | Possible results |
|---|---|---|
| Specification complete | required sections filled | passed / failed |
| Architecture, API contract | documented | needs review / failed |
| Prerequisite components | dependency graph | passed / failed |
| Automated checks | CI gate | passed / failed |
| QA acceptance | recorded QA decision | passed / failed |
| Open blockers | blockers | passed / failed |
| Security | guardrails written | needs review |
| Acceptance criteria | reviewer verdicts | n/m satisfied |

The platform cannot read the code. Anything that needs a person to judge
whether the implementation conforms is **needs review**, never passed.

The assigned reviewer (or an admin, never the owner) sets a verdict per
acceptance criterion (`PATCH /api/compliance-reviews/{id}/criteria`) and then
approves or rejects (`POST /api/compliance-reviews/{id}/decision`). Approval is
refused while any check has failed, while any criterion has no verdict, and if
the specification or Constitution changed since the review ran. A rejection
needs a note. A decided review is final.

With `APEX_REQUIRE_COMPLIANCE_REVIEW=1`, moving a component to `done` or
`deployed`, or accepting a component in review, needs an approved review whose
fingerprint matches the current contract.

## Migrations

`0004_user_profiles` adds nullable profile columns, `is_active` (existing users
stay active), and timestamps backfilled to the time of migration. No column is
dropped or rewritten, and passwords are untouched. Existing users show empty
profile fields until someone fills them in.

`0005_governance` adds five tables: `component_templates`,
`component_template_versions`, `component_specs`, `constitution_versions`,
`compliance_reviews`. No existing table changes. The first Constitution and the
default template are inserted idempotently at startup, so a database created
before this migration receives them too.

Both migrations downgrade. As always, take a backup before running against a
database that matters. Startup migrates only when `APEX_AUTO_MIGRATE=1`; the
application will not run against a database that has not been migrated.

## Frontend

- Team: with a backend, a directory with department filter, profile drawer
  (private fields shown only when allowed), add and edit forms with per-field
  errors, deactivate and reactivate. Without one, the original demo page.
- Reference: Engineering Constitution and Component templates pages. The Constitution
  page and its sidebar entry have a slow breathing glow (5.2 seconds each way, opacity
  only). With reduced motion on, it is a still halo.
- Component page: a Spec and contract tab with the specification, the Build
  Contract (copyable prompt) and the compliance review.
- Without a backend these pages show a labelled read-only demo copy and nothing
  pretends to save.

## What has been verified

Run:

- Pure-logic tests (`backend/tests/test_profiles.py`, `test_governance_logic.py`):
  58 tests covering validation, template rules, contract assembly, delimiter
  neutralisation, hashing and compliance evaluation.
- Frontend production bundle, and the existing browser audits (layout bounds,
  route sweep, contrast, accessibility) over every route including the new ones.
- The new screens in a browser against a stand-in server shaped like the API:
  roles, private-field visibility, validation errors, versioning and approval
  refusals, and no horizontal scroll at 390px.

Not run in the environment that wrote this, because the Python packages could
not be installed there:

- `backend/tests/test_apex_hq_api.py` (including the slop blocker and baseline
  contract test) and the existing `test_workflow.py`.
- The startup upgrade of an older database (`upgrade_defaults`).
- `alembic upgrade head`, `alembic check`, downgrade, and any PostgreSQL run.

Run them before merging:

```
pip install -r backend/requirements.txt
pytest
cd backend && alembic upgrade head && alembic check && alembic downgrade 0003_assignments_blockers
```
