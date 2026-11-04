// Application store. In production each action becomes an API call (Supabase/Postgres);
// here it mutates a local copy so the prototype is fully interactive.
import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { AppState, Component, Person, Blocker, Handoff, Practice, Milestone, Evidence, Criterion, Contact, HistoryEntry, Notice, ArchFile, ExtLink, QAState, DeployState, Status } from "./types";
import { seedState } from "./seed";
import { nowIso, iso, today, addDays, personName, STATUS_LABEL } from "./logic";

const KEY = "apex-eip-v8";
let n = 0; const uid = (p: string) => `${p}${Date.now().toString(36)}${(n++).toString(36)}`;

function load(): AppState {
  try { const raw = localStorage.getItem(KEY); if (raw) { const s = JSON.parse(raw); if (s && s.version === 8) return s; } } catch { /* storage unavailable */ }
  return seedState();
}

type Ctx = ReturnType<typeof useProvideStore>;
const StoreCtx = createContext<Ctx | null>(null);
export const useStore = () => useContext(StoreCtx)!;

// ───────────── toasts ─────────────
export interface Toast { id: string; text: string; tone: "ok" | "warn" | "crit" | "info"; }
const ToastCtx = createContext<{ toasts: Toast[]; toast: (text: string, tone?: Toast["tone"]) => void; dismiss: (id: string) => void }>(null as any);
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, set] = useState<Toast[]>([]);
  const dismiss = useCallback((id: string) => set(t => t.filter(x => x.id !== id)), []);
  const toast = useCallback((text: string, tone: Toast["tone"] = "ok") => {
    const id = uid("t"); set(t => [...t.slice(-3), { id, text, tone }]);
    setTimeout(() => dismiss(id), 4200);
  }, [dismiss]);
  return <ToastCtx.Provider value={{ toasts, toast, dismiss }}>{children}</ToastCtx.Provider>;
}

const FIELD_LABEL: Record<string, string> = { ownerId: "owner", reviewerId: "reviewer", qaId: "QA contact", priority: "priority", status: "status", due: "due date", eta: "ETA", start: "start date", repoId: "repository", projectId: "project", category: "category", name: "name", deliverable: "expected deliverable" };

