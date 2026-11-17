/**
 * Sample People data for the hosted demo, which has no backend. Invented names, read-only, and labelled as sample
 * wherever it is shown. It is never used when a backend is configured.
 */
const ref = (id: number, name: string) => ({ id, name });
const t = (id: number, o: any = {}) => ({
  id, key: "k" + id, title: o.title, instructions: o.instr || "", category: o.cat || "Accounts", required: o.req ?? true, owner: ref(2, "Sample Owner"),
  due_date: o.due || "2026-11-24", status: o.status || "not_started", version: 1, integration: o.integ || "none", confirmation: o.conf || (o.integ ? "not_configured" : "not_applicable"),
  confirmed_by: null, confirmed_at: null, evidence_note: o.ev || "", blocked_reason: o.br || "", skip_reason: "", completed_by: o.by || null, completed_at: o.by ? "2026-11-12T09:00:00Z" : null,
  system_key: o.sys || null, overdue: !!o.over, mine: false, editable: false, can_manage: false,
});
const row = (id: number, kind: "onboarding" | "offboarding", o: any) => ({
  id, kind, stage: o.stage, stage_label: o.label, version: 1, person: { user_id: null, candidate_id: null, name: o.name }, role_title: o.role, department: "Platform", manager: ref(1, "Sample Manager"),
  owner: ref(2, "Sample Owner"), anchor_date: o.date, progress: o.progress, next_action: o.next, overdue: o.overdue || 0, blocked: o.blocked || 0, pending_handover: o.pending || 0, access: "full", created_at: "2026-11-01T00:00:00Z",
});
const prog = (d: number, tt: number) => ({ done: d, total: tt, required_done: d, required_total: tt, percent: Math.round((d / tt) * 100) });
const ON = row(1, "onboarding", { stage: "in_progress", label: "In progress", name: "Sample Newhire", role: "Backend Engineer", date: "2026-11-24", progress: prog(4, 9), overdue: 1, blocked: 1,
  next: { task_id: 3, title: "Request VPN access", owner: ref(2, "Sample Owner"), due_date: "2026-11-19", blocked: true } });
const ON2 = row(3, "onboarding", { stage: "awaiting_approval", label: "Awaiting approval", name: "Sample Joiner", role: "QA Engineer", date: "2026-12-01", progress: prog(0, 9), next: null });
const OFF = row(2, "offboarding", { stage: "in_progress", label: "In progress", name: "Sample Leaver", role: "Frontend Engineer", date: "2026-11-30", progress: prog(2, 7), pending: 2,
  next: { task_id: 9, title: "Engineering handover", owner: ref(2, "Sample Owner"), due_date: "2026-11-28", blocked: false } });
const onTasks = [t(1, { title: "Create the HQ account", status: "completed", by: "Sample Owner" }), t(2, { title: "Add to the engineering channel", cat: "Accounts", integ: "slack", status: "completed", conf: "manually_confirmed", ev: "Checked in Slack admin by Sample Owner", by: "Sample Owner" }),
  t(3, { title: "Request VPN access", integ: "vpn", status: "blocked", br: "Waiting on the network team to approve the request", over: true, due: "2026-11-16" }), t(4, { title: "Order a laptop", cat: "Equipment", req: false }), t(5, { title: "Assign a first component and a buddy", cat: "First week" })];
const offTasks = [t(7, { title: "Confirm last working day with the manager", cat: "Planning", status: "completed", by: "Sample Owner" }), t(8, { title: "Remove VPN access", cat: "Access", integ: "vpn" }), t(9, { title: "Engineering handover", cat: "Handover", sys: "handover"})];
const detail = (r: any, tasks: any[], extra: any) => ({ ...r, tasks, limited: false, status_text: extra.status, can_edit: false, can_reassign: false, can_manage: false, person_account: { active: true },
  actions: [], blockers_to_complete: extra.blockers, approval: { approved: true, by: "Sample Admin", at: "2026-11-02T10:00:00Z" }, events: extra.events, handover: extra.handover || null, restricted: undefined, candidate: null });
