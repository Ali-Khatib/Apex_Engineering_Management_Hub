/**
 * Apex HQ governance screens: the Engineering Constitution, component
 * templates, the people directory and, on every component, its specification,
 * AI Build Contract and compliance review.
 *
 * Everything here talks to the backend. With no VITE_API_URL the pages show a
 * read-only demo copy and say so, instead of pretending to save.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useStore, useToast } from "../store";
import { Icon } from "../icons";
import { Button, PageHeader, Section, Pill, Avatar, Modal, Drawer, Field, Empty, Tabs, Markdown, CopyText, cx } from "../ui";
import { fmtDate } from "../logic";
import type { Component } from "../types";
import * as G from "../governance";

const useLoad = <T,>(fn: () => Promise<T>, deps: React.DependencyList) => {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true); setError("");
    fn().then(d => { if (live) { setData(d); setLoading(false); } })
      .catch(e => { if (live) { setError(G.apiProblems(e).message); setLoading(false); } });
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, setData, error, loading, reload: () => setTick(t => t + 1) };
};

const DemoNote = ({ what }: { what: string }) => (
  <div className="hq-note" role="status"><Icon name="info" size={15} /><span>Demo copy. {what} Nothing here can be changed or saved until the backend is connected.</span></div>
);
const ErrorNote = ({ msg, onRetry }: { msg: string; onRetry?: () => void }) => (
  <div className="hq-note hq-note-crit" role="alert"><Icon name="alert" size={15} /><span>{msg}</span>{onRetry && <Button size="sm" variant="ghost" onClick={onRetry}>Try again</Button>}</div>
);
const when = (s: string | null | undefined) => (s ? fmtDate(s.slice(0, 10)) : "—");

/* ═════════════════════ Engineering Constitution ═════════════════════ */