function useProvideStore() {
  const [state, setState] = useState<AppState>(load);
  const [saveError, setSaveError] = useState(false);
  const timer = useRef<any>(null);

  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify(state)); setSaveError(false); } catch { setSaveError(true); }
    }, 250);
  }, [state]);

  const mutate = useCallback((fn: (d: AppState) => void) => {
    setState(prev => { const d = structuredClone(prev); fn(d); return d; });
  }, []);

  const pname = (d: AppState, id?: string | null) => personName(d.people.find(p => p.id === id));
  const log = (d: AppState, e: Omit<HistoryEntry, "id" | "at" | "by" | "source"> & { by?: string }) =>
    d.history.unshift({ id: uid("h"), at: nowIso(), by: e.by || d.me || "system", source: "apex", ...e } as HistoryEntry);
  const notify = (d: AppState, to: string | null | undefined, kind: Notice["kind"], title: string, body: string, componentId?: string) => {
    if (!to || to === d.me) return;
    // Preferences are real: an unticked kind is never delivered.
    if (d.people.find(p => p.id === to)?.prefs?.[kind] === false) return;
    d.notices.unshift({ id: uid("n"), to, kind, title, body, componentId, at: nowIso(), read: false });
  };
  const comp = (d: AppState, id: string) => d.components.find(c => c.id === id)!;
  const touch = (c: Component) => { c.updatedAt = nowIso(); };

  const actions = {
    // ── identity
    signIn: (id: string) => mutate(d => { d.me = id; }),
    signOut: () => mutate(d => { d.me = null; }),
    register: (p: { first: string; last: string; email: string }) => {
      const id = uid("u");
      mutate(d => {
        d.people.push({ id, first: p.first.trim(), last: p.last.trim(), email: p.email.trim().toLowerCase(), role: "member", title: "Engineer", team: "—", skills: [], hue: Math.floor(Math.random() * 360), joined: iso(today()), active: true });
        d.me = id;
        log(d, { entity: "person", entityId: id, action: "Joined the platform", by: id });
      });
      return id;
    },
    addPerson: (p: Omit<Person, "id" | "hue" | "joined" | "active" | "skills" | "team"> & { team?: string }) => mutate(d => {
      const id = uid("u");
      d.people.push({ ...p, team: p.team || "—", id, skills: [], hue: Math.floor(Math.random() * 360), joined: iso(today()), active: true });
      log(d, { entity: "person", entityId: id, action: `Added ${p.first} ${p.last} as ${p.role}` });
    }),
    updatePerson: (id: string, patch: Partial<Person>) => mutate(d => {
      const p = d.people.find(x => x.id === id)!;
      if (patch.role && patch.role !== p.role) log(d, { entity: "person", entityId: id, action: "Role changed", field: "role", from: p.role, to: patch.role });
      Object.assign(p, patch);
    }),
    removePerson: (id: string) => mutate(d => {
      const p = d.people.find(x => x.id === id)!;
      for (const c of d.components) {
        if (c.ownerId === id) { c.ownerId = null; log(d, { entity: "component", entityId: c.id, action: "Owner removed", field: "owner", from: id, to: "Unassigned", reason: `${p.first} ${p.last} was removed from the platform` }); }
        if (c.reviewerId === id) c.reviewerId = null;
        if (c.qaId === id) c.qaId = null;
      }
      d.people = d.people.filter(x => x.id !== id);
      log(d, { entity: "person", entityId: id, action: `Removed ${p.first} ${p.last}` });
    }),

    // ── components
    createComponent: (c: Component) => mutate(d => {
      d.components.push(c);
      log(d, { entity: "component", entityId: c.id, action: "Component created" });
      if (c.ownerId) { log(d, { entity: "component", entityId: c.id, action: "Owner assigned", field: "owner", from: "Unassigned", to: c.ownerId }); notify(d, c.ownerId, "assignment", `You own ${c.name}`, "Your onboarding pack is ready on the component page.", c.id); }
      if (c.reviewerId) notify(d, c.reviewerId, "review", `You are reviewer for ${c.name}`, `${c.id} · due ${c.due}`, c.id);
    }),
    updateComponent: (id: string, patch: Partial<Component>, reason?: string) => mutate(d => {
      const c = comp(d, id);
      for (const k of Object.keys(patch) as (keyof Component)[]) {
        const before = c[k] as any, after = patch[k] as any;
        if (JSON.stringify(before) === JSON.stringify(after)) continue;
        if (k in FIELD_LABEL) {
          const show = (v: any) => k === "ownerId" || k === "reviewerId" || k === "qaId" ? (v ? v : "Unassigned") : k === "status" ? STATUS_LABEL[v as Status] : String(v ?? "—");
          const action = k === "ownerId" ? (before ? "Owner changed" : "Owner assigned") : k === "eta" || k === "due" || k === "start" ? "Plan changed" : `${FIELD_LABEL[k][0].toUpperCase()}${FIELD_LABEL[k].slice(1)} changed`;
          log(d, { entity: "component", entityId: id, action, field: FIELD_LABEL[k], from: show(before), to: show(after), reason });
        } else if (k === "deps") {
          log(d, { entity: "component", entityId: id, action: "Dependencies changed", from: (before as string[]).join(", ") || "none", to: (after as string[]).join(", ") || "none", reason });
        } else if (k === "details") {
          log(d, { entity: "component", entityId: id, action: "Details updated" });
        }
      }
      if (patch.ownerId && patch.ownerId !== c.ownerId) notify(d, patch.ownerId, "assignment", `You own ${patch.name || c.name}`, "Your onboarding pack is ready on the component page.", id);
      if (patch.ownerId !== undefined && c.ownerId && patch.ownerId !== c.ownerId) notify(d, c.ownerId, "assignment", `${c.name} was reassigned`, reason || "Ownership moved to another engineer.", id);
      if (patch.reviewerId && patch.reviewerId !== c.reviewerId) notify(d, patch.reviewerId, "review", `You are reviewer for ${c.name}`, `${c.id} · due ${c.due}`, id);
      if ((patch.due && patch.due !== c.due) || (patch.eta && patch.eta !== c.eta)) notify(d, c.ownerId, "deadline", `Plan changed for ${c.name}`, `Due ${patch.due || c.due} · ETA ${patch.eta || c.eta}`, id);
      Object.assign(c, patch); touch(c);
    }),
    deleteComponent: (id: string) => mutate(d => {
      const c = comp(d, id);
      d.components = d.components.filter(x => x.id !== id);
      for (const x of d.components) x.deps = x.deps.filter(z => z !== id);
      d.blockers = d.blockers.filter(b => b.componentId !== id);
      d.handoffs = d.handoffs.filter(h => h.componentId !== id);
      for (const m of d.milestones) m.componentIds = m.componentIds.filter(z => z !== id);
      log(d, { entity: "component", entityId: id, action: `Deleted component ${id} ${c.name}` });
    }),
    submitForReview: (id: string) => mutate(d => {
      const c = comp(d, id);
      log(d, { entity: "component", entityId: id, action: "Submitted for review", field: "status", from: STATUS_LABEL[c.status], to: STATUS_LABEL.under_review });
      c.status = "under_review"; c.review = "in_review";
      if (c.gates.qa.state === "not_submitted" || c.gates.qa.state === "changes_requested") c.gates.qa = { state: "awaiting", at: nowIso() };
      notify(d, c.reviewerId, "review", `Review requested: ${c.name}`, `${pname(d, d.me)} submitted ${c.id} for review.`, id);
      notify(d, c.qaId, "review", `QA requested: ${c.name}`, "Ready for QA once required checks pass.", id);
      touch(c);
    }),
    setReview: (id: string, review: Component["review"], note?: string) => mutate(d => {
      const c = comp(d, id);
      log(d, { entity: "component", entityId: id, action: review === "accepted" ? "Code review accepted" : review === "changes_requested" ? "Code review: changes requested" : "Review started", reason: note });
      c.review = review;
      if (review === "changes_requested") { c.status = "in_progress"; notify(d, c.ownerId, "review", `Changes requested on ${c.name}`, note || "See the component page.", id); }
      if (review === "accepted") notify(d, c.ownerId, "review", `Review accepted: ${c.name}`, note || "", id);
      touch(c);
    }),
    setQA: (id: string, state: QAState, note?: string) => mutate(d => {
      const c = comp(d, id);
      log(d, { entity: "component", entityId: id, action: state === "accepted" ? "QA accepted" : state === "changes_requested" ? "QA changes requested" : state === "rejected" ? "QA rejected" : "QA started", field: "qa", from: c.gates.qa.state, to: state, reason: note });
      c.gates.qa = { state, by: d.me || undefined, at: nowIso(), note };
      if (state === "changes_requested" || state === "rejected") { c.status = "in_progress"; if (c.gates.deploy.state !== "deployed") c.gates.deploy = { state: "not_ready" }; }
      notify(d, c.ownerId, "review", state === "accepted" ? `QA accepted ${c.name}` : `QA update on ${c.name}`, note || state.replace(/_/g, " "), id);
      touch(c);
    }),
    setDeploy: (id: string, state: DeployState, note?: string) => mutate(d => {
      const c = comp(d, id);
      log(d, { entity: "component", entityId: id, action: state === "ready" ? "Approved for deployment" : state === "deployed" ? "Deployed" : `Deployment: ${state.replace(/_/g, " ")}`, field: "deploy", from: c.gates.deploy.state, to: state, reason: note });
      c.gates.deploy = { state, by: d.me || undefined, at: nowIso(), note };
      if (state === "deployed" && c.status !== "completed") { c.status = "completed"; log(d, { entity: "component", entityId: id, action: "Status changed", field: "status", from: "Under review", to: "Completed" }); }
      notify(d, c.ownerId, "review", state === "ready" ? `${c.name} approved for deployment` : `Deployment update: ${c.name}`, note || "", id);
      touch(c);
    }),

    // ── acceptance criteria & evidence
    addCriterion: (id: string, k: Omit<Criterion, "id" | "status" | "evidence">) => mutate(d => {
      const c = comp(d, id);
      c.criteria.push({ ...k, id: `${id}-AC${c.criteria.length + 1}-${(n++).toString(36)}`, status: "not_started", evidence: [] });
      log(d, { entity: "component", entityId: id, action: "Acceptance criterion added", to: k.text }); touch(c);
    }),
    updateCriterion: (id: string, kid: string, patch: Partial<Criterion>) => mutate(d => {
      const k = comp(d, id).criteria.find(x => x.id === kid)!; Object.assign(k, patch);
      log(d, { entity: "component", entityId: id, action: "Acceptance criterion edited", to: k.text });
    }),
    removeCriterion: (id: string, kid: string) => mutate(d => {
      const c = comp(d, id); const k = c.criteria.find(x => x.id === kid)!;
      c.criteria = c.criteria.filter(x => x.id !== kid);
      log(d, { entity: "component", entityId: id, action: "Acceptance criterion removed", from: k.text });
    }),
    addEvidence: (id: string, kid: string, ev: Omit<Evidence, "id" | "by" | "at" | "version">) => mutate(d => {
      const c = comp(d, id); const k = c.criteria.find(x => x.id === kid)!;
      k.evidence.push({ ...ev, id: uid("ev"), by: d.me!, at: nowIso(), version: k.evidence.length + 1 });
      k.status = "submitted";
      log(d, { entity: "component", entityId: id, action: "Evidence submitted", to: `${kid.split("-").slice(0, 3).join("-")}: ${ev.label}` });
      notify(d, c.reviewerId, "review", `Evidence submitted on ${c.name}`, k.text, id);
      notify(d, c.qaId, "review", `Evidence submitted on ${c.name}`, k.text, id);
      touch(c);
    }),
    reviewEvidence: (id: string, kid: string, evid: string, decision: "approved" | "rejected" | "changes", note: string) => mutate(d => {
      const c = comp(d, id); const k = c.criteria.find(x => x.id === kid)!; const e = k.evidence.find(x => x.id === evid)!;
      Object.assign(e, { decision, note, reviewerId: d.me, reviewedAt: nowIso() });
      k.status = decision === "approved" ? "accepted" : decision === "rejected" ? "rejected" : "changes_requested";
      log(d, { entity: "component", entityId: id, action: decision === "approved" ? "Evidence approved" : decision === "rejected" ? "Evidence rejected" : "More evidence requested", to: k.text, reason: note });
      notify(d, e.by, "review", decision === "approved" ? "Evidence approved" : "Evidence needs changes", `${c.name}: ${k.text}`, id);
    }),

    // ── comments
    addComment: (id: string, body: string) => mutate(d => {
      const c = comp(d, id);
      c.comments.push({ id: uid("cm"), by: d.me!, at: nowIso(), body });
      const who = pname(d, d.me);
      new Set([c.ownerId, c.reviewerId]).forEach(to => notify(d, to, "comment", `${who} commented on ${c.name}`, body.slice(0, 120), id));
      for (const p of d.people) if (body.toLowerCase().includes("@" + p.first.toLowerCase())) notify(d, p.id, "comment", `${who} mentioned you`, body.slice(0, 120), id);
    }),
    editComment: (id: string, cid: string, body: string) => mutate(d => { const k = comp(d, id).comments.find(x => x.id === cid)!; k.body = body; k.edited = true; }),
    deleteComment: (id: string, cid: string) => mutate(d => { const c = comp(d, id); c.comments = c.comments.filter(x => x.id !== cid); }),

    // ── links & architecture
    addLink: (id: string, l: Omit<ExtLink, "id">) => mutate(d => { comp(d, id).links.push({ ...l, id: uid("ln") }); log(d, { entity: "component", entityId: id, action: `Linked ${l.kind} record`, to: l.label }); }),
    removeLink: (id: string, lid: string) => mutate(d => { const c = comp(d, id); const l = c.links.find(x => x.id === lid)!; c.links = c.links.filter(x => x.id !== lid); log(d, { entity: "component", entityId: id, action: `Unlinked ${l.kind} record`, from: l.label }); }),
    addArch: (id: string, f: Omit<ArchFile, "id" | "by" | "at" | "version">) => mutate(d => {
      const c = comp(d, id); const prev = c.architecture.filter(a => a.name === f.name).length;
      c.architecture.unshift({ ...f, id: uid("af"), by: d.me!, at: nowIso(), version: prev + 1 });
      log(d, { entity: "component", entityId: id, action: "Architecture file uploaded", to: f.name });
    }),
    removeArch: (id: string, aid: string) => mutate(d => { const c = comp(d, id); const a = c.architecture.find(x => x.id === aid)!; c.architecture = c.architecture.filter(x => x.id !== aid); log(d, { entity: "component", entityId: id, action: "Architecture file removed", from: a.name }); }),

    // ── blockers & handoffs
    addBlocker: (b: Omit<Blocker, "id" | "createdAt" | "updatedAt" | "reportedBy" | "status">) => mutate(d => {
      const num = Math.max(...d.blockers.map(x => parseInt(x.id.slice(4))), 0) + 1;
      const id = `BLK-${String(num).padStart(3, "0")}`;
      d.blockers.unshift({ ...b, id, status: "open", reportedBy: d.me!, createdAt: nowIso(), updatedAt: nowIso() });
      const c = comp(d, b.componentId);
      log(d, { entity: "component", entityId: b.componentId, action: `Blocker ${id} raised`, to: b.title });
      notify(d, b.responsibleId, "blocker", "Blocker assigned to you", `${id} ${b.title}`, b.componentId);
      notify(d, c.ownerId, "blocker", `New blocker on ${c.name}`, `${id} ${b.title}`, b.componentId);
    }),
    updateBlocker: (id: string, patch: Partial<Blocker>, note?: string) => mutate(d => {
      const b = d.blockers.find(x => x.id === id)!;
      if (patch.status && patch.status !== b.status) {
        log(d, { entity: "component", entityId: b.componentId, action: `Blocker ${id} ${patch.status === "resolved" ? "resolved" : patch.status === "escalated" ? "escalated" : "updated"}`, field: "blocker", from: b.status.replace(/_/g, " "), to: patch.status.replace(/_/g, " "), reason: note });
        if (patch.status === "resolved" || patch.status === "closed") patch.resolvedAt = nowIso();
        const c = comp(d, b.componentId);
        notify(d, c.ownerId, "blocker", `Blocker ${patch.status.replace(/_/g, " ")}`, `${id} ${b.title}`, b.componentId);
      }
      if (patch.responsibleId && patch.responsibleId !== b.responsibleId) notify(d, patch.responsibleId, "blocker", "Blocker assigned to you", `${id} ${b.title}`, b.componentId);
      if (patch.target && patch.target !== b.target) log(d, { entity: "component", entityId: b.componentId, action: `Blocker ${id} target changed`, from: b.target, to: patch.target });
      Object.assign(b, patch, { updatedAt: nowIso() });
    }),
    startHandoff: (h: Omit<Handoff, "id" | "status" | "createdAt" | "by">) => mutate(d => {
      const num = Math.max(...d.handoffs.map(x => parseInt(x.id.slice(3))), 0) + 1;
      const id = `HO-${String(num).padStart(3, "0")}`;
      d.handoffs.unshift({ ...h, id, status: "awaiting_ack", createdAt: nowIso(), by: d.me! });
      const c = comp(d, h.componentId);
      log(d, { entity: "component", entityId: c.id, action: "Owner changed", field: "owner", from: h.fromId, to: h.toId, reason: `Handoff ${id}: ${h.reason}` });
      c.ownerId = h.toId; touch(c);
      notify(d, h.toId, "handoff", `Handoff to you: ${c.name}`, "Review the checklist and acknowledge it.", c.id);
      notify(d, h.fromId, "handoff", `Handoff started: ${c.name}`, `To ${pname(d, h.toId)}`, c.id);
    }),
    toggleHandoffItem: (id: string, item: string) => mutate(d => { const h = d.handoffs.find(x => x.id === id)!; const it = h.checklist.find(x => x.id === item)!; it.done = !it.done; }),
    ackHandoff: (id: string) => mutate(d => {
      const h = d.handoffs.find(x => x.id === id)!; h.status = "completed"; h.ackAt = nowIso();
      log(d, { entity: "component", entityId: h.componentId, action: `Handoff ${id} acknowledged`, by: d.me! });
      notify(d, h.fromId, "handoff", "Handoff acknowledged", `${pname(d, h.toId)} acknowledged ${id}`, h.componentId);
      notify(d, h.by, "handoff", "Handoff acknowledged", `${pname(d, h.toId)} acknowledged ${id}`, h.componentId);
    }),

    // ── best practices
    savePractice: (p: Practice, isNew: boolean) => mutate(d => {
      const now = nowIso();
      if (isNew) { d.practices.push({ ...p, updatedAt: now, updatedBy: d.me!, reviewedAt: now }); log(d, { entity: "practice", entityId: p.id, action: "Page created", to: p.title }); return; }
      const i = d.practices.findIndex(x => x.id === p.id);
      if (d.practices[i].ownerId !== p.ownerId) notify(d, p.ownerId, "review", `You now own “${p.title}”`, "Keep it current; you'll be reminded before each review date.");
      d.practices[i] = { ...p, updatedAt: now, updatedBy: d.me! };
      log(d, { entity: "practice", entityId: p.id, action: "Page updated", to: p.title });
    }),
    reviewPractice: (id: string) => mutate(d => {
      const p = d.practices.find(x => x.id === id)!; p.reviewedAt = nowIso(); p.nextReview = addDays(iso(today()), 90);
      if (p.override === "under_revision") p.override = null;
      log(d, { entity: "practice", entityId: id, action: "Page reviewed", to: p.title });
    }),
    setPracticeOverride: (id: string, o: Practice["override"]) => mutate(d => { const p = d.practices.find(x => x.id === id)!; p.override = o; log(d, { entity: "practice", entityId: id, action: o === "archived" ? "Page archived" : o === "under_revision" ? "Marked under revision" : "Restored", to: p.title }); }),

    // ── plan, milestones, about, contacts
    savePlanNotes: (notes: string) => mutate(d => { d.plan = { notes, updatedAt: nowIso(), updatedBy: d.me! }; log(d, { entity: "plan", entityId: "plan", action: "Development plan notes updated" }); }),
    saveMilestone: (m: Milestone) => mutate(d => {
      const i = d.milestones.findIndex(x => x.id === m.id);
      if (i >= 0) { const before = d.milestones[i]; if (before.date !== m.date) log(d, { entity: "plan", entityId: m.id, action: `Milestone “${m.name}” moved`, from: before.date, to: m.date }); d.milestones[i] = m; }
      else { d.milestones.push(m); log(d, { entity: "plan", entityId: m.id, action: `Milestone “${m.name}” added`, to: m.date }); }
      d.milestones.sort((a, b) => a.date.localeCompare(b.date));
    }),
    deleteMilestone: (id: string) => mutate(d => { const m = d.milestones.find(x => x.id === id)!; d.milestones = d.milestones.filter(x => x.id !== id); log(d, { entity: "plan", entityId: id, action: `Milestone “${m.name}” removed` }); }),
    saveAbout: (vision: string, overview: string) => mutate(d => { d.about = { vision, overview, updatedAt: nowIso(), updatedBy: d.me! }; log(d, { entity: "about", entityId: "about", action: "Vision page updated" }); }),
    saveContact: (c: Contact) => mutate(d => { const i = d.contacts.findIndex(x => x.id === c.id); if (i >= 0) d.contacts[i] = c; else d.contacts.push(c); }),
    deleteContact: (id: string) => mutate(d => { d.contacts = d.contacts.filter(x => x.id !== id); }),
    updateRepo: (id: string, patch: Partial<AppState["repos"][number]>) => mutate(d => { const r = d.repos.find(x => x.id === id)!; Object.assign(r, patch); log(d, { entity: "repo", entityId: id, action: "Repository details updated", to: r.name }); }),

    // ── dependency cycle decisions (recorded, never applied to deps)
    setCycleDecision: (key: string, patch: Partial<import("./types").CycleDecision>, label: string) => mutate(d => {
      d.cycleDecisions = d.cycleDecisions || {};
      const prev = d.cycleDecisions[key] || { key, status: "undecided" as const };
      const next = { ...prev, ...patch, key, at: nowIso(), by: d.me || "system" };
      d.cycleDecisions[key] = next;
      log(d, { entity: "plan", entityId: "cycle:" + key, action: `Dependency loop: ${label}`, from: prev.status, to: next.status, reason: patch.note });
      if (patch.ownerId && patch.ownerId !== prev.ownerId) notify(d, patch.ownerId, "review", "A dependency loop needs your decision", label);
    }),

    // ── graph
    setPos: (id: string, x: number, y: number) => mutate(d => { d.graphPos[id] = { x, y }; }),
    resetPos: () => mutate(d => { d.graphPos = {}; }),
    addDep: (from: string, to: string) => mutate(d => { const c = comp(d, from); if (!c.deps.includes(to)) { log(d, { entity: "component", entityId: from, action: "Dependency added", to: `${to} ${comp(d, to).name}` }); c.deps.push(to); touch(c); } }),
    removeDep: (from: string, to: string) => mutate(d => { const c = comp(d, from); c.deps = c.deps.filter(x => x !== to); log(d, { entity: "component", entityId: from, action: "Dependency removed", from: `${to} ${comp(d, to).name}` }); touch(c); }),

    // ── notifications
    markRead: (id: string) => mutate(d => { const x = d.notices.find(n => n.id === id); if (x) x.read = true; }),
    markAllRead: () => mutate(d => { for (const x of d.notices) if (x.to === d.me) x.read = true; }),

    resetDemo: () => { const me = state.me; const fresh = seedState(); fresh.me = me && fresh.people.some(p => p.id === me) ? me : null; setState(fresh); },
  };

  const me = state.people.find(p => p.id === state.me) || null;
  const isAdmin = me?.role === "admin";
  const person = (id?: string | null) => state.people.find(p => p.id === id) || null;
  const component = (id?: string | null) => state.components.find(c => c.id === id) || null;
  return { state, me, isAdmin, person, component, saveError, ...actions };
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const v = useProvideStore();
  return <StoreCtx.Provider value={v}>{children}</StoreCtx.Provider>;
}

