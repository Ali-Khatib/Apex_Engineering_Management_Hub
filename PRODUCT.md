# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two audiences, weighted equally. Confirmed: neither wins a design trade-off by
default, so a surface that serves one must not cost the other.

- **Engineering leadership.** Zyaad Khader and Farouk Shami, who asked for this
  platform. They arrive with a question about the portfolio as a whole: what is
  at risk, what has no owner, what is waiting on a decision, and whether a build
  order exists. They read far more than they edit.
- **Engineers building components.** They arrive with a question about their own
  work: what is assigned to me, what is blocking it, what has to happen next,
  and who has it now. They edit daily.
- **Ali Khatib**, AI Engineer, builds and maintains the platform.

A third audience reads it without being able to ask anyone: people outside
engineering who have to understand status unaided. They are not a design target
in their own right, but the platform is expected to be legible to them.

## Product Purpose

Track the engineering portfolio of 127 component designs from proposal through
to deployment: who owns each one, how far it has actually got, what has stopped
it, and in what order the library could be built.

Success is that somebody can answer four questions without asking a person:
what is being worked on, who owns it, what is at risk, and what needs attention
next.

## Positioning

*Inferred from the codebase and this project's standing rules; not confirmed by
a user answer. Treat as a working position, open to correction.*

Everything on screen is derived from records at read time rather than entered
and stored, so no two surfaces can disagree and nothing drifts out of step with
the source. Where a record is missing the platform names the gap instead of
filling it. That combination is what a ticket tracker or a spreadsheet does not
give: the status is never somebody's stale opinion, and an absence is visible as
an absence.

The dependency work is the sharper half of it. The platform does not present a
build order that cannot exist; it reports that the library has four tangles and
55 loops, that no component qualifies to go first, and it turns that into
decisions a named person can record.

## Operating Context

- The component library comes from a source sheet dated 20 October. Its eight
  planning waves are the original classification and are never rewritten here.
- Nothing is assigned until architecture review has agreed the approach, which
  is why many components sit selected for a round with nobody on them.
- Work is organised into **rounds**: the set of components selected to be built
  next. Five contributor slots are held open per round.
- Reuse comes before new building. Each component is mapped to the platform
  modules it should extend.
- Independent QA acceptance happens on the exact build, with evidence attached.
- The platform is used alongside GitHub, ERPNext, Slack and Google Drive, which
  remain the systems of record for their own content.

## Capabilities and Constraints

**Confirmed scope**

- 127 component designs, all currently marked design proposals awaiting
  architecture review. None has been built or tested.
- 20 reusable platform modules, SP-01 to SP-20.
- Eight planning waves and seven lifecycle stages, kept as separate dimensions.
  Neither determines the other and neither is ever shown in place of the other.
- Four mutually exclusive ownership states: unassigned, assigned to me, assigned
  to someone else, completed. Ownership is a separate axis from status.
- Three independent readiness gates: automated checks, QA acceptance, deployment
  approval. Passing checks never approves QA; QA acceptance never implies
  deployment readiness.
- 389 recorded dependencies, forming four strongly connected tangles of 41, 3, 2
  and 2 components, holding 55 distinct loops.
- Light theme is the default. The OS preference is deliberately never read: the
  choice is explicit and remembered.

**Technical constraints**

- Frontend only. React 18, TypeScript, Vite, deployed on Vercel. All data is held
  in the browser; there is no backend and no database.
- No UI component library, no CSS framework, no state manager, no charting
  library. Charts, the timeline and the dependency graph are hand-written SVG.
- No horizontal scrolling anywhere, at any width.
- WCAG AA contrast in both themes.

**Explicitly undecided**

- Whether the FastAPI, PostgreSQL and Redis backend specified in
  `docs/webhook-queue-architecture.md` gets built. Until it does, there is no
  real authentication, no GitHub connection and no server-side enforcement of
  the admin rules the interface applies.
- Whether the 8 flagged Platform Next entries are reconciled against their
  Component-additions counterparts, or kept as separate records.

## Brand Commitments

- **Apex AI Arabia.** The platform is internal to the company.
- **Pinned palette, not open to reinterpretation:** workspace `#F8FAF8`, surface
  `#FFFFFF`, navigation `#092D24`, primary `#087A43`, lime `#75D82D`, borders
  `#E2EAE4`, text `#17221D` and `#68756D`.
- **Terminology is load-bearing.** A *Component* is one unit of engineering work
  with one owner and one reviewer; never a "design", a "task" or a "ticket". A
  *Platform module* is SP-01 to SP-20, already built and reusable. A *Round* is
  the set of components selected to be built next.
- **Voice.** Short, direct sentences in normal business English. No em dashes in
  product copy. No marketing language. No generic assistant phrasing.
- **Never invent a fact.** No fabricated policies, standards, APIs, capabilities,
  QA decisions, deployment status, workload figures or test results. Where
  information is missing, say it is missing.
- **Never expose secrets.** No credentials, keys or tokens in any record,
  blocker, comment or committed file.
- **No Claude or Anthropic attribution** anywhere in this repository: not in
  commits, pull requests, release notes or source comments.

## Evidence on Hand

- The source component library and its 127 design packs, each with eight
  architecture views in Mermaid, SVG and PNG, a README and a request schema.
- `docs/integration-audit.md`: the reconciliation of the teammate's apex-erp-mvp
  against this catalogue, with the integration matrix.
- `docs/webhook-queue-architecture.md`: the specified, unbuilt backend.
- Four Playwright audit scripts covering page errors, overflow, contrast and
  accessible names, run across both themes, three widths and every view.

## Open Questions

- Positioning above is inferred rather than confirmed. Worth one sentence from
  Zyaad or Farouk on what this must do that their existing tools do not.
- No approved schedule exists for any component. The platform says so; whether
  one will be recorded is undecided.
- Notifications cover 6 event types; 13 were specified.
