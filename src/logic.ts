// Derived values: risk, readiness, KPIs. Everything on screen is computed from records here,
// never typed in by hand.
import type { AppState, Component, Person, Practice, Blocker, Status } from "./types";

export const DAY = 86400000;
export const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
export const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const addDays = (s: string, n: number) => iso(new Date(new Date(s + "T00:00:00").getTime() + n * DAY + 12 * 3600000));
export const daysUntil = (s: string) => Math.round((new Date(s + "T00:00:00").getTime() - today().getTime()) / DAY);
export const nowIso = () => new Date().toISOString();

export const OPEN_BLOCKER = (b: Blocker) => !["resolved", "closed"].includes(b.status);
export const isDone = (c: Component) => c.status === "completed";
export const isOverdue = (c: Component) => !isDone(c) && daysUntil(c.due) < 0;

export function openBlockers(s: AppState, cid: string) { return s.blockers.filter(b => b.componentId === cid && OPEN_BLOCKER(b)); }

export interface Risk { level: "blocked" | "at_risk" | "on_track" | "done"; reasons: string[]; }
export function risk(s: AppState, c: Component): Risk {
  if (isDone(c)) return { level: "done", reasons: [] };
  const reasons: string[] = [];
  const dl = daysUntil(c.due);
  const ob = openBlockers(s, c.id);
  if (dl < 0) reasons.push(`Overdue by ${-dl} day${dl === -1 ? "" : "s"}`);
  if (daysUntil(c.eta) > dl) reasons.push(`ETA ${Math.abs(daysUntil(c.eta) - dl)} days after due date`);
  if (c.gates.checks.state === "failed") reasons.push("Required checks failing");
  const pendingDeps = c.deps.map(id => s.components.find(x => x.id === id)).filter(d => d && !isDone(d)) as Component[];
  const lateDeps = pendingDeps.filter(d => daysUntil(d.eta) > dl - 3 || !d.ownerId || openBlockers(s, d.id).length > 0);
  if (lateDeps.length && dl <= 30) reasons.push(`Waiting on ${lateDeps.map(d => d.id).join(", ")}`);
  if (!c.ownerId && (c.priority === "critical" || c.priority === "high") && daysUntil(c.start) <= 7) reasons.push("No owner and work should start");
  const missing = c.criteria.filter(k => k.status !== "accepted").length;
  if (missing && dl <= 7 && dl >= 0 && c.criteria.length) reasons.push(`${missing} criteria without accepted evidence`);
  if (c.review === "changes_requested" || c.gates.qa.state === "changes_requested") reasons.push("Changes requested in review");
  if (ob.length) return { level: "blocked", reasons: [ob.length === 1 ? `Blocked: ${ob[0].title}` : `${ob.length} open blockers`, ...reasons] };
  return { level: reasons.length ? "at_risk" : "on_track", reasons };
}

export type Stage = "no_checks" | "checks_failed" | "checks_pending" | "awaiting_qa" | "qa_changes" | "awaiting_deploy" | "ready" | "deployed";
export function stage(c: Component): Stage {
  const { checks, qa, deploy } = c.gates;
  if (deploy.state === "deployed") return "deployed";
  if (deploy.state === "ready" || deploy.state === "scheduled" || deploy.state === "in_progress" as any) return "ready";
  if (qa.state === "accepted") return "awaiting_deploy";
  if (qa.state === "changes_requested" || qa.state === "rejected") return "qa_changes";
  if (checks.state === "failed") return "checks_failed";
  if (checks.state === "passed" && (c.status === "under_review" || qa.state === "awaiting" || qa.state === "in_progress")) return "awaiting_qa";
  if (checks.state === "unknown" && !c.repoId) return "no_checks";
  return "checks_pending";
}
export const STAGE_LABEL: Record<Stage, string> = {
  no_checks: "No repository", checks_pending: "Checks pending", checks_failed: "Checks failed", awaiting_qa: "Awaiting QA",
  qa_changes: "QA changes requested", awaiting_deploy: "Awaiting deploy approval", ready: "Ready for deployment", deployed: "Deployed",
};