// ───────────── routing (plain #name hashes only) ─────────────
export interface CompFilter { quick: string; project: string; priority: string; status: string; owner: string; stage: string; category: string; q: string; sp: string; wave: string; }
export const EMPTY_FILTER: CompFilter = { quick: "all", project: "", priority: "", status: "", owner: "", stage: "", category: "", q: "", sp: "", wave: "" };
const NavCtx = createContext<{ route: string; go: (r: string) => void; filter: CompFilter; setFilter: (f: CompFilter) => void; openComponents: (f: Partial<CompFilter>) => void }>(null as any);
export const useNav = () => useContext(NavCtx);
const readHash = () => (location.hash || "").replace(/^#/, "") || "home";
export function NavProvider({ children }: { children: React.ReactNode }) {
  const [route, setRoute] = useState(readHash);
  const [filter, setFilter] = useState<CompFilter>(EMPTY_FILTER);
  useEffect(() => {
    const on = () => { setRoute(readHash()); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", on); return () => window.removeEventListener("hashchange", on);
  }, []);
  const go = useCallback((r: string) => { if (readHash() === r) { setRoute(r); window.scrollTo(0, 0); } else location.hash = r; }, []);
  const openComponents = useCallback((f: Partial<CompFilter>) => { setFilter({ ...EMPTY_FILTER, ...f }); go("library"); }, [go]);
  const v = useMemo(() => ({ route, go, filter, setFilter, openComponents }), [route, go, filter, openComponents]);
  return <NavCtx.Provider value={v}>{children}</NavCtx.Provider>;
}
