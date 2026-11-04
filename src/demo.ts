// ─────────────────────────────────────────────────────────────────────────────
// DEMO LAYER
//
// The component library (127 designs, 20 modules) is real. Nothing in this file
// is. It exists so the platform can explain itself: without a team, assignments,
// blockers and reviews in flight, every screen is an empty table and nobody can
// tell what the product is for.
//
// Everything here is deterministic — same data on every load, so a walkthrough
// can be repeated. Signing in as any demo person is marked clearly in the UI,
// and "Reset data" puts it all back.
// ─────────────────────────────────────────────────────────────────────────────
import type { AppState, Person, Component, Blocker, Handoff, Milestone, Repo, Status } from "./types";

// Local date helpers — deliberately not imported from seed.ts, which imports this file.
const midnight = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const pad = (n: number) => String(n).padStart(2, "0");
const D = (n: number) => { const d = new Date(midnight().getTime() + n * 86400000 + 12 * 3600000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const T = (n: number, h = 10) => new Date(midnight().getTime() + n * 86400000 + h * 3600000).toISOString();

/** The demo team. `ali` already exists in the seed as the signed-in admin. */
export const DEMO_PEOPLE: Person[] = [
  { id: "zyaad", first: "Zyaad", last: "Al-Harbi", email: "zyaad@apexaiarabia.com", role: "admin", title: "Head of Engineering", team: "Engineering", skills: ["Architecture", "Kubernetes", "Go"], hue: 168, joined: D(-420), active: true },
  { id: "farouk", first: "Farouk", last: "Mansour", email: "farouk@apexaiarabia.com", role: "admin", title: "QA Lead", team: "Quality", skills: ["Test automation", "Playwright", "k6"], hue: 28, joined: D(-380), active: true },
  { id: "lina", first: "Lina", last: "Haddad", email: "lina@apexaiarabia.com", role: "member", title: "Senior Backend Engineer", team: "Platform", skills: ["Go", "Postgres", "gRPC"], hue: 282, joined: D(-240), active: true },
  { id: "omar", first: "Omar", last: "Siddiqui", email: "omar@apexaiarabia.com", role: "member", title: "Platform Engineer", team: "Platform", skills: ["Terraform", "RKE2", "Vault"], hue: 206, joined: D(-190), active: true },
  { id: "maya", first: "Maya", last: "Qasim", email: "maya@apexaiarabia.com", role: "member", title: "Frontend Engineer", team: "Experience", skills: ["TypeScript", "React", "Design systems"], hue: 332, joined: D(-150), active: true },
  { id: "rami", first: "Rami", last: "Nasser", email: "rami@apexaiarabia.com", role: "member", title: "Graduate Engineer", team: "Platform", skills: ["Python"], hue: 96, joined: D(-9), active: true },
];

/** Who you can sign in as, and what each one is there to show you. */
export const DEMO_ACCOUNTS: { id: string; shows: string }[] = [
  { id: "zyaad", shows: "The management view: the whole portfolio, every blocker, who is overloaded and what is late." },
  { id: "ali", shows: "An admin who also builds. Owns four components and can reassign anyone." },
  { id: "farouk", shows: "Quality. Everything waiting on QA acceptance or a deployment decision." },
  { id: "lina", shows: "A senior engineer mid-build, with a blocked component and a review waiting on her." },
  { id: "maya", shows: "An engineer whose work has passed review and is queued for deployment." },
  { id: "rami", shows: "A brand-new joiner with nothing assigned yet, so you can see what an empty account looks like." },
];

const ENGINEERS = ["ali", "lina", "omar", "maya"];

/**
 * Puts a slice of the library into flight. Deterministic: components are taken
 * in their library order so the same 34 are always the live ones.
 */
export function applyDemo(state: AppState): AppState {
  state.people = [...state.people, ...DEMO_PEOPLE];

  const by = (id: string) => state.components.find(c => c.id === id);
  const picked = state.components.filter(c => c.lib.wave === "Now").slice(0, 26);
  const extra = state.components.filter(c => !picked.includes(c) && c.deps.length === 0).slice(0, 8);
  const live = [...picked, ...extra];

  // Spread statuses so every column of every table has something in it.
  const PLAN: { status: Status; n: number }[] = [
    { status: "completed", n: 5 },
    { status: "under_review", n: 6 },
    { status: "in_progress", n: 11 },
    { status: "blocked", n: 3 },
    { status: "not_started", n: 9 },
  ];
  let i = 0;
  const repoIds = ["apex-platform-core", "apex-connectors", "apex-agent-runtime", "apex-console"];

  for (const { status, n } of PLAN) {
    for (let k = 0; k < n && i < live.length; k++, i++) {
      const c = live[i];
      const owner = ENGINEERS[i % ENGINEERS.length];
      c.ownerId = owner;
      c.reviewerId = owner === "lina" ? "zyaad" : "lina";
      c.qaId = "farouk";
      c.repoId = repoIds[i % repoIds.length];
      c.status = status;
      c.priority = i % 7 === 0 ? "critical" : i % 3 === 0 ? "high" : i % 5 === 0 ? "low" : "medium";
      c.start = D(-30 + (i % 20));
      // A handful are deliberately overdue, so "needs attention" is never empty.
      c.due = D(i % 9 === 0 ? -(3 + (i % 6)) : 6 + (i % 34));
      c.eta = status === "completed" ? c.due : D(i % 9 === 0 ? 4 + (i % 5) : 5 + (i % 36));
      c.updatedAt = T(-(i % 11) - 1, 9 + (i % 8));

      if (status === "completed") {
        c.review = "accepted";
        c.gates = { checks: { state: "passed", at: T(-4) }, qa: { state: "accepted", by: "farouk", at: T(-3), note: "Verified on the exact build." }, deploy: { state: "deployed", by: "zyaad", at: T(-2) } };
      } else if (status === "under_review") {
        c.review = k % 3 === 0 ? "changes_requested" : "in_review";
        c.gates = {
          checks: { state: k % 4 === 0 ? "failed" : "passed", at: T(-1) },
          qa: { state: k % 2 === 0 ? "awaiting" : "in_progress", at: T(-1) },
          deploy: { state: k === 1 ? "ready" : "pending_review" },
        };
      } else if (status === "in_progress") {
        c.review = "none";
        c.gates = { checks: { state: k % 3 === 0 ? "running" : k % 5 === 0 ? "failed" : "passed", at: T(0, 8) }, qa: { state: "not_submitted" }, deploy: { state: "not_ready" } };
      } else if (status === "blocked") {
        c.review = "none";
        c.gates = { checks: { state: "failed", at: T(-2) }, qa: { state: "not_submitted" }, deploy: { state: "not_ready" } };
      } else {
        c.gates = { checks: { state: "unknown" }, qa: { state: "not_submitted" }, deploy: { state: "not_ready" } };
      }

      // First acceptance criterion gets evidence once work is under review.
      if ((status === "under_review" || status === "completed") && c.criteria[0]) {
        c.criteria[0].evidence = [{ id: c.id + "-ev1", kind: "test", label: "QA test report", ref: `reports/${c.id.toLowerCase()}-qa.html`, by: owner, at: T(-5), version: 1, decision: status === "completed" ? "approved" : undefined, reviewerId: status === "completed" ? "farouk" : undefined, reviewedAt: status === "completed" ? T(-3) : undefined }];
        c.criteria[0].status = status === "completed" ? "accepted" : "submitted";
      }
    }
  }

  const blocked = live.filter(c => c.status === "blocked");
  const B = (n: number, c: Component, title: string, description: string, category: string, severity: Blocker["severity"], responsibleId: string, nextAction: string, target: number): Blocker => ({
    id: `BLK-${String(n).padStart(3, "0")}`, componentId: c.id, title, description, category, severity,
    responsibleId, reportedBy: c.ownerId || "ali", nextAction, target: D(target),
    status: severity === "critical" ? "escalated" : "open", createdAt: T(-(n + 2)), updatedAt: T(-n),
  });
  state.blockers = [
    blocked[0] && B(1, blocked[0], "Waiting on the client's identity provider", "The customer's SSO team has not issued a test tenant, so authenticated interface work cannot be verified end to end.", "External dependency", "critical", "zyaad", "Zyaad to escalate with the client's IT director on the Thursday call.", 4),
    blocked[1] && B(2, blocked[1], "Schema contract not agreed", "Two consumers expect different field names for the same entity. Building either way forces a rewrite of the other.", "Architecture decision", "high", "lina", "Architecture review to pick one contract and record it as the owner of the schema.", 7),
    blocked[2] && B(3, blocked[2], "No staging environment with real volumes", "Throughput cannot be measured against the agreed metric on the current staging cluster.", "Environment", "medium", "omar", "Omar to provision an RKE2 staging node pool sized to production.", 12),
    by("C036") && B(4, by("C036")!, "Role model needs sign-off before build", "Permissions cross three teams. Building before the role model is agreed risks a security rework.", "Approval", "high", "zyaad", "Circulate the role matrix and get written approval from Security.", 9),
    by("C040") && B(5, by("C040")!, "Audit retention period unconfirmed", "Retention drives storage design. The client's legal team has not answered.", "External dependency", "medium", "farouk", "Farouk to chase legal; assume 7 years as the working answer meanwhile.", 15),
  ].filter(Boolean) as Blocker[];
  for (const b of state.blockers) { const c = by(b.componentId); if (c && c.status !== "blocked") c.status = "blocked"; }

  const ho = live.find(c => c.ownerId === "omar" && c.status === "in_progress");
  if (ho) {
    state.handoffs = [{
      id: "HO-001", componentId: ho.id, fromId: "ali", toId: "omar", status: "awaiting_ack",
      reason: "Ali is moving onto the agent runtime work for this round.",
      completed: "Schema drafted, connector stub merged, local fixtures in place.",
      outstanding: "Throughput test against the agreed metric, and the failure-case test.",
      knownIssues: "Retries are not idempotent yet, so a duplicate write is possible on timeout.",
      checklist: [
        { id: "h1", text: "Walkthrough call completed", done: true },
        { id: "h2", text: "Repository access confirmed", done: true },
        { id: "h3", text: "Local environment runs the test suite", done: false },
        { id: "h4", text: "Open questions written up on the component page", done: false },
      ],
      target: D(5), createdAt: T(-3), by: "ali",
    } as Handoff];
  }

  state.milestones = [
    { id: "ms-1", name: "Architecture review complete", date: D(-6), description: "Contract owner, typed schemas and the deployment boundary agreed for every component selected this round.", componentIds: live.slice(0, 6).map(c => c.id) },
    { id: "ms-2", name: "Proof workflow running end to end", date: D(11), description: "One complete workflow demonstrable on staging, using only reused SP modules plus this round's components.", componentIds: live.slice(0, 12).map(c => c.id) },
    { id: "ms-3", name: "Independent QA pass", date: D(29), description: "Every component in the round has QA acceptance on the exact build, with evidence attached.", componentIds: live.slice(0, 20).map(c => c.id) },
    { id: "ms-4", name: "First client environment", date: D(58), description: "Deployed inside a customer environment with rollback rehearsed and documentation handed over.", componentIds: live.map(c => c.id) },
  ] as Milestone[];

  const repo = (id: string, name: string, description: string, ownerId: string, langs: string[], fw: string[], ci: Repo["ci"]): Repo => ({
    id, name, org: "apex-ai-arabia", url: `https://github.com/apex-ai-arabia/${name}`, description,
    defaultBranch: "main", visibility: "private", languages: langs, frameworks: fw,
    ownerId, reviewerId: "zyaad", pmId: "zyaad", access: "connected",
    accessNote: "Read-only app install. Write access stays with each repository's owner.",
    ci, workflow: ".github/workflows/ci.yml",
    env: { dev: "dev.internal", staging: "staging.internal", prod: "Client environment" },
    build: "make build", test: "make test", products: [], services: [],
    createdAt: T(-300),
    github: { readme: description, commits: [], prs: [], issues: [], runs: [], branches: ["main", "develop"], contributors: ENGINEERS },
  });
  state.repos = [
    repo("apex-platform-core", "apex-platform-core", "Shared platform services: schema registry, audit trail, identity and the module runtime.", "lina", ["Go", "SQL"], ["gRPC", "Postgres"], "passed"),
    repo("apex-connectors", "apex-connectors", "Connector SDK and the published connectors for ERPs, databases and file stores.", "omar", ["Go", "Python"], ["Connector SDK"], "passed"),
    repo("apex-agent-runtime", "apex-agent-runtime", "Workflow and agent runtime: orchestration, tool calling, evaluation harness.", "ali", ["Python"], ["FastAPI", "vLLM"], "failed"),
    repo("apex-console", "apex-console", "The operator console and every customer-facing interface.", "maya", ["TypeScript"], ["React", "Vite"], "passed"),
  ];

  for (const p of state.practices) if (p.id === "bp-test" || p.id === "bp-deploy") p.ownerId = "farouk";

  // Notifications for whoever signs in, so the bell is never empty.
  state.notices = [];
  const n = (to: string, kind: any, title: string, body: string, componentId: string | undefined, age: number) =>
    state.notices.push({ id: `nt-${state.notices.length}`, to, kind, title, body, componentId, at: T(-age, 11), read: age > 3 });
  const forReview = live.filter(c => c.status === "under_review");
  if (forReview[0]) n("lina", "review", `Review requested: ${forReview[0].name}`, `${forReview[0].id}, submitted by Ali Khatib.`, forReview[0].id, 0);
  if (forReview[1]) n("farouk", "review", `QA requested: ${forReview[1].name}`, "Required checks have passed. Evidence attached.", forReview[1].id, 1);
  if (blocked[1]) n("lina", "blocker", "Blocker assigned to you", "BLK-002 Schema contract not agreed", blocked[1].id, 1);
  if (blocked[0]) n("zyaad", "blocker", "Escalated blocker", "BLK-001 Waiting on the client's identity provider", blocked[0].id, 0);
  if (ho) n("omar", "handoff", `Handoff to you: ${ho.name}`, "Review the checklist and acknowledge it.", ho.id, 3);
  const overdue = live.find(c => c.due < D(0) && c.status !== "completed");
  if (overdue) n(overdue.ownerId!, "deadline", `${overdue.name} is past its due date`, `Due ${overdue.due}. Set a new ETA or raise a blocker.`, overdue.id, 2);
  n("zyaad", "review", "Four components are ready for a deployment decision", "They have passed checks and QA acceptance.", undefined, 1);
  n("rami", "assignment", "Welcome to the platform", "You have no components assigned yet. An admin will assign your first one.", undefined, 0);

  return state;
}