export function Constitution() {
  const { apiMode, isAdmin } = useStore();
  const { toast } = useToast();
  const live = useLoad(() => (apiMode ? G.getConstitution() : Promise.resolve(null)), [apiMode]);
  const [editing, setEditing] = useState(false);
  const [view, setView] = useState<number | null>(null);
  const old = useLoad(() => (apiMode && view ? G.getConstitutionVersion(view) : Promise.resolve(null)), [apiMode, view]);

  const rules = apiMode ? live.data?.rules ?? [] : G.DEMO_CONSTITUTION;
  const shown = view && old.data ? old.data.rules : rules;
  const slop = shown.filter(r => r.group === "ai_slop");
  const core = shown.filter(r => r.group !== "ai_slop");
  return (
    <>
      <PageHeader eyebrow="Governance" title="Apex Engineering Constitution"
        sub="The rules every engineer and every AI coding agent follows on every component. The server writes them into each AI Build Contract. Nothing a component says can change them."
        actions={apiMode && isAdmin && !view && <Button variant="primary" icon="edit" onClick={() => setEditing(true)}>Edit rules</Button>} />
      {!apiMode && <DemoNote what="The real Constitution is versioned and published by admins on the server." />}
      {apiMode && live.error && <ErrorNote msg={live.error} onRetry={live.reload} />}
      <div className="split">
        <div className="hq-glow" data-glow={view ? "off" : "on"}>
          <Section title={view ? `Version ${view}` : apiMode && live.data ? `Version ${live.data.version} · in force` : "Mandatory rules"}
            sub={view ? "An earlier version, kept for the record." : "Non-negotiable. Every Build Contract carries these first."}
            actions={view ? <Button size="sm" variant="ghost" onClick={() => setView(null)}>Back to current</Button> : undefined}>
            <RuleGroup title="Engineering rules" rules={core} />
            {slop.length > 0 && <RuleGroup title="AI slop blockers" tone="slop" rules={slop}
              intro="Company-wide. They apply to every engineer and every AI builder on every component, on top of the rules above." />}
            {apiMode && live.loading && <div className="panel-body muted">Loading…</div>}
          </Section>
        </div>
        <div className="stack-v">
          <Section title="How it is enforced" className="hq-aside">
            <div className="panel-body hq-prose">
              <p>The Constitution is context for builders, not a lock on them. A model can still ignore text, so the platform also enforces what it can:</p>
              <ul>
                <li>Authorization and permissions are checked by the server on every request. No prompt changes them.</li>
                <li>Component content is passed to builders as data, in its own block, apart from these rules.</li>
                <li>A component can be required to pass a human-approved compliance review before it is marked complete.</li>
              </ul>
            </div>
          </Section>
          {apiMode && live.data && (
            <Section title="History" sub="Every published version is kept.">
              <ul className="hq-list">
                {live.data.history.map(h => (
                  <li key={h.version}>
                    <button className="hq-link" onClick={() => setView(h.version === live.data!.version ? null : h.version)}>Version {h.version}</button>
                    <span className="muted">{h.rules} rules · {when(h.created_at)}</span>
                    {h.note && <small className="muted">{h.note}</small>}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      </div>
      {editing && live.data && <EditConstitution current={live.data} onClose={() => setEditing(false)}
        onSaved={c => { live.setData(c); setEditing(false); toast(`Version ${c.version} published`); live.reload(); }} />}
    </>
  );
}

function RuleGroup({ title, rules, tone, intro }: { title: string; rules: G.ConstitutionRule[]; tone?: "slop"; intro?: string }) {
  return (
    <div className={cx("hq-rulegroup", tone && "is-" + tone)}>
      <h3 className="hq-rulegroup-h">{title} <small>{rules.length}</small></h3>
      {intro && <p className="hq-rulegroup-intro">{intro}</p>}
      <ol className="hq-rules">
        {rules.map(r => <li key={r.id}><code className="cid">{r.id}</code><span>{r.text}</span></li>)}
      </ol>
    </div>
  );
}

function EditConstitution({ current, onClose, onSaved }: { current: G.Constitution; onClose: () => void; onSaved: (c: G.Constitution) => void }) {
  const [rows, setRows] = useState<{ id?: string; text: string; group?: "core" | "ai_slop" }[]>(current.rules.map(r => ({ ...r })));
  const [note, setNote] = useState("");
  const [err, setErr] = useState<G.Problems | null>(null);
  const [busy, setBusy] = useState(false);
  const removed = current.rules.filter(r => !rows.some(x => x.id === r.id)).map(r => r.id);
  const save = async () => {
    setBusy(true); setErr(null);
    try { onSaved(await G.publishConstitution(rows.filter(r => r.text.trim()).map(r => ({ id: r.id, text: r.text, group: r.group ?? "core" })), note)); }
    catch (e) { setErr(G.apiProblems(e)); } finally { setBusy(false); }
  };
  return (
    <Modal wide title="Publish a new Constitution version" sub="Old versions stay on record. Removing a rule needs a written reason."
      onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={busy}>{busy ? "Publishing…" : "Publish version"}</Button></>}>
      <div className="stack-v">
        <ol className="hq-edit-rules">
          {rows.map((r, i) => (
            <li key={r.id ?? `new-${i}`}>
              <span><code className="cid">{r.id ?? "new"}</code>{r.group === "ai_slop" && <small className="hq-tag-slop">AI slop</small>}</span>
              <textarea rows={2} value={r.text} aria-label={`Rule ${r.id ?? "new"}`} onChange={e => setRows(rows.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
              <Button size="sm" variant="ghost" icon="trash" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="Remove rule" />
            </li>
          ))}
        </ol>
        <div className="row"><Button size="sm" icon="plus" onClick={() => setRows([...rows, { text: "" }])}>Add rule</Button>
          <Button size="sm" icon="plus" onClick={() => setRows([...rows, { text: "", group: "ai_slop" }])}>Add AI slop blocker</Button></div>
        <Field label="What changed and why" full hint={removed.length ? `Required: you are removing ${removed.join(", ")}.` : "Optional unless a rule is removed."}>
          <textarea rows={2} value={note} onChange={e => setNote(e.target.value)} />
        </Field>
        {err && <ErrorNote msg={[err.message, ...err.list.filter(x => x !== err.message)].join(" ")} />}
      </div>
    </Modal>
  );
}

/* ═════════════════════ Component templates ═════════════════════ */

export function Templates() {
  const { apiMode, isAdmin } = useStore();
  const { toast } = useToast();
  const list = useLoad(() => (apiMode ? G.listTemplates() : Promise.resolve([] as G.Template[])), [apiMode]);
  const [sel, setSel] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const templates = list.data ?? [];
  const cur = templates.find(t => t.id === sel) ?? templates.find(t => t.is_default) ?? templates[0];
  const detail = useLoad(() => (apiMode && cur ? G.getTemplate(cur.id) : Promise.resolve(null)), [apiMode, cur?.id, cur?.version]);
  const sections = apiMode ? detail.data?.sections ?? cur?.sections ?? [] : G.DEMO_TEMPLATE_SECTIONS;
  return (
    <>
      <PageHeader eyebrow="Governance" title="Component templates"
        sub="Every component is specified against one template, so each one answers the same questions. Editing a template publishes a new version. Components keep the version they were written against."
        actions={apiMode && isAdmin && <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>New template</Button>} />
      {!apiMode && <DemoNote what="Real templates are versioned and managed by admins on the server." />}
      {apiMode && list.error && <ErrorNote msg={list.error} onRetry={list.reload} />}
      <div className="split">
        <Section title={apiMode ? cur?.name ?? "Template" : "Apex Component Engineering Spec"}
          sub={apiMode && cur ? `Version ${cur.version}${cur.is_default ? " · default" : ""}${cur.is_active ? "" : " · archived"}` : "Default template"}
          actions={apiMode && isAdmin && cur ? <Button size="sm" icon="edit" onClick={() => setEditing(true)}>Edit sections</Button> : undefined}>
          <div className="table-wrap"><table className="tbl hq-tbl">
            <thead><tr><th>Section</th><th>Required</th><th>Guidance</th></tr></thead>
            <tbody>{sections.map(s => (
              <tr key={s.key}>
                <td className="hq-first"><b style={{ fontWeight: 600 }}>{s.label}</b><br /><code className="cid">{s.key}</code></td>
                <td data-label="Required">{s.required ? <Pill tone="brand">Required</Pill> : <Pill tone="faint">Optional</Pill>}</td>
                <td className="muted" data-label="Guidance">{s.hint || "—"}
                  {s.boilerplate && <details className="hq-baseline"><summary>Baseline sent with every component</summary><pre className="hq-pre">{s.boilerplate}</pre></details>}</td>
              </tr>))}</tbody>
          </table></div>
        </Section>
        <div className="stack-v">
          {apiMode && templates.length > 1 && (
            <Section title="Templates">
              <ul className="hq-list">{templates.map(t => (
                <li key={t.id}><button className={cx("hq-link", t.id === cur?.id && "on")} onClick={() => setSel(t.id)}>{t.name}</button>
                  <span className="muted">v{t.version}{t.is_default ? " · default" : ""}</span></li>))}</ul>
            </Section>
          )}
          {apiMode && detail.data?.versions && (
            <Section title="Versions"><ul className="hq-list">{detail.data.versions.map(v => (
              <li key={v.version}><b>v{v.version}</b><span className="muted">{when(v.created_at)}</span>{v.note && <small className="muted">{v.note}</small>}</li>))}</ul></Section>
          )}
          <Section title="What a template can and cannot do"><div className="panel-body hq-prose">
            <p>Admins can relabel sections, mark them required, change the guidance and add new sections. The ten core sections cannot be removed, so no component loses the ability to describe its architecture, guardrails or acceptance criteria.</p>
            <p>A section can carry baseline text. That text goes to the AI builder on every component using the template, ahead of the component's own content. Components add specifics beside it. They cannot edit or remove it.</p>
            <p>Sections that already live on a component, such as its description or architecture, keep using those fields. Nothing is copied or overwritten.</p>
          </div></Section>
        </div>
      </div>
      {editing && cur && detail.data && <EditTemplate t={detail.data} onClose={() => setEditing(false)}
        onSaved={() => { setEditing(false); toast("New template version published"); list.reload(); detail.reload(); }} />}
      {creating && <NewTemplate onClose={() => setCreating(false)} onCreated={t => { setCreating(false); setSel(t.id); toast(`${t.name} created`); list.reload(); }} />}
    </>
  );
}

function SectionEditor({ rows, setRows }: { rows: G.TemplateSection[]; setRows: (r: G.TemplateSection[]) => void }) {
  const set = (i: number, p: Partial<G.TemplateSection>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <div className="stack-v" style={{ gap: 12 }}>
      {rows.map((r, i) => {
        const core = G.CORE_SECTION_KEYS.includes(r.key);
        return (
          <div className="hq-sec-row" key={r.key + i}>
            <div className="row-between"><code className="cid">{r.key}{core ? " · core" : ""}</code>
              <span className="row">
                <label className="hq-check-inline"><input type="checkbox" checked={r.required} onChange={e => set(i, { required: e.target.checked })} /> Required</label>
                {!core && <Button size="sm" variant="ghost" icon="trash" aria-label={`Remove ${r.label}`} onClick={() => setRows(rows.filter((_, j) => j !== i))} />}
              </span></div>
            <input type="text" value={r.label} aria-label="Section label" onChange={e => set(i, { label: e.target.value })} />
            <input type="text" value={r.hint} aria-label="Guidance" placeholder="Guidance for whoever fills this in" onChange={e => set(i, { hint: e.target.value })} />
            <textarea rows={r.boilerplate ? 6 : 2} value={r.boilerplate ?? ""} aria-label="Baseline text" maxLength={4000}
              placeholder="Optional baseline text. Sent to the AI builder on every component that uses this template. Components can add to it but cannot remove it."
              onChange={e => set(i, { boilerplate: e.target.value })} />
          </div>
        );
      })}
      <div><Button size="sm" icon="plus" onClick={() => {
        const n = rows.filter(r => r.key.startsWith("section_")).length + 1;
        setRows([...rows, { key: `section_${n}`, label: "New section", required: false, hint: "" }]);
      }}>Add section</Button></div>
    </div>
  );
}

function EditTemplate({ t, onClose, onSaved }: { t: G.Template; onClose: () => void; onSaved: () => void }) {
  const [rows, setRows] = useState<G.TemplateSection[]>(t.sections.map(s => ({ ...s })));
  const [note, setNote] = useState("");
  const [err, setErr] = useState<G.Problems | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setErr(null);
    try { await G.updateTemplate(t.id, { sections: rows, note }); onSaved(); }
    catch (e) { setErr(G.apiProblems(e)); } finally { setBusy(false); }
  };
  return (
    <Modal wide title={`Edit ${t.name}`} sub={`Saving publishes version ${t.version + 1}.`} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={busy}>{busy ? "Publishing…" : "Publish version"}</Button></>}>
      <div className="stack-v">
        <SectionEditor rows={rows} setRows={setRows} />
        <Field label="What changed" full><input type="text" value={note} onChange={e => setNote(e.target.value)} /></Field>
        {err && <ErrorNote msg={[err.message, ...err.list.filter(x => x !== err.message)].join(" · ")} />}
      </div>
    </Modal>
  );
}

function NewTemplate({ onClose, onCreated }: { onClose: () => void; onCreated: (t: G.Template) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [err, setErr] = useState("");
  const save = async () => {
    try { onCreated(await G.createTemplate({ name, description, sections: G.DEMO_TEMPLATE_SECTIONS })); }
    catch (e) { setErr(G.apiProblems(e).message); }
  };
  return (
    <Modal title="New template" sub="Starts from the standard ten sections. Edit them after it is created." onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={!name.trim()}>Create</Button></>}>
      <div className="form-grid">
        <Field label="Name" full error={err}><input type="text" value={name} onChange={e => setName(e.target.value)} /></Field>
        <Field label="Description" full><textarea rows={2} value={description} onChange={e => setDescription(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

/* ═════════════════════ People directory ═════════════════════ */

const BLANK: G.NewHqUser = { first_name: "", last_name: "", designation: "", department: "", email: "", phone: "", linkedin_url: "", vpn_id: "", github_id: "", website_url: "", role: "member", password: "" };

export function PeopleDirectory() {
  const { me, isAdmin } = useStore();
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const list = useLoad(() => G.hqUsers(isAdmin && showInactive), [isAdmin, showInactive]);
  const people = list.data ?? [];
  const depts = useMemo(() => [...new Set(people.map(p => p.department).filter(Boolean))].sort(), [people]);
  const shown = people.filter(p => (!dept || p.department === dept) &&
    (!q || `${p.first_name} ${p.last_name} ${p.email} ${p.designation} ${p.department}`.toLowerCase().includes(q.toLowerCase())));
  const asPerson = (p: G.HqUser) => ({ id: String(p.id), first: p.first_name, last: p.last_name, email: p.email, role: p.role, title: p.designation, team: p.department, skills: [], hue: 0, joined: "", active: p.is_active });
  return (
    <>
      <PageHeader title="Team directory" sub="Everyone on Apex HQ. Phone numbers, VPN IDs and LinkedIn addresses are private: only admins and the person themselves can see them."
        actions={isAdmin && <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Add person</Button>} />
      <div className="toolbar">
        <div className="input-ic grow"><Icon name="search" size={15} /><input type="search" placeholder="Search people" value={q} onChange={e => setQ(e.target.value)} aria-label="Search people" /></div>
        <select value={dept} onChange={e => setDept(e.target.value)} aria-label="Department" style={{ height: 36, width: 180 }}>
          <option value="">All departments</option>{depts.map(d => <option key={d}>{d}</option>)}
        </select>
        {isAdmin && <label className="hq-check-inline"><input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Show deactivated</label>}
      </div>
      {list.error && <ErrorNote msg={list.error} onRetry={list.reload} />}
      <section className="panel" style={{ overflow: "hidden" }}>
        {!list.loading && shown.length === 0 ? <Empty icon="team" title="Nobody matches" /> :
          <div className="table-wrap"><table className="tbl hq-tbl">
            <thead><tr><th>Person</th><th>Department</th><th>Email</th><th>Role</th><th>Status</th></tr></thead>
            <tbody>{shown.map(p => (
              <tr key={p.id} className="clickable" onClick={() => setOpen(p.id)}>
                <td className="hq-first"><span className="row" style={{ gap: 10, flexWrap: "nowrap" }}><Avatar p={asPerson(p)} size={32} />
                  <span><button className="hq-link" onClick={e => { e.stopPropagation(); setOpen(p.id); }}><b style={{ fontWeight: 600 }}>{p.first_name} {p.last_name}</b></button>{p.id === Number(me?.id) && <span className="muted"> (you)</span>}<small className="muted" style={{ display: "block" }}>{p.designation || "No designation yet"}</small></span></span></td>
                <td data-label="Department">{p.department || <span className="muted">—</span>}</td>
                <td data-label="Email"><CopyText text={p.email} /></td>
                <td data-label="Role"><Pill tone={p.role === "admin" ? "brand" : "faint"}>{p.role === "admin" ? "Admin" : "Member"}</Pill></td>
                <td data-label="Status">{p.is_active ? <Pill tone="ok" dot>Active</Pill> : <Pill tone="faint">Deactivated</Pill>}</td>
              </tr>))}</tbody>
          </table></div>}
      </section>
      {open !== null && <Profile id={open} onClose={() => setOpen(null)} onChanged={list.reload} />}
      {adding && <PersonForm onClose={() => setAdding(false)} onSaved={u => { setAdding(false); toast(`${u.first_name} added`); list.reload(); }} />}
    </>
  );
}

function Profile({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { me, isAdmin } = useStore();
  const { toast } = useToast();
  const { data: p, error, reload, setData } = useLoad(() => G.hqUser(id), [id]);
  const [editing, setEditing] = useState(false);
  const mine = p ? p.id === Number(me?.id) : false;
  const act = async (fn: () => Promise<G.HqUser>, msg: string) => {
    try { setData(await fn()); toast(msg); onChanged(); } catch (e) { toast(G.apiProblems(e).message); }
  };
  const priv = p && p.vpn_id !== undefined;
  return (
    <Drawer title={p ? `${p.first_name} ${p.last_name}` : "Profile"} sub={p ? `${p.designation || "No designation yet"}${p.department ? " · " + p.department : ""}` : undefined} onClose={onClose}
      footer={p && (isAdmin || mine) ? <>
        {isAdmin && !mine && (p.is_active
          ? <Button variant="ghost" onClick={() => act(() => G.deactivateHqUser(p.id), `${p.first_name} deactivated`)}>Deactivate</Button>
          : <Button variant="ghost" onClick={() => act(() => G.reactivateHqUser(p.id), `${p.first_name} reactivated`)}>Reactivate</Button>)}
        <Button variant="primary" icon="edit" onClick={() => setEditing(true)}>{mine && !isAdmin ? "Edit my contact details" : "Edit"}</Button>
      </> : undefined}>
      {error && <ErrorNote msg={error} onRetry={reload} />}
      {p && (
        <div className="stack-v">
          <dl className="hq-facts">
            <div><dt>Email</dt><dd><CopyText text={p.email} /></dd></div>
            <div><dt>Role</dt><dd>{p.role === "admin" ? "Admin" : "Member"}</dd></div>
            <div><dt>Status</dt><dd>{p.is_active ? "Active" : "Deactivated. Kept on record, cannot sign in."}</dd></div>
            <div><dt>GitHub</dt><dd>{p.github_id ? <a href={`https://github.com/${p.github_id}`} target="_blank" rel="noreferrer noopener">{p.github_id}</a> : <span className="muted">Not provided</span>}</dd></div>
            <div><dt>Website</dt><dd>{p.website_url ? <a href={p.website_url} target="_blank" rel="noreferrer noopener">{p.website_url}</a> : <span className="muted">Not provided</span>}</dd></div>
            <div><dt>Joined</dt><dd>{when(p.created_at)}</dd></div>
          </dl>
          {priv ? (
            <div className="hq-private">
              <h3><Icon name="lock" size={14} /> Private</h3>
              <p className="muted">{mine ? "Only you and admins can see these." : "You can see these because you are an admin. Reading them is recorded in the audit log."}</p>
              <dl className="hq-facts">
                <div><dt>Phone</dt><dd>{p.phone || <span className="muted">Not provided</span>}</dd></div>
                <div><dt>LinkedIn</dt><dd>{p.linkedin_url ? <a href={p.linkedin_url} target="_blank" rel="noreferrer noopener">{p.linkedin_url}</a> : <span className="muted">Not provided</span>}</dd></div>
                <div><dt>VPN ID</dt><dd>{p.vpn_id || <span className="muted">Not provided</span>}</dd></div>
              </dl>
            </div>
          ) : <p className="muted hq-private-note"><Icon name="lock" size={14} /> Phone, LinkedIn and VPN ID are private to this person and to admins.</p>}
        </div>
      )}
      {editing && p && <PersonForm user={p} selfOnly={mine && !isAdmin} onClose={() => setEditing(false)}
        onSaved={u => { setEditing(false); setData(u); toast("Saved"); onChanged(); }} />}
    </Drawer>
  );
}

function PersonForm({ user, selfOnly, onClose, onSaved }: { user?: G.HqUser; selfOnly?: boolean; onClose: () => void; onSaved: (u: G.HqUser) => void }) {
  const creating = !user;
  const [f, setF] = useState<G.NewHqUser>(user ? { ...BLANK, first_name: user.first_name, last_name: user.last_name, designation: user.designation, department: user.department,
    email: user.email, phone: user.phone ?? "", linkedin_url: user.linkedin_url ?? "", vpn_id: user.vpn_id ?? "", github_id: user.github_id, website_url: user.website_url, role: user.role } : BLANK);
  const [err, setErr] = useState<Record<string, string>>({});
  const [top, setTop] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof G.NewHqUser) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true); setErr({}); setTop("");
    try {
      let saved: G.HqUser;
      if (creating) saved = await G.createHqUser(f);
      else if (selfOnly) saved = await G.updateMyContact({ phone: f.phone, linkedin_url: f.linkedin_url, github_id: f.github_id, website_url: f.website_url });
      else { const { password: _p, ...patch } = f; saved = await G.updateHqUser(user!.id, patch); }
      onSaved(saved);
    } catch (e) { const pr = G.apiProblems(e); setErr(pr.fields); setTop(Object.keys(pr.fields).length ? "" : pr.message); }
    finally { setBusy(false); }
  };
  const lock = !!selfOnly;
  return (
    <Modal wide title={creating ? "Add person" : selfOnly ? "Edit my contact details" : `Edit ${user!.first_name}`}
      sub={creating ? "Every field except GitHub and website is required." : undefined} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button></>}>
      <div className="form-grid">
        <Field label="First name" error={err.first_name}><input type="text" value={f.first_name} onChange={set("first_name")} disabled={lock} /></Field>
        <Field label="Last name" error={err.last_name}><input type="text" value={f.last_name} onChange={set("last_name")} disabled={lock} /></Field>
        <Field label="Designation" error={err.designation}><input type="text" value={f.designation} onChange={set("designation")} disabled={lock} placeholder="e.g. Backend Engineer" /></Field>
        <Field label="Department" error={err.department}><input type="text" value={f.department} onChange={set("department")} disabled={lock} placeholder="e.g. Platform" /></Field>
        <Field label="Email" error={err.email} full><input type="email" value={f.email} onChange={set("email")} disabled={lock} /></Field>
        <Field label="Phone (private)" error={err.phone}><input type="tel" value={f.phone} onChange={set("phone")} placeholder="+962 79 000 0000" /></Field>
        <Field label="VPN ID (private)" error={err.vpn_id}><input type="text" value={f.vpn_id} onChange={set("vpn_id")} disabled={lock} /></Field>
        <Field label="LinkedIn URL (private)" error={err.linkedin_url} full><input type="url" value={f.linkedin_url} onChange={set("linkedin_url")} placeholder="https://www.linkedin.com/in/…" /></Field>
        <Field label="GitHub ID" error={err.github_id} hint="Optional"><input type="text" value={f.github_id} onChange={set("github_id")} /></Field>
        <Field label="Personal website" error={err.website_url} hint="Optional"><input type="url" value={f.website_url} onChange={set("website_url")} placeholder="https://" /></Field>
        {!selfOnly && <Field label="Role"><select value={f.role} onChange={set("role")}><option value="member">Member</option><option value="admin">Admin</option></select></Field>}
        {creating && <Field label="Initial password" error={err.password} hint="At least 12 characters. Share it privately; they should change it."><input type="password" autoComplete="new-password" value={f.password} onChange={set("password")} /></Field>}
      </div>
      {top && <ErrorNote msg={top} />}
    </Modal>
  );
}

/* ═════════════════════ Component: spec, contract, compliance ═════════════════════ */

const CHECK_TONE: Record<G.CheckStatus, string> = { passed: "ok", failed: "crit", needs_review: "warn" };
const CHECK_LABEL: Record<G.CheckStatus, string> = { passed: "Passed", failed: "Failed", needs_review: "Needs review" };

export function GovernanceTab({ c }: { c: Component }) {
  const { apiMode } = useStore();
  const [sub, setSub] = useState("spec");
  if (!apiMode) return <Section title="Engineering specification, Build Contract and compliance review"><DemoNote what="Specifications, AI Build Contracts and compliance reviews are stored and checked by the server." /></Section>;
  return <ConnectedGovernance c={c} sub={sub} setSub={setSub} />;
}

function ConnectedGovernance({ c, sub, setSub }: { c: Component; sub: string; setSub: (s: string) => void }) {
  const idq = useLoad(() => G.componentApiId(c.id), [c.id]);
  if (idq.error) return <ErrorNote msg={idq.error} onRetry={idq.reload} />;
  if (idq.data == null) return <Section><div className="panel-body muted">Loading…</div></Section>;
  const cid = idq.data;
  return (
    <div className="stack-v">
      <Tabs size="sm" value={sub} onChange={setSub} tabs={[{ id: "spec", label: "Specification" }, { id: "contract", label: "AI Build Contract" }, { id: "review", label: "Compliance review" }]} />
      {sub === "spec" && <SpecPanel cid={cid} c={c} />}
      {sub === "contract" && <ContractPanel cid={cid} />}
      {sub === "review" && <ReviewPanel cid={cid} c={c} />}
    </div>
  );
}

function SpecPanel({ cid, c }: { cid: number; c: Component }) {
  const { isAdmin, me } = useStore();
  const { toast } = useToast();
  const spec = useLoad(() => G.getSpec(cid), [cid]);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState("");
  const mayEdit = isAdmin || c.ownerId === me?.id;
  const s = spec.data;
  const save = async (key: string) => {
    setErr("");
    try { spec.setData(await G.saveSpec(cid, { [key]: draft })); setEditKey(null); toast("Saved"); }
    catch (e) { setErr(G.apiProblems(e).message); }
  };
  if (spec.error) return <ErrorNote msg={spec.error} onRetry={spec.reload} />;
  if (!s) return <Section><div className="panel-body muted">Loading…</div></Section>;
  return (
    <Section title="Engineering specification" sub={`${s.template.name} · version ${s.template.version}${s.template.latest_version > s.template.version ? ` (version ${s.template.latest_version} is available)` : ""}`}
      actions={s.missing_required.length ? <Pill tone="warn">{s.missing_required.length} required section{s.missing_required.length > 1 ? "s" : ""} empty</Pill> : <Pill tone="ok" dot>Complete</Pill>}>
      <div className="hq-spec">
        {s.sections.map(sec => {
          const empty = !sec.items && !(sec.content ?? "").trim();
          const canEdit = mayEdit && sec.storage !== "derived" && (isAdmin || !sec.admin_only);
          return (
            <article key={sec.key} className={cx("hq-spec-sec", empty && sec.required && "gap")}>
              <header>
                <h3>{sec.label}{sec.required && <small> · required</small>}</h3>
                {canEdit && editKey !== sec.key && <Button size="sm" variant="ghost" icon="edit" onClick={() => { setEditKey(sec.key); setDraft(sec.content ?? ""); setErr(""); }}>Edit</Button>}
                {!canEdit && sec.admin_only && sec.storage !== "derived" && <span className="muted" style={{ fontSize: 12 }}><Icon name="lock" size={12} /> Admins edit this</span>}
              </header>
              {sec.boilerplate && <details className="hq-baseline"><summary>Template baseline (applies to every component, set by admins)</summary><pre className="hq-pre">{sec.boilerplate}</pre></details>}
              {editKey === sec.key ? (
                <div className="stack-v" style={{ gap: 8 }}>
                  <textarea rows={7} value={draft} onChange={e => setDraft(e.target.value)} aria-label={sec.label} />
                  {err && <ErrorNote msg={err} />}
                  <div className="row"><Button size="sm" variant="primary" onClick={() => save(sec.key)}>Save</Button><Button size="sm" variant="ghost" onClick={() => setEditKey(null)}>Cancel</Button></div>
                </div>
              ) : sec.items ? (
                sec.items.length ? <ul className="hq-list">{sec.items.map(d => <li key={d.code}><a href={"#c-" + d.code}><code className="cid">{d.code}</code> {d.name}</a><span className="muted">{d.status.replace(/_/g, " ")}</span></li>)}</ul>
                  : <p className="muted">No prerequisites. {sec.hint}</p>
              ) : empty ? <p className="muted">{sec.hint || "Nothing written yet."}</p> : <Markdown src={sec.content ?? ""} />}
            </article>
          );
        })}
      </div>
    </Section>
  );
}

function ContractPanel({ cid }: { cid: number }) {
  const k = useLoad(() => G.getContract(cid), [cid]);
  const [raw, setRaw] = useState(false);
  const { toast } = useToast();
  if (k.error) return <ErrorNote msg={k.error} onRetry={k.reload} />;
  const c = k.data;
  if (!c) return <Section><div className="panel-body muted">Loading…</div></Section>;
  const copy = async () => { try { await navigator.clipboard.writeText(c.prompt ?? ""); toast("Contract copied"); } catch { toast("Could not copy. Open the contract and copy it by hand."); } };
  return (
    <Section title="AI Build Contract" sub="What an AI builder is given for this component. The server writes the rules, and the component's own text is passed as data."
      actions={<><Button size="sm" icon="copy" onClick={copy}>Copy prompt</Button><Button size="sm" variant="ghost" onClick={() => setRaw(true)}>View contract</Button></>}>
      <div className="panel-body stack-v">
        <dl className="hq-facts">
          <div><dt>Constitution</dt><dd>Version {c.trusted.constitution.version} · {c.trusted.constitution.rules.length} rules</dd></div>
          <div><dt>AI slop blockers</dt><dd>{c.trusted.constitution.rules.filter(r => r.group === "ai_slop").length} company-wide</dd></div>
          <div><dt>Template</dt><dd>{c.template.name ?? "Default"} {c.template.version ? `v${c.template.version}` : ""} · {(c.trusted.template_baseline ?? []).length} baseline section{(c.trusted.template_baseline ?? []).length === 1 ? "" : "s"}</dd></div>
          <div><dt>Contract fingerprint</dt><dd><code>{c.content_hash.slice(0, 12)}</code> <span className="muted">changes when the specification, template or Constitution changes</span></dd></div>
          <div><dt>Acceptance criteria</dt><dd>{c.untrusted.acceptance_criteria.length}</dd></div>
        </dl>
        {c.complete ? <Pill tone="ok" dot>Complete. A builder has everything it needs.</Pill>
          : <div className="hq-note hq-note-warn"><Icon name="alert" size={15} /><span>Incomplete. Missing: {c.missing_required_sections.join(", ")}. A builder would have to guess, and the Constitution forbids guessing.</span></div>}
        {c.context_errors.length > 0 && <ErrorNote msg={c.context_errors.join(". ")} />}
        {c.warnings.map((w, i) => <div key={i} className="hq-note hq-note-warn"><Icon name="alert" size={15} /><span>{w.message}</span></div>)}
        <p className="muted" style={{ fontSize: 12.5 }}>A contract is context. It cannot make a model comply, and it cannot grant permissions. The server checks every request and can require a human-approved compliance review before completion.</p>
      </div>
      {raw && <Modal wide title="Build Contract" sub="Exactly what a builder receives." onClose={() => setRaw(false)} footer={<Button variant="primary" icon="copy" onClick={copy}>Copy</Button>}>
        <pre className="hq-pre">{c.prompt}</pre></Modal>}
    </Section>
  );
}

function ReviewPanel({ cid, c }: { cid: number; c: Component }) {
  const { isAdmin, me } = useStore();
  const { toast } = useToast();
  const rv = useLoad(() => G.listReviews(cid), [cid]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<G.Problems | null>(null);
  const r = rv.data?.[0];
  const mayRun = isAdmin || c.ownerId === me?.id || c.reviewerId === me?.id;
  const mayJudge = (isAdmin || c.reviewerId === me?.id) && c.ownerId !== me?.id;
  const replace = (n: G.Review) => rv.setData(rv.data ? [n, ...rv.data.filter(x => x.id !== n.id)] : [n]);
  const wrap = async (fn: () => Promise<G.Review>, ok: string) => {
    setBusy(true); setMsg(null);
    try { const n = await fn(); rv.setData(null); rv.reload(); toast(ok); return n; }
    catch (e) { setMsg(G.apiProblems(e)); } finally { setBusy(false); }
  };
  const verdict = async (i: number, v: G.Verdict) => {
    if (!r) return; setMsg(null);
    try { replace({ ...(await G.setVerdicts(r.id, [{ index: i, verdict: v, note: r.criteria[i].note }])), current: r.current }); }
    catch (e) { setMsg(G.apiProblems(e)); }
  };
  if (rv.error) return <ErrorNote msg={rv.error} onRetry={rv.reload} />;
  return (
    <Section title="Compliance review" sub="An advisory check of this component against its Build Contract. It only counts once a human reviewer approves it."
      actions={mayRun && <Button size="sm" variant={r ? "secondary" : "primary"} icon="refresh" disabled={busy} onClick={() => wrap(() => G.runReview(cid), "Review run")}>{r ? "Run a new review" : "Run review"}</Button>}>
      <div className="panel-body stack-v">
        {!rv.data && <p className="muted">Loading…</p>}
        {rv.data && !r && <Empty icon="readiness" title="No review yet">Run a review to see which parts of the contract are met, which failed and which need a person to judge.</Empty>}
        {r && (
          <>
            <div className="row" style={{ gap: 10 }}>
              <Pill tone={r.status === "approved" ? "ok" : r.status === "rejected" ? "crit" : "review"} dot>
                {r.status === "approved" ? "Approved by a reviewer" : r.status === "rejected" ? "Rejected" : "Advisory. Not approved."}
              </Pill>
              {r.current === false && <Pill tone="warn">Out of date. The specification changed after this review.</Pill>}
              <span className="muted">Run {when(r.created_at)} · Constitution v{r.constitution_version}</span>
            </div>
            <div className="table-wrap"><table className="tbl hq-tbl">
              <thead><tr><th>Requirement</th><th>Result</th><th>Why</th></tr></thead>
              <tbody>{r.checks.map(x => (
                <tr key={x.id}><td className="hq-first"><b style={{ fontWeight: 600 }}>{x.label}</b></td>
                  <td data-label="Result"><Pill tone={CHECK_TONE[x.status]}>{CHECK_LABEL[x.status]}</Pill></td><td className="muted" data-label="Why">{x.detail}</td></tr>))}</tbody>
            </table></div>
            <div>
              <h3 className="hq-h3">Acceptance criteria</h3>
              {r.criteria.length === 0 ? <p className="muted">None defined. Add them under Specification.</p> : (
                <ul className="hq-crit">{r.criteria.map((k, i) => (
                  <li key={i}>
                    <span>{k.text}{k.note && <small className="muted"> · {k.note}</small>}</span>
                    {r.status === "advisory" && mayJudge ? (
                      <select value={k.verdict} aria-label={`Verdict for criterion ${i + 1}`} onChange={e => verdict(i, e.target.value as G.Verdict)}>
                        <option value="unknown">No verdict</option><option value="met">Met</option><option value="not_met">Not met</option>
                      </select>
                    ) : <Pill tone={k.verdict === "met" ? "ok" : k.verdict === "not_met" ? "crit" : "faint"}>{k.verdict === "met" ? "Met" : k.verdict === "not_met" ? "Not met" : "No verdict"}</Pill>}
                  </li>))}</ul>)}
            </div>
            {r.status === "advisory" && mayJudge && (
              <div className="hq-decide">
                <Field label="Decision note" hint="Required to reject."><input type="text" value={note} onChange={e => setNote(e.target.value)} /></Field>
                <div className="row">
                  <Button variant="primary" disabled={busy || r.current === false} onClick={() => wrap(() => G.decideReview(r.id, "approve", note), "Review approved")}>Approve</Button>
                  <Button variant="ghost" disabled={busy} onClick={() => wrap(() => G.decideReview(r.id, "reject", note), "Review rejected")}>Reject</Button>
                </div>
              </div>
            )}
            {r.status === "advisory" && !mayJudge && <p className="muted" style={{ fontSize: 12.5 }}>{c.ownerId === me?.id ? "You own this component, so someone else has to review it." : "Only the assigned reviewer or an admin can give verdicts and decide."}</p>}
            {r.status !== "advisory" && r.decision_note && <p className="muted">Reviewer's note: {r.decision_note}</p>}
          </>
        )}
        {msg && <ErrorNote msg={[msg.message, ...msg.list.filter(x => x !== msg.message)].join(" · ")} />}
        {rv.data && rv.data.length > 1 && <p className="muted" style={{ fontSize: 12.5 }}>{rv.data.length - 1} earlier review{rv.data.length > 2 ? "s" : ""} on record.</p>}
      </div>
    </Section>
  );
}