const comp = (id: number, code: string, name: string) => ({ id, code, name, status: "in_progress" });
const item = (id: number, role: string, status: string, code: string, name: string, to: string | null) => ({ id, type: "component", role, status, component: comp(id, code, name), blocker: null, from: ref(5, "Sample Leaver"), to: to ? ref(6, to) : null, exception_reason: "", decided_by: null, decided_at: null, accepted_by: null, accepted_at: null });
const CASES: Record<number, any> = {
  1: detail(ON, onTasks, { status: "1 task is blocked. 4 of 9 required tasks are finished.", blockers: ["5 required tasks are not finished."], events: [{ id: 2, action: "case.approve", actor: "Sample Admin", from_stage: "awaiting_approval", to_stage: "ready", detail: "", restricted: false, created_at: "2026-11-02T10:00:00Z" }, { id: 1, action: "case.start", actor: "Sample Admin", from_stage: null, to_stage: "awaiting_approval", detail: "onboarding case started", restricted: false, created_at: "2026-11-01T10:00:00Z" }] }),
  2: detail(OFF, offTasks, { status: "2 engineering handover items still need a replacement. 2 of 7 required tasks are finished.", blockers: ["2 handover items still need a replacement."], events: [{ id: 1, action: "case.start", actor: "Sample Admin", from_stage: null, to_stage: "in_progress", detail: "offboarding case started", restricted: false, created_at: "2026-11-10T10:00:00Z" }],
    handover: { items: [item(1, "owner", "pending", "C015", "Provider fallback", null), item(2, "reviewer", "reassigned", "C030", "Audit export", "Sample Colleague")], pending: 1, reassigned: 1, accepted: 0, exceptions: 0 } }),
  3: detail(ON2, onTasks.map(x => ({ ...x, status: "not_started", by: null, overdue: false, br: "" })), { status: "Waiting for an admin to approve. No task can be finished until then.", blockers: [], events: [] }),
};
const CAND = { id: 1, name: "Sample Candidate", email: "candidate@example.test", role_title: "Backend Engineer", stage: "submitted", view: "submitted", stage_label: "Submitted, awaiting review", version: 1, assessment_title: "Build a rate limiter", assessment_hours: 48,
  first_sign_in_at: "2026-11-10T09:00:00Z", deadline_at: "2026-11-12T09:00:00Z", submitted: true, received_at: "2026-11-11T09:00:00Z", created_at: "2026-11-09T09:00:00Z", onboarding_case_id: null };
const CAND2 = { ...CAND, id: 2, name: "Sample Applicant", email: "applicant@example.test", stage: "invited", view: "invited", stage_label: "Invited", first_sign_in_at: null, deadline_at: null, submitted: false, received_at: null };
const tpl = (k: string, title: string, o: any = {}) => ({ key: k, title, instructions: "", category: "General", required: true, integration: "none", owner: "case_owner", offset_days: 0, ...o });

export function demoRoute(path: string): unknown {
  const [p, q = ""] = path.split("?"); const qs = new URLSearchParams(q);
  if (p === "/hr/overview") return { counts: { onboarding: 2, offboarding: 1, awaiting_approval: 1, overdue_tasks: 1, blocked_tasks: 1, candidates_awaiting_review: 1, candidates_open: 1 }, scope: "all", can: { start: false, review_candidates: false }, attention_total: 4,
    attention: [{ rank: 1, what: "Approve onboarding", person: "Sample Joiner", owner: ref(2, "Sample Owner"), due: "2026-12-01", reason: "Waiting for approval. No task can be finished until then.", route: "onb-3" },
      { rank: 1, what: "Review candidate submission", person: "Sample Candidate", owner: null, due: null, reason: "The assessment was submitted and is waiting for a decision.", route: "cand-1" },
      { rank: 2, what: "Request VPN access", person: "Sample Newhire", owner: ref(2, "Sample Owner"), due: "2026-11-16", reason: "Blocked: Waiting on the network team to approve the request", route: "onb-1" },
      { rank: 2, what: "Resolve engineering handover", person: "Sample Leaver", owner: ref(2, "Sample Owner"), due: "2026-11-30", reason: "2 items still held by the person leaving. Last day is 2026-11-30.", route: "off-2" }] };
  if (p === "/hr/lifecycle") return [];
  if (p === "/hr/cases") { const k = qs.get("kind"); const items = [ON, ON2, OFF].filter(c => !k || c.kind === k); return { items, total: items.length, page: 1, per: 15 }; }
  const m = /^\/hr\/cases\/(\d+)$/.exec(p); if (m) { const c = CASES[Number(m[1])]; if (!c) throw Object.assign(new Error("Case not found"), { status: 404 }); return c; }
  if (p === "/hr/candidates") return { items: [CAND, CAND2], total: 2 };
  if (/^\/hr\/candidates\/1$/.test(p)) return { ...CAND, assessment_brief: "Build a small rate limiter service. Explain the trade-offs you made.", assessment_instructions: "Text and a GitHub link only.", decision_reason: "", decided_by: null, decided_at: null,
    submission: { notes: "Token bucket with Redis. Notes on failure modes are in the README.", repository_url: "https://github.com/example/rate-limiter", linkedin_url: "", receipt_id: "RCPT-00001-SAMPLE", checksum: "0".repeat(64), received_at: "2026-11-11T09:00:00Z" },
    actions: [], events: [{ id: 1, action: "candidate.submit", actor: "Candidate", detail: "Receipt RCPT-00001-SAMPLE", created_at: "2026-11-11T09:00:00Z", from_stage: "assessment_open", to_stage: "submitted" }] };
  if (p === "/hr/templates") return { onboarding: { name: "Onboarding checklist", version: 1, tasks: [tpl("account", "Create the HQ account"), tpl("vpn", "Request VPN access", { integration: "vpn", category: "Accounts" }), tpl("laptop", "Order a laptop", { required: false })] },
    offboarding: { name: "Offboarding checklist", version: 1, tasks: [tpl("last_day", "Confirm last working day"), tpl("handover", "Engineering handover", { system: "handover" })] } };
  if (p === "/hr/integrations") return { items: [], note: "" };
  throw Object.assign(new Error("Not part of the sample data."), { status: 404 });
}
