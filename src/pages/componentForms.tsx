import React, { useMemo, useState } from "react";
import { useStore, useNav, useToast } from "../store";
import { Button, Field, Modal, PersonSelect, Pill, cx } from "../ui";
import { Icon } from "../icons";
import { CATEGORIES } from "../seed";
import { iso, today, addDays, nextComponentId, wouldCycle, nowIso, isDone } from "../logic";
import type { Component, Priority, Status } from "../types";

interface FormState {
  name: string; category: string; projectId: string; priority: Priority; status: Status;
  ownerId: string | null; reviewerId: string | null; qaId: string | null;
  start: string; due: string; eta: string; repoId: string; deps: string[];
  summary: string; purpose: string; deliverable: string; reason: string;
}

function DepPicker({ value, onChange, selfId }: { value: string[]; onChange: (v: string[]) => void; selfId?: string }) {
  const { state } = useStore();
  const [q, setQ] = useState("");
  const list = state.components.filter(c => c.id !== selfId && (!q || (c.id + c.name).toLowerCase().includes(q.toLowerCase())));
  return (
    <div style={{ border: "1px solid var(--line-strong)", borderRadius: 10, overflow: "hidden" }}>
      <div className="input-ic" style={{ borderBottom: "1px solid var(--line)" }}><Icon name="search" size={14} /><input type="text" placeholder="Filter components" value={q} onChange={e => setQ(e.target.value)} style={{ border: 0, borderRadius: 0, boxShadow: "none" }} /></div>
      <div style={{ maxHeight: 180, overflowY: "auto", padding: 6, display: "grid", gap: 2 }}>
        {list.map(c => {
          const on = value.includes(c.id);
          const cyc = !on && selfId ? wouldCycle(state, selfId, c.id) : false;
          return (
            <label key={c.id} className="check" style={{ padding: "5px 6px", borderRadius: 6, opacity: cyc ? .45 : 1 }} title={cyc ? "Would create a circular dependency" : undefined}>
              <input type="checkbox" checked={on} disabled={cyc} onChange={() => onChange(on ? value.filter(x => x !== c.id) : [...value, c.id])} />
              <span><code className="cid">{c.id}</code> {c.name}{cyc && <small className="muted"> · circular</small>}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function ComponentFields({ f, set, err, editing, selfId }: { f: FormState; set: (p: Partial<FormState>) => void; err: Record<string, string>; editing?: boolean; selfId?: string }) {
  const { state, apiMode } = useStore();
  return (
    <div className="form-grid">
      <Field label="Component name" error={err.name} full><input type="text" value={f.name} onChange={e => set({ name: e.target.value })} placeholder="e.g. Payment Reconciliation Service" /></Field>
      {!apiMode && <Field label="Source list"><select value={f.projectId} onChange={e => set({ projectId: e.target.value })}>{state.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>}
      <Field label="Category"><select value={f.category} onChange={e => set({ category: e.target.value })}>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></Field>
      <Field label="Priority"><select value={f.priority} onChange={e => set({ priority: e.target.value as Priority })}>{["critical", "high", "medium", "low"].map(p => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}</select></Field>
      {editing ? <Field label="Status"><select value={f.status} onChange={e => set({ status: e.target.value as Status })}>{[["not_started", "Not started"], ["in_progress", "In progress"], ["blocked", "Blocked"], ["under_review", "Under review"], ["completed", "Completed"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        : <Field label="Repository" hint="Optional; can be linked later"><select value={f.repoId} onChange={e => set({ repoId: e.target.value })}><option value="">No repository yet</option>{state.repos.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>}
      <Field label="Owner" hint="One primary engineer"><PersonSelect value={f.ownerId} onChange={v => set({ ownerId: v })} /></Field>
      {!apiMode && <Field label="Reviewer" error={err.reviewerId}><PersonSelect value={f.reviewerId} onChange={v => set({ reviewerId: v })} emptyLabel="No reviewer" /></Field>}
      {!apiMode && <Field label="QA contact" error={err.qaId}><PersonSelect value={f.qaId} onChange={v => set({ qaId: v })} emptyLabel="No QA contact" /></Field>}
      {editing && <Field label="Repository"><select value={f.repoId} onChange={e => set({ repoId: e.target.value })}><option value="">No repository yet</option>{state.repos.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>}
      {!apiMode && <Field label="Start date"><input type="date" value={f.start} onChange={e => set({ start: e.target.value })} /></Field>}
      <Field label="Due date" error={err.due}><input type="date" value={f.due} onChange={e => set({ due: e.target.value, ...(editing ? {} : { eta: e.target.value }) })} /></Field>
      {editing && !apiMode && <Field label="Estimated completion (ETA)" error={err.eta} hint="When the owner expects to finish"><input type="date" value={f.eta} onChange={e => set({ eta: e.target.value })} /></Field>}
      <Field label="One-line summary" error={err.summary} full><input type="text" value={f.summary} onChange={e => set({ summary: e.target.value })} placeholder="What this component does, in one sentence" /></Field>
      <Field label="Purpose" full><textarea rows={2} value={f.purpose} onChange={e => set({ purpose: e.target.value })} placeholder="Why it matters and what problem it solves" /></Field>
      <Field label="Expected deliverable" error={err.deliverable} full hint="Measurable; linked to acceptance criteria"><textarea rows={2} value={f.deliverable} onChange={e => set({ deliverable: e.target.value })} /></Field>
      <div className="field field-full"><label>Depends on</label><DepPicker value={f.deps} onChange={v => set({ deps: v })} selfId={selfId} /></div>
      {editing && !apiMode && <Field label="Reason for change" hint="Recorded in the change history for owner, status and date changes" full><input type="text" value={f.reason} onChange={e => set({ reason: e.target.value })} placeholder="e.g. Scope grew after the client workshop" /></Field>}
    </div>
  );
}

function validate(f: FormState, editing: boolean) {
  const e: Record<string, string> = {};
  if (!f.name.trim()) e.name = "Give the component a name.";
  if (!f.summary.trim()) e.summary = "Add a one-line summary so people know what it is.";
  if (!f.deliverable.trim()) e.deliverable = "Describe what the owner is expected to deliver.";
  if (f.due < f.start) e.due = "Due date can't be before the start date.";
  if (editing && f.eta < f.start) e.eta = "ETA can't be before the start date.";
  if (f.ownerId && f.reviewerId && f.ownerId === f.reviewerId) e.reviewerId = "The reviewer must be someone other than the owner.";
  if (f.ownerId && f.qaId && f.ownerId === f.qaId) e.qaId = "The QA contact must be someone other than the owner.";
  return e;
}

export function NewComponentModal({ onClose }: { onClose: () => void }) {
  const { state, createComponent, apiMode } = useStore();
  const { go } = useNav();
  const { toast } = useToast();
  const t = iso(today());
  const [f, setF] = useState<FormState>({ name: "", category: CATEGORIES[0], projectId: "core", priority: "medium", status: "not_started", ownerId: null, reviewerId: null, qaId: null, start: t, due: addDays(t, 30), eta: addDays(t, 30), repoId: "", deps: [], summary: "", purpose: "", deliverable: "", reason: "" });
  const [err, setErr] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = (p: Partial<FormState>) => setF(x => ({ ...x, ...p }));
  const save = async () => {
    if (saving) return;
    const e = validate(f, false); setErr(e); if (Object.keys(e).length) return;
    const id = nextComponentId(state, f.projectId);
    const repo = state.repos.find(r => r.id === f.repoId);
    const c: Component = {
      id, name: f.name.trim(), category: f.category, projectId: f.projectId, summary: f.summary.trim(), purpose: f.purpose.trim() || f.summary.trim(), deliverable: f.deliverable.trim(),
      details: `## Description\n\n${f.summary.trim()} ${f.purpose.trim()}\n\n## Scope\n\n- _To be defined with the owner at kickoff_\n\n## Expected deliverable\n\n${f.deliverable.trim()}\n\n## Documentation\n\n- Component note: \`docs/component/${id.toLowerCase()}.md\``,
      ownerId: f.ownerId, reviewerId: f.reviewerId, qaId: f.qaId, priority: f.priority, status: "not_started", review: "none",
      start: f.start, due: f.due, eta: f.due, deps: f.deps, repoId: f.repoId || null, products: [], skills: [],
      criteria: [], gates: { checks: { state: repo ? "pending" : "unknown" }, qa: { state: "not_submitted" }, deploy: { state: "not_ready" } },
      onboarding: { branch: repo ? `feature/${id.toLowerCase()}` : "—", folders: [], setup: repo ? `Clone \`${repo.name}\` and follow its README. Branch from \`${repo.defaultBranch}\` as \`feature/${id.toLowerCase()}-<short-name>\`.` : "Create the repository from `apex-infra/templates/service`, then link it to this component.", env: [], tools: [] },
      links: repo ? [{ id: "ln" + Date.now(), kind: "github", label: `${repo.org}/${repo.name}`, url: repo.url, ref: repo.name }] : [],
      architecture: [], comments: [], createdAt: nowIso(), updatedAt: nowIso(),
    };
    setSaving(true);
    try {
      if (await createComponent(c)) { toast(`${id} created`); onClose(); go("c-" + id); }
    } finally { setSaving(false); }
  };
  return (
    <Modal title="New component" sub="Define it well once; the owner's onboarding pack is built from these fields." onClose={onClose} wide
      footer={<><Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button><Button variant="primary" onClick={save} icon="check" disabled={saving}>{saving ? "Creating…" : "Create component"}</Button></>}>
      {apiMode && <p className="muted" style={{ fontSize: 13 }}>This component will be created in the backend. Dependencies are validated by the server.</p>}
      <ComponentFields f={f} set={set} err={err} />
    </Modal>
  );
}

export function EditComponentModal({ c, onClose }: { c: Component; onClose: () => void }) {
  const { updateComponent, apiMode } = useStore();
  const { toast } = useToast();
  const [f, setF] = useState<FormState>({ name: c.name, category: c.category, projectId: c.projectId, priority: c.priority, status: c.status, ownerId: c.ownerId, reviewerId: c.reviewerId, qaId: c.qaId, start: c.start, due: c.due, eta: c.eta, repoId: c.repoId || "", deps: c.deps, summary: c.summary, purpose: c.purpose, deliverable: c.deliverable, reason: "" });
  const [err, setErr] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = (p: Partial<FormState>) => setF(x => ({ ...x, ...p }));
  const save = async () => {
    if (saving) return;
    const e = validate(f, true); setErr(e); if (Object.keys(e).length) return;
    const { reason, repoId, ...rest } = f;
    setSaving(true);
    try {
      if (await updateComponent(c.id, { ...rest, name: f.name.trim(), repoId: repoId || null }, reason.trim() || undefined)) {
        toast("Changes saved"); onClose();
      }
    } finally { setSaving(false); }
  };
  return (
    <Modal title={`Edit ${c.id}`} sub={c.name} onClose={onClose} wide footer={<><Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button><Button variant="primary" onClick={save} icon="check" disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button></>}>
      {apiMode && <p className="muted" style={{ fontSize: 13 }}>Supported component fields are saved to the backend. Fields without backend support are hidden.</p>}
      <ComponentFields f={f} set={set} err={err} editing selfId={c.id} />
    </Modal>
  );
}

/** Assign or reassign. Reassigning an active component starts a handoff with a checklist. */
export function AssignModal({ c, onClose }: { c: Component; onClose: () => void }) {
  const { state, person, apiMode, updateComponent, startHandoff } = useStore();
  const { toast } = useToast();
  const [ownerId, setOwner] = useState(c.ownerId);
  const [reviewerId, setReviewer] = useState(c.reviewerId);
  const [qaId, setQa] = useState(c.qaId);
  const [reason, setReason] = useState("");
  const needsHandoff = !!c.ownerId && ownerId !== c.ownerId && !!ownerId && c.status !== "not_started" && !isDone(c);
  const [ho, setHo] = useState({ completed: "", outstanding: "", knownIssues: "", target: addDays(iso(today()), 3) });
  const [err, setErr] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const load = useMemo(() => (id: string | null) => state.components.filter(x => x.ownerId === id && !isDone(x)).length, [state]);
  const save = async () => {
    if (saving) return;
    const e: Record<string, string> = {};
    if (ownerId && reviewerId && ownerId === reviewerId) e.reviewer = "The reviewer must be someone other than the owner.";
    if (ownerId && qaId && ownerId === qaId) e.qa = "The QA contact must be someone other than the owner.";
    if (!apiMode && c.ownerId && ownerId !== c.ownerId && !reason.trim()) e.reason = "Say why ownership is changing; it's kept in the history.";
    if (!apiMode && needsHandoff && !ho.outstanding.trim()) e.outstanding = "List the work the new owner picks up.";
    setErr(e); if (Object.keys(e).length) return;
    if (apiMode) {
      setSaving(true);
      try {
        if (await updateComponent(c.id, { ownerId, reviewerId, qaId })) { toast("Assignment saved"); onClose(); }
      } finally { setSaving(false); }
      return;
    }
    if (needsHandoff) {
      startHandoff({ componentId: c.id, fromId: c.ownerId!, toId: ownerId!, reason: reason.trim(), completed: ho.completed.trim() || "—", outstanding: ho.outstanding.trim(), knownIssues: ho.knownIssues.trim() || "None recorded.", target: ho.target,
        checklist: ["Code and repository walkthrough", "Access to repositories, environments and dashboards", "Open pull requests and issues reassigned", "Outstanding acceptance criteria agreed with the reviewer"].map((t, i) => ({ id: "c" + i, text: t, done: false })) });
      updateComponent(c.id, { reviewerId, qaId });
      toast(`Handoff started. ${person(ownerId)?.first} needs to acknowledge it.`);
    } else {
      updateComponent(c.id, { ownerId, reviewerId, qaId }, reason.trim() || undefined);
      toast("Assignment saved");
    }
    onClose();
  };
  const ownerLoad = ownerId ? load(ownerId) - (c.ownerId === ownerId ? 1 : 0) : 0;
  return (
    <Modal title="Assign people" sub={`${c.id} · ${c.name}`} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button><Button variant="primary" onClick={save} icon="check" disabled={saving}>{saving ? "Saving…" : !apiMode && needsHandoff ? "Start handoff" : "Save assignment"}</Button></>}>
      <Field label="Owner" hint={ownerId ? (ownerLoad > 0 ? `Already owns ${ownerLoad} active component${ownerLoad > 1 ? "s" : ""}. Apex has not recorded a limit, so this is a fact rather than a warning.` : "Owns nothing else that is still open.") : "Leave unassigned to list it under Unassigned work."}>
        <PersonSelect value={ownerId} onChange={setOwner} />
      </Field>
      <Field label="Reviewer" error={err.reviewer}><PersonSelect value={reviewerId} onChange={setReviewer} emptyLabel="No reviewer" /></Field>
      <Field label="QA contact" error={err.qa}><PersonSelect value={qaId} onChange={setQa} emptyLabel="No QA contact" /></Field>
      {!apiMode && c.ownerId && ownerId !== c.ownerId && <Field label="Reason for reassignment" error={err.reason}><input type="text" value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Moving to the DOCAI go-live" /></Field>}
      {!apiMode && needsHandoff && (
        <div style={{ display: "grid", gap: 14, padding: 14, border: "1px solid var(--line)", borderRadius: 12, background: "var(--surface-2)" }}>
          <div className="row"><Icon name="handoff" size={16} /><b>Handoff from {person(c.ownerId)?.first} to {person(ownerId)?.first}</b><Pill tone="info">Needs acknowledgement</Pill></div>
          <Field label="Completed so far"><textarea rows={2} value={ho.completed} onChange={e => setHo({ ...ho, completed: e.target.value })} /></Field>
          <Field label="Outstanding work" error={err.outstanding}><textarea rows={2} value={ho.outstanding} onChange={e => setHo({ ...ho, outstanding: e.target.value })} /></Field>
          <Field label="Known issues"><textarea rows={2} value={ho.knownIssues} onChange={e => setHo({ ...ho, knownIssues: e.target.value })} /></Field>
          <Field label="Target handover date"><input type="date" value={ho.target} onChange={e => setHo({ ...ho, target: e.target.value })} /></Field>
        </div>
      )}
      {apiMode && <p className="muted" style={{ fontSize: 13 }}>Owner, reviewer, and QA contact are saved to the backend. Reassignment reasons and handoff checklists remain demo-only.</p>}
    </Modal>
  );
}
