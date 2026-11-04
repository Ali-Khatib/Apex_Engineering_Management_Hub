// Real data: Apex Component Design Library v0.1 (20 Oct 2026) — 127 component designs and the
// SP-01…SP-20 platform modules. Nothing here is invented except the one-line plain-language
// module summaries (written from the module names) and the best-practice pages.
import type { AppState, Person, Project, Component, Practice, Module, HistoryEntry, Notice, Contact, Criterion } from "./types";
import LIB from "./data/library.json";
import { applyDemo } from "./demo";

const DAY = 86400000;
const base = new Date(); base.setHours(0, 0, 0, 0);
const pad = (n: number) => String(n).padStart(2, "0");
export const D = (n: number) => { const d = new Date(base.getTime() + n * DAY + 12 * 3600000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const T = (n: number, h = 10) => { const d = new Date(base.getTime() + n * DAY); d.setHours(h); return d.toISOString(); };
const IMPORTED = "2026-10-20T09:00:00.000Z";

// Platform layers — one clear colour each, used everywhere a layer appears.
export const LAYERS: Record<string, { name: string; short: string; color: string }> = {
  PL01: { name: "Experience & Channels", short: "Experience", color: "#2563EB" },
  PL02: { name: "Workflow & Agent Runtime", short: "Workflow", color: "#7C3AED" },
  PL03: { name: "AI & Intelligence", short: "AI", color: "#DB2777" },
  PL04: { name: "Data & Integration", short: "Data", color: "#0D9488" },
  PL05: { name: "Security & Governance", short: "Security", color: "#B45309" },
  PL06: { name: "Infrastructure & Reliability", short: "Infrastructure", color: "#475569" },
  PL07: { name: "Commercial & Product Ops", short: "Commercial", color: "#4D7C0F" },
  PL08: { name: "Developer Platform & Release", short: "Developer", color: "#0369A1" },
  AF: { name: "App Factory", short: "App factory", color: "#9333EA" },
};
export const LAYER_ORDER = Object.keys(LAYERS);
export const CATEGORIES = LAYER_ORDER.map(k => LAYERS[k].name);
export const layerOf = (c: Component) => LAYER_ORDER.find(k => LAYERS[k].name === c.category) || "PL06";

// Roadmap waves exactly as written in the source sheet, in the order a reader should see them.
export const WAVES: { id: string; label: string; hint: string }[] = [
  { id: "Now", label: "Now", hint: "Selected for the current round" },
  { id: "P0", label: "P0", hint: "Must-have addition" },
  { id: "Next", label: "Next", hint: "Following round" },
  { id: "P1", label: "P1", hint: "Important addition" },
  { id: "Later", label: "Later", hint: "Not yet scheduled" },
  { id: "Gated", label: "Gated", hint: "Needs authorised interfaces or domain approval first" },
  { id: "Architecture decision", label: "Decision needed", hint: "Architecture review before any build" },
  { id: "Not selected", label: "Not selected", hint: "Overlaps another entry; reconcile first" },
];

const people: Person[] = [
  { id: "ali", first: "Ali", last: "Khatib", email: "khatib.ali221@gmail.com", role: "admin", title: "AI Engineer", team: "Engineering", skills: ["Python", "Machine learning", "TypeScript"], hue: 152, joined: D(-300), active: true },
];

// "Source lists" — the four namespaces in the design library (kept in the projects table internally).
const src = (id: string, code: string, name: string, summary: string): Project => ({ id, code, name, client: "Internal", sector: "Design library", summary, leadId: "ali", problem: "", outcome: "", how: [], stack: [], users: "", external: [] });
const projects: Project[] = [
  src("catalog", "C", "Component catalog", "C001–C085. Reusable capabilities, most mapped to an existing SP module to extend."),
  src("add", "ADD", "Component additions", "A21–A48. New capabilities proposed on 20 October with P0/P1/Gated priority."),
  src("pn", "PN", "Platform Next", "Earlier proposals that overlap the additions; reconcile before assigning."),
  src("app", "P", "App generation", "P-01–P-06. Proposals for the client-app factory; architecture decisions first."),
];
const GROUP_TO_SRC: Record<string, string> = { "Catalog": "catalog", "Component additions": "add", "Platform Next": "pn", "App generation": "app" };

const MOD_TEXT: Record<string, [string, string]> = {
  "SP-01": ["Connector SDK", "Toolkit for connecting Apex apps to outside systems such as ERPs, databases and file stores."],
  "SP-02": ["Evaluation harness", "Measures the quality of AI outputs against labelled examples."],
  "SP-03": ["Audit ledger", "A tamper-evident record of who did what, and when."],
  "SP-04": ["Observability & data quality", "Monitoring, logs and checks that incoming data is complete and correct."],
  "SP-05": ["Ingestion jobs", "Brings files and records in, on a schedule or on demand."],
  "SP-06": ["Workflow & cases", "Moves a case through its steps, owners and states."],
  "SP-07": ["Evidence & citations", "Links every answer or decision back to the source it came from."],
  "SP-08": ["Approval authority", "Decides who may approve what, and records each approval."],
  "SP-09": ["Model gateway", "One controlled way to call approved AI models."],
  "SP-10": ["Rules & policy", "Business rules and policies that are checked automatically."],
  "SP-11": ["Entity graph", "Connects people, organisations and records to each other."],
  "SP-12": ["Security & tenancy", "Keeps each client's data separate and access-controlled."],
  "SP-13": ["SLA & calendars", "Deadlines, working days and service-level timers."],
  "SP-14": ["Document pipeline", "Reads documents and extracts their content."],
  "SP-15": ["Decision toolkit", "Scores and recommendations that support a person's decision."],
  "SP-16": ["Search & retrieval", "Finds the right documents and passages quickly."],
  "SP-17": ["Arabic–English language", "Arabic and English text handling, including right-to-left."],
  "SP-18": ["Notifications & channels", "Sends messages by email, SMS and in-app."],
  "SP-19": ["Experience & export", "Shared screens, reports and exports."],
  "SP-20": ["Versioning & snapshots", "Keeps versions of configuration and data so changes can be rolled back."],
};
const modules: Module[] = (LIB as any).modules.map((m: any) => ({ id: m.id, name: MOD_TEXT[m.id]?.[0] || m.slug, description: MOD_TEXT[m.id]?.[1] || "", url: m.url }));

function details(x: any): string {
  const sp = x.sps.length ? x.sps.map((s: string) => `**${s}** ${MOD_TEXT[s]?.[0] || ""}`).join(", ") : "Not yet mapped to an SP module";
  return [
    `## What it does\n\n${x.purpose}`,
    `## Who uses it\n\n${x.users}`,
    `## Builds on\n\n${sp}${x.mapping && !/^SP-[\d/ ,SP-]+$/.test(x.mapping) ? `\n\n_Source note: ${x.mapping}_` : ""}`,
    `## How it works\n\n**Operation:** ${x.op}\n\n| Takes in | Gives back |\n|---|---|\n| ${x.inputs.map((i: string) => "`" + i + "`").join("<br>")} | ${x.outputs.map((i: string) => "`" + i + "`").join("<br>")} |\n\n**Records it keeps:** ${x.entities.join(", ")}`,
    `## When to build it\n\n${x.trigger}`,
    x.constraints ? `## Open questions & constraints\n\n${x.constraints}` : "",
    x.overlap ? `## Overlap review\n\n${x.overlap}` : "",
    `## Source\n\n[Row in the component map](${x.source}) · Design pack \`${x.folder}\``,
  ].filter(Boolean).join("\n\n");
}

const components: Component[] = (LIB as any).components.map((x: any): Component => {
  const crit: Criterion[] = [
    { id: x.id + "-AC1", text: x.acceptance, verification: "Independent QA on the exact build", evidenceType: "Test report", status: "not_started", evidence: [] },
    ...(x.test && x.test !== x.acceptance ? [{ id: x.id + "-AC2", text: x.test, verification: "Failure-case test", evidenceType: "Test report", status: "not_started" as const, evidence: [] }] : []),
    ...(x.metric ? [{ id: x.id + "-AC3", text: x.metric, verification: "Agreed metric", evidenceType: "Documentation link", status: "not_started" as const, evidence: [] }] : []),
  ];
  return {
    id: x.id, name: x.name, category: LAYERS[x.layer].name, projectId: GROUP_TO_SRC[x.group] || "catalog",
    summary: x.purpose, purpose: x.purpose, deliverable: `${x.op}: ${x.inputs.join(", ")} → ${x.outputs.join(", ")}`,
    details: details(x),
    ownerId: null, reviewerId: null, qaId: null, priority: "medium", status: "not_started", review: "none",
    start: "", due: "", eta: "", deps: x.deps.filter((d: string) => (LIB as any).components.some((y: any) => y.id === d)),
    repoId: null, products: [], skills: [], criteria: crit,
    gates: { checks: { state: "unknown" }, qa: { state: "not_submitted" }, deploy: { state: "not_ready" } },
    onboarding: { branch: "—", folders: [], setup: x.start || "", env: [], tools: [] },
    links: [{ id: x.id + "-src", kind: "sheets", label: "Component map row", url: x.source, ref: x.id }],
    architecture: [], comments: [],
    createdAt: IMPORTED, updatedAt: IMPORTED,
    lib: { group: x.group, layer: x.layer, wave: x.wave, sps: x.sps, users: x.users, source: x.source, mapping: x.mapping, op: x.op, inputs: x.inputs, outputs: x.outputs, entities: x.entities, trigger: x.trigger, constraints: x.constraints, metric: x.metric, test: x.test, overlap: x.overlap, folder: x.folder, diagrams: x.diagrams },
  };
});

const practices: Practice[] = [
  { id: "bp-git", title: "Branching and commit conventions", category: "Git workflows", ownerId: "ali", technologies: ["Git", "GitHub"], updatedAt: T(-12), updatedBy: "ali", reviewedAt: T(-12), nextReview: D(78), override: null,
    summary: "Trunk-based development with short-lived branches and Conventional Commits.",
    body: `## Rules\n\n1. Branch from \`main\`. Name branches \`feature/<component-id>-<short-name>\`, \`fix/...\` or \`chore/...\`.\n2. Keep branches under three days old. Rebase on \`main\` before requesting review.\n3. Use [Conventional Commits](https://www.conventionalcommits.org): \`feat(scope): summary\`, \`fix\`, \`docs\`, \`test\`, \`chore\`, \`refactor\`, \`perf\`.\n4. Reference the component ID in the pull request title, for example \`C015: add provider fallback\`.\n\n## Example\n\n\`\`\`text\nfeat(gateway): add approved provider fallback\n\nFalls back only to approved destinations when a provider fails.\nRefs: C015\n\`\`\`\n\n## Why\n\nShort branches keep merges small and reviews fast. Consistent messages let release notes and the platform's activity timeline be generated automatically.` },
  { id: "bp-pr", title: "Pull request and code review guidelines", category: "Pull request guidelines", ownerId: "ali", technologies: ["GitHub"], updatedAt: T(-40), updatedBy: "ali", reviewedAt: T(-95), nextReview: D(-5), override: null,
    summary: "How to size, describe and review pull requests.",
    body: `## Authors\n\n- Keep PRs under ~400 changed lines. Split refactors from behaviour changes.\n- Fill in the template: what changed, why, how it was tested, screenshots for UI.\n- Required checks must be green before requesting review.\n\n## Reviewers\n\n- First response within one working day.\n- Use **Request changes** only for correctness, security or contract issues. Style goes in suggestions.\n- Approve means you would be comfortable supporting this code in production.\n\n| Size | Lines changed | Expected review time |\n|---|---|---|\n| S | < 100 | same day |\n| M | 100–400 | 1 day |\n| L | > 400 | split it |` },
  { id: "bp-test", title: "Testing standards", category: "Testing standards", ownerId: "ali", technologies: ["pytest", "Go test", "Playwright", "k6"], updatedAt: T(-20), updatedBy: "ali", reviewedAt: T(-20), nextReview: D(70), override: null,
    summary: "Minimum test expectations per component type and how evidence is attached.",
    body: `## Minimums\n\n| Component type | Unit | Integration | E2E | Load |\n|---|---|---|---|---|\n| API service | 80% new code | Contract tests | Smoke | k6 at 2× expected peak |\n| ML service | Pre/post-processing | Benchmark harness | Smoke | GPU throughput test |\n| Web application | Components | API mocks | Playwright critical paths | — |\n| Infrastructure | — | Terratest | Install runbook | — |\n\n## Evidence\n\nAttach the CI artifact link or exported report to the matching acceptance criterion. A green CI run is **not** QA acceptance; QA records acceptance separately.` },
  { id: "bp-sec", title: "Secrets and credentials", category: "Security guidelines", ownerId: "ali", technologies: ["Vault", "Kubernetes"], updatedAt: T(-140), updatedBy: "ali", reviewedAt: T(-140), nextReview: D(-50), override: null,
    summary: "Where secrets live, how services get them, and what never goes in chat or tickets.",
    body: `## Never\n\n- Commit secrets, even to private repositories.\n- Paste credentials in Slack, ERPNext, blockers or comments on this platform.\n\n## Always\n\n- Store secrets in Vault under \`secret/<env>/<service>\`.\n- Services authenticate with the Kubernetes auth method; no static tokens.\n- Document environment variables by **name and purpose** only.\n\n> This page is overdue for review: it predates the move to dynamic database credentials.` },
  { id: "bp-api", title: "API design conventions", category: "API development", ownerId: "ali", technologies: ["OpenAPI", "REST"], updatedAt: T(-30), updatedBy: "ali", reviewedAt: T(-30), nextReview: D(60), override: null,
    summary: "Resource naming, versioning, errors and pagination for every HTTP API.",
    body: `## Conventions\n\n- Version in the path: \`/v1/...\`. Breaking changes need a new version.\n- Plural nouns for collections, kebab-case paths, camelCase JSON.\n- Errors follow RFC 9457 problem details with an Arabic and English \`title\`.\n- Cursor pagination: \`?cursor=...&limit=50\`, response includes \`nextCursor\`.\n\n\`\`\`json\n{\n  "type": "https://errors.apexaiarabia.com/validation",\n  "title": "Invalid national ID",\n  "titleAr": "رقم الهوية غير صالح",\n  "status": 422\n}\n\`\`\`` },
  { id: "bp-deploy", title: "Deploying to client environments", category: "Deployment procedures", ownerId: "ali", technologies: ["Helm", "RKE2"], updatedAt: T(-8), updatedBy: "ali", reviewedAt: T(-8), nextReview: D(5), override: null,
    summary: "Change requests, release windows and rollback for on-prem deployments.",
    body: `## Before a deployment\n\n1. All three readiness gates are green on the component page: **Checks passed**, **QA accepted**, **Ready for deployment**.\n2. Change request approved by the client's CAB.\n3. Rollback plan tested on the replica environment.\n\n## During\n\n- Deploy with the signed release tag only.\n- Keep the deployment channel open and post each step.\n\n## After\n\n- Record the deployment on the component page and attach the release notes as evidence.` },
  { id: "bp-ml", title: "ML model release checklist", category: "AI/ML development standards", ownerId: "ali", technologies: ["PyTorch", "Triton", "vLLM"], updatedAt: T(-25), updatedBy: "ali", reviewedAt: T(-60), nextReview: D(30), override: "under_revision",
    summary: "Benchmarks, model cards and reproducibility requirements before a model ships.",
    body: `## Required for every model release\n\n- Benchmark on the frozen evaluation set, with the command and commit recorded.\n- Model card: intended use, data sources, known limitations, Arabic dialect coverage.\n- Weights stored in the model registry with a checksum.\n- Serving config pinned to a model version.\n\n_Being revised to add evaluation requirements for generative models._` },
  { id: "bp-docs", title: "Documentation standards", category: "Documentation standards", ownerId: "ali", technologies: ["Markdown"], updatedAt: T(-15), updatedBy: "ali", reviewedAt: T(-15), nextReview: D(75), override: null,
    summary: "What every repository and component must document, and where.",
    body: `Every repository has a README with getting-started steps that work on a clean machine, a \`docs/\` folder with design notes, and runbooks for anything that runs in production.\n\nEvery component page on this platform keeps the purpose, deliverable, dependencies and acceptance criteria current. If the plan changes, update the page first and then announce it.` },
];

const history: HistoryEntry[] = [
  { id: "h-import", entity: "plan", entityId: "library", action: "Imported Component Design Library v0.1", to: "127 designs · SP-01–SP-20", by: "ali", at: IMPORTED, source: "apex" },
];
const notices: Notice[] = [
  { id: "n-welcome", to: "ali", kind: "assignment", title: "Design library imported", body: "54 components are marked Now and none has an owner yet.", at: T(0, 9), read: false },
];
const contacts: Contact[] = [
  { id: "ct1", topic: "Architecture, reuse & sequencing", description: "Marjan coordinates architecture, reuse decisions, sequencing and where new contributors start.", personId: "ali", channel: "Ask Marjan" },
  { id: "ct2", topic: "Security approval", description: "Zyaad selects the security approver for components that need one.", personId: "ali", channel: "Ask Zyaad" },
  { id: "ct3", topic: "This platform", description: "Access, data on this site, and how to use it.", personId: "ali", channel: "#engineering" },
];

export function seedState(): AppState {
  return applyDemo({
    version: 8, people, projects, modules, components, repos: [], blockers: [], handoffs: [], practices, milestones: [], history, notices,
    about: {
      vision: "Apex AI Arabia helps Saudi organisations plan, build and operate secure enterprise AI systems inside their own environments. This site is the single place to see what is already built, what is designed next, who owns it, and whether it is ready.",
      overview: "### Three things to know\n\n1. **Platform modules (SP-01 to SP-20)** are what we have already built. They are shared building blocks.\n2. **The component library** holds 127 design proposals. Most extend an SP module rather than starting from scratch.\n3. **The roadmap** shows which designs are selected now, next, or need a decision first.\n\n### Rules from the design library\n\n- Every design is a proposal until architecture review approves it. Nothing has been built or tested from these designs yet.\n- Reuse the mapped SP module before creating anything new.\n- Independent QA, exact-build evidence, integration and production acceptance are separate gates.\n- Keep five contributor slots reserved per round.\n\n### AI features\n\nPlanned for version 2.",
      updatedAt: IMPORTED, updatedBy: "ali",
    },
    contacts,
    plan: { notes: "## First review pass\n\n1. Select a proof workflow and reuse the smallest necessary set.\n2. Reconcile C/SP, PN/ADD and P/catalog overlaps.\n3. Approve contract owner, typed schemas, deployment/data boundary and acceptance evidence.\n4. Place contributors into bounded packages with dependencies and fixtures available.\n5. Verify independent QA, consumer integration, rollback and documentation on exact artifacts.\n\n_From the Component Design Library README, 20 October 2026._", updatedAt: IMPORTED, updatedBy: "ali" },
    graphPos: {}, cycleDecisions: {}, me: null,
  });
}
