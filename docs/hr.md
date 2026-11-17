# HR (onboarding, offboarding, candidates)

HR is a native part of Apex HQ. It reuses the HQ sign-in, the HQ users and the HQ design system. It is not a second app. Everything below is stored and enforced by the backend. The browser keeps no HR data; the only thing in browser storage is the existing HQ sign-in token.

## Where things are

| Page | Route | Who |
|---|---|---|
| HR overview | `#hr` | Everyone. Counts and the "Needs attention" list are scoped to what the viewer may see. |
| Directory | `#team` | Everyone. Adds a Lifecycle column, separate from Login. |
| Candidates | `#candidates`, `#cand-<id>` | Admins |
| Onboarding | `#onboarding`, `#onb-<id>` | Case owners, managers, task owners, admins |
| Offboarding | `#offboarding`, `#off-<id>` | Same |
| Candidate page (public) | `#candidate=<token>` | The candidate, with a link and a one-time code. No HQ account. |

Code: `backend/app/hr.py` (pure rules), `hr_service.py` (database + permissions), `hr_candidates.py`, `hr_api.py`, `hr_integrations.py`; `src/hr.ts`, `src/pages/people.tsx`, `src/pages/candidate.tsx`. Migration `0006_people_hr`.

## Source of truth

| Data | Owned by | Notes |
|---|---|---|
| Person identity, login, role | HQ `users` (unchanged) | New nullable `users.manager_id`. A candidate with no account is a `hr_candidates` row, linked to a user later without losing history. |
| Lifecycle status | Derived from cases | active / onboarding / offboarding / departed. **Not** login access. Finishing an offboarding does not deactivate anyone. |
| Candidate assessment, submission, receipt, decision | HQ `hr_candidates`, `hr_submissions` | Ported from the standalone HR portal, which delegated all of it to an external service that is not in this repo. Codes and tokens are stored as keyed hashes. Timestamps come from the server clock. |
| Case, tasks, approvals, history | HQ `hr_cases`, `hr_tasks`, `hr_events` | Optimistic `version` on cases and tasks. A repeated `request_id` is a no-op. |
| Engineering ownership | HQ components, unchanged | Handover changes owner, reviewer, QA or blocker responsibility through the same rules as the component page. Finished work (`done`, `deployed`) is never touched. |
| Checklist template | HQ `hr_templates` | Cases copy it at creation. Editing it never rewrites a live case. |
| ERP, VPN, Slack, Calendar, contracts | Not connected | Every adapter reports `not_configured`. A step bound to one is finished by a person who records how they confirmed it. It then shows "Confirmed by hand", never "Confirmed". |

## Permissions

Enforced in `hr_service.py` for direct URLs, lists, counts, mutations and history. Someone with no access gets **404**, so a case's existence is not disclosed.

| | Admin | Case owner | Manager (of the person) | Task owner | Other |
|---|---|---|---|---|---|
| See case and all tasks | yes | yes | yes | header + own tasks only | no |
| Start, approve, reject, complete, reopen, cancel | yes | no | no | no | no |
| Request final review, edit tasks, owners, due dates | yes | yes | no | own tasks only | no |
| Restricted reason and notes | yes | no | no | no | no |
| Skip a required task, record a handover exception | yes | no | no | no | no |
| Candidate submissions and decisions | yes | no | no | no | no |

Being a reviewer or QA contact on engineering work gives no access here. HR history lives in `hr_events`, not the general audit feed that every member can read. The only thing written to a component's history is a neutral line such as "reassigned owner: A → B", with no reason.

## What was kept, adapted and left out

Kept from the HR portal: invitation link and one-time code, assessment brief and deadline, text and repository submission, receipt, approve / reject / cancel / extend / reissue, history, rate limiting on code attempts.
Adapted: the deadline starts at first sign-in on the server clock; an approved candidate carries into onboarding without re-entering identity or being approved twice; the candidate session uses its own header and is never an HQ token.
Left out on purpose: the dummy contract page (it would imply a signed agreement that does not exist); candidate-facing VPN, ERP and Slack screens (nothing is connected, so they would be fake); file uploads (text and a GitHub link only); email delivery (not configured, so the admin is shown the link and code once and shares them).

## Offboarding handover

Starting a case lists what the person holds: unfinished components (owner, reviewer, QA) and open blockers. "Check again" adds new holdings and reopens items that drifted back. Nothing is reassigned for you. Completion is refused while any item is unresolved, unless an admin recorded an exception with a reason of at least 10 characters. The built-in "Engineering handover" task completes itself from the items.

## Configuration and deployment

No new environment variable. Apply the migration with `alembic upgrade head`, or start once with `APEX_AUTO_MIGRATE=1`. Default checklists are seeded at startup if absent and are never overwritten. Candidate codes and tokens are hashed with `JWT_SECRET`, so rotating it invalidates open invitations (reissue them). No seed contains real people or secrets.