/** What still stands between this component and "Ready for deployment". */
export function deployBlockers(s: AppState, c: Component): string[] {
  const out: string[] = [];
  if (c.gates.checks.state !== "passed") out.push("Required checks have not passed");
  if (c.gates.qa.state !== "accepted") out.push("QA has not accepted the component");
  const notAcc = c.criteria.filter(k => k.status !== "accepted");
  if (notAcc.length) out.push(`${notAcc.length} acceptance ${notAcc.length > 1 ? "criteria are" : "criterion is"} not accepted`);
  const deps = c.deps.map(id => s.components.find(x => x.id === id)).filter(d => d && !isDone(d)) as Component[];
  if (deps.length) out.push(`Dependencies not complete: ${deps.map(d => d.id).join(", ")}`);
  const ob = openBlockers(s, c.id);
  if (ob.length) out.push(`${ob.length} open blocker${ob.length > 1 ? "s" : ""}`);
  return out;
}

export function practiceStatus(p: Practice): { key: "current" | "review_due" | "outdated" | "under_revision" | "archived"; label: string } {
  if (p.override === "archived") return { key: "archived", label: "Archived" };
  if (p.override === "under_revision") return { key: "under_revision", label: "Under revision" };
  const d = daysUntil(p.nextReview);
  if (d < -30) return { key: "outdated", label: "Outdated" };
  if (d <= 7) return { key: "review_due", label: d < 0 ? "Review overdue" : "Review due" };
  return { key: "current", label: "Current" };
}

export function kpis(s: AppState) {
  const cs = s.components;
  const r = cs.map(c => ({ c, r: risk(s, c) }));
  return {
    projects: s.projects.length,
    total: cs.length,
    assigned: cs.filter(c => c.ownerId).length,
    unassigned: cs.filter(c => !c.ownerId && !isDone(c)).length,
    inProgress: cs.filter(c => c.status === "in_progress").length,
    completed: cs.filter(isDone).length,
    review: cs.filter(c => c.status === "under_review").length,
    blocked: r.filter(x => x.r.level === "blocked").length,
    atRisk: r.filter(x => x.r.level === "at_risk").length,
    overdue: cs.filter(isOverdue).length,
    awaitingQa: cs.filter(c => stage(c) === "awaiting_qa").length,
    ready: cs.filter(c => stage(c) === "ready").length,
    deployed: cs.filter(c => stage(c) === "deployed").length,
  };
}

export const STATUS_LABEL: Record<Status, string> = { not_started: "Not started", in_progress: "In progress", blocked: "Blocked", under_review: "In review", completed: "Done" };
export const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 } as const;

export const personName = (p?: Person | null) => (p ? `${p.first} ${p.last}` : "Unassigned");
export const initials = (p?: Person | null) => (p ? (p.first[0] + p.last[0]).toUpperCase() : "?");

export const fmtDate = (s?: string) => {
  if (!s) return "—";
  const d = new Date(s.length === 10 ? s + "T00:00:00" : s);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined });
};
export const fmtDateTime = (s?: string) => {
  if (!s) return "—";
  const d = new Date(s);
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};
export const relDays = (s: string) => {
  const d = daysUntil(s);
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d === -1) return "yesterday";
  return d > 0 ? `in ${d} days` : `${-d} days ago`;
};
export const ago = (s: string) => {
  const m = Math.round((Date.now() - new Date(s).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return fmtDate(s);
};

/** True if adding edge from→to (from depends on to) would create a cycle. */
export function wouldCycle(s: AppState, from: string, to: string) {
  if (from === to) return true;
  const seen = new Set<string>(); const stack = [to];
  while (stack.length) {
    const n = stack.pop()!;
    if (n === from) return true;
    if (seen.has(n)) continue; seen.add(n);
    const c = s.components.find(x => x.id === n);
    if (c) stack.push(...c.deps);
  }
  return false;
}

export function nextComponentId(s: AppState, _projectId: string) {
  const nums = s.components.map(c => /^NEW-(\d+)$/.exec(c.id)).filter(Boolean).map(m => parseInt(m![1]));
  return `NEW-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, "0")}`;
}

export function csv(rows: (string | number)[][]) {
  return rows.map(r => r.map(v => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",")).join("\n");
}

// ───────────── Ownership ─────────────
// Who is responsible, as a state in its own right. It is NOT a status: a
// component can be in progress and unassigned, or completed and still carry an
// owner. The four are mutually exclusive and must never be collapsed into one
// another, so every surface derives them from here rather than inferring from
// `ownerId` being empty.
export type Ownership = "unassigned" | "mine" | "theirs" | "completed";

export const ownership = (c: Component, meId?: string | null): Ownership =>
  isDone(c) ? "completed"
    : !c.ownerId ? "unassigned"
      : c.ownerId === meId ? "mine" : "theirs";

export const OWNERSHIP: Record<Ownership, { label: string; short: string; help: string }> = {
  unassigned: { label: "Unassigned", short: "Unassigned", help: "Nobody owns this. It cannot start until someone does." },
  mine:       { label: "Assigned to me", short: "Mine", help: "You own this. You are the one expected to build it." },
  theirs:     { label: "Assigned to someone else", short: "Assigned", help: "Someone else owns this. You can read it, but it is not yours to build." },
  completed:  { label: "Completed", short: "Completed", help: "Finished and deployed. Its owner is now history, not a to-do." },
};
export const OWNERSHIP_ORDER: Ownership[] = ["unassigned", "mine", "theirs", "completed"];

export function ownershipCounts(cs: Component[], meId?: string | null) {
  const n: Record<Ownership, number> = { unassigned: 0, mine: 0, theirs: 0, completed: 0 };
  for (const c of cs) n[ownership(c, meId)]++;
  return n;
}

/**
 * The one thing that has to happen next, and who has to do it.
 * Derived entirely from the record: blockers, gates, review state, dependencies.
 * Nothing here is guessed. If the record does not say, this says so.
 */
export interface NextAction { text: string; who: string | null; urgent: boolean; }
export function nextAction(s: AppState, c: Component): NextAction {
  if (isDone(c)) return { text: "Delivered", who: null, urgent: false };

  const ob = openBlockers(s, c.id);
  if (ob.length) {
    const b = ob.sort((x, y) => (x.severity === "critical" ? -1 : 0) - (y.severity === "critical" ? -1 : 0))[0];
    return { text: b.nextAction || `Resolve blocker ${b.id}`, who: b.responsibleId, urgent: true };
  }
  if (!c.ownerId) return { text: "Needs an owner before work can start", who: null, urgent: true };
  if (c.review === "changes_requested") return { text: "Rework what the reviewer sent back", who: c.ownerId, urgent: true };
  if (c.gates.qa.state === "changes_requested" || c.gates.qa.state === "rejected") return { text: "Rework what QA sent back", who: c.ownerId, urgent: true };
  if (c.gates.checks.state === "failed") return { text: "Fix the failing checks", who: c.ownerId, urgent: true };

  if (c.gates.deploy.state === "ready" || c.gates.deploy.state === "scheduled") return { text: "Deployment approved, waiting to ship", who: null, urgent: false };
  if (c.gates.qa.state === "accepted") return { text: "Waiting on a deployment decision", who: null, urgent: false };
  if (c.gates.qa.state === "awaiting" || c.gates.qa.state === "in_progress") return { text: "Waiting on QA", who: c.qaId, urgent: false };
  if (c.review === "in_review") return { text: "Waiting on code review", who: c.reviewerId, urgent: false };

  const waiting = c.deps.map(id => s.components.find(x => x.id === id)).filter(d => d && !isDone(d)) as Component[];
  if (waiting.length && c.status === "not_started") return { text: `Waiting on ${waiting.slice(0, 3).map(d => d.id).join(", ")}${waiting.length > 3 ? ` +${waiting.length - 3}` : ""}`, who: null, urgent: false };

  if (c.status === "not_started") return { text: "Not started", who: c.ownerId, urgent: false };

  const open = c.criteria.filter(k => k.status !== "accepted" && k.status !== "submitted").length;
  if (open) return { text: `Submit evidence (${open} ${open > 1 ? "criteria" : "criterion"})`, who: c.ownerId, urgent: false };
  if (c.criteria.some(k => k.status === "submitted")) return { text: "Evidence submitted, waiting on review", who: c.reviewerId, urgent: false };
  return { text: "Submit for review", who: c.ownerId, urgent: false };
}

/** Most urgent first: blocked, then overdue, then priority, then nearest due date. */
export function byUrgency(s: AppState) {
  return (a: Component, b: Component) => {
    const ra = risk(s, a).level, rb = risk(s, b).level;
    const rank = (r: string) => (r === "blocked" ? 0 : r === "at_risk" ? 1 : 2);
    return rank(ra) - rank(rb)
      || PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
      || (a.due || "9999").localeCompare(b.due || "9999");
  };
}

/* ──────────────────────────────────────────────────────────────────────────
   LIFECYCLE — the execution axis.

   Wave (lib.wave) is the source sheet's planning classification and is never
   touched. Lifecycle is derived at read time from records that already exist:
   status, owner, dependencies and the readiness gates. Nothing is stored, so
   nothing can drift out of step with the sheet, and a component's lifecycle
   never implies anything about its wave.
   ────────────────────────────────────────────────────────────────────────── */
export type Lifecycle = "proposed" | "awaiting_decision" | "selected" | "assigned" | "ready" | "in_progress" | "completed";

export const LIFECYCLE: { id: Lifecycle; label: string; help: string; tone: string }[] = [
  { id: "proposed", label: "Proposed", help: "Specified, but not chosen for a round yet.", tone: "neutral" },
  { id: "awaiting_decision", label: "Awaiting decision", help: "Needs an architecture or approval decision before anyone can build it.", tone: "review" },
  { id: "selected", label: "Selected for a round", help: "Chosen to be built, but nobody owns it yet. Selection is not assignment.", tone: "warn" },
  { id: "assigned", label: "Assigned", help: "Has an owner, but a prerequisite is still unfinished.", tone: "info" },
  { id: "ready", label: "Ready to start", help: "Owned, and every prerequisite is complete. Work can begin.", tone: "ok" },
  { id: "in_progress", label: "In progress", help: "Being built, reviewed, or blocked while in flight.", tone: "info" },
  { id: "completed", label: "Completed", help: "Checks passed, QA accepted and deployment approved.", tone: "ok" },
];
export const LIFECYCLE_LABEL = Object.fromEntries(LIFECYCLE.map(l => [l.id, l.label])) as Record<Lifecycle, string>;
export const LIFECYCLE_TONE = Object.fromEntries(LIFECYCLE.map(l => [l.id, l.tone])) as Record<Lifecycle, string>;

/** Waves the source sheet uses to mean "picked for a development cycle". */
export const SELECTED_WAVES = ["Now", "P0"];
/** Waves that mean a decision has to happen before any build. */
export const DECISION_WAVES = ["Architecture decision", "Gated"];

export function lifecycle(s: AppState, c: Component): Lifecycle {
  if (isDone(c)) return "completed";
  if (c.status === "in_progress" || c.status === "blocked" || c.status === "under_review") return "in_progress";
  if (c.ownerId) {
    const pending = c.deps.map(id => s.components.find(x => x.id === id)).filter(d => d && !isDone(d));
    return pending.length ? "assigned" : "ready";
  }
  const w = c.lib?.wave || "";
  if (DECISION_WAVES.includes(w)) return "awaiting_decision";
  if (SELECTED_WAVES.includes(w)) return "selected";
  return "proposed";
}

export function lifecycleCounts(s: AppState, cs: Component[]) {
  const n = Object.fromEntries(LIFECYCLE.map(l => [l.id, 0])) as Record<Lifecycle, number>;
  for (const c of cs) n[lifecycle(s, c)]++;
  return n;
}

export const CHECK_LABEL: Record<string, string> = {
  passed: "passed", failed: "failing", running: "running", pending: "pending", skipped: "skipped", unknown: "not run",
};
