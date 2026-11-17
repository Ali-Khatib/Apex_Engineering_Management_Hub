import React, { useEffect, useMemo, useState } from "react";
import { useStore, useToast, useNav } from "../store";
import { Icon } from "../icons";
import { Button, PageHeader, Section, Pill, Modal, Field, Empty, Tabs, KV, Menu, MenuItem, cx } from "../ui";
import { fmtDate } from "../logic";
import * as G from "../governance";
import * as H from "../hr";
import { useLoad, ErrorNote } from "./hq";

const dateText = (s: string | null | undefined) => (s ? fmtDate(s.slice(0, 10)) : "Not set");
const stamp = (s: string | null | undefined) => (s ? new Date(s).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—");
const STAGE_TONE: Record<string, string> = { awaiting_approval: "review", ready: "info", in_progress: "info", final_review: "review", completed: "ok", cancelled: "faint" };
const TASK_LABEL: Record<string, string> = { not_started: "Not started", in_progress: "In progress", completed: "Done", blocked: "Blocked", not_applicable: "Does not apply" };
const TASK_TONE: Record<string, string> = { not_started: "faint", in_progress: "info", completed: "ok", blocked: "crit", not_applicable: "faint" };
const CONFIRM_LABEL: Record<string, string> = { not_applicable: "", pending: "Waiting for confirmation", manually_confirmed: "Confirmed by hand", confirmed: "Confirmed by the system", failed: "Failed", not_configured: "Not connected. Confirm by hand." };
const SYSTEM_LABEL: Record<string, string> = { erp: "ERP", vpn: "VPN", slack: "Slack", calendar: "Calendar", contract: "Contract system" };
const HANDOVER_LABEL: Record<string, string> = { pending: "Needs a replacement", reassigned: "Replacement chosen", accepted: "Accepted", exception: "Left as it is, on record" };
const ROLE_LABEL: Record<string, string> = { owner: "Owner", reviewer: "Reviewer", qa: "QA contact", blocker: "Blocker" };

/** Everything here is stored and checked by the backend. Without one there is nothing real to show. */
function NeedsBackend({ title }: { title: string }) {
  return (<>
    <PageHeader title={title} />
    <Empty icon="team" title="People needs the backend">
      Onboarding, offboarding and candidate assessments keep their records, approvals and history on the server. This copy of Apex HQ is running without one, so there is nothing to show and nothing is made up.
    </Empty>
  </>);
}

function useAdminPeople() {
  const { apiMode } = useStore();
  const users = useLoad(() => (apiMode ? G.hqUsers(false) : Promise.resolve([])), [apiMode]);
  return users.data ?? [];
}
const nm = (u: { first_name: string; last_name: string }) => `${u.first_name} ${u.last_name}`;

function PersonPick({ id, value, onChange, people, label, empty }: { id: string; value: number | null; onChange: (v: number | null) => void; people: G.HqUser[]; label: string; empty?: string }) {
  return <select id={id} aria-label={label} value={value ?? ""} onChange={e => onChange(e.target.value ? Number(e.target.value) : null)}>
    <option value="">{empty ?? "Choose a person"}</option>{people.map(p => <option key={p.id} value={p.id}>{nm(p)}{p.designation ? ` · ${p.designation}` : ""}</option>)}
  </select>;
}

/* ═════════════════════ Overview ═════════════════════ */

export function PeopleOverview() {
  const { apiMode } = useStore();
  const { go } = useNav();
  const [start, setStart] = useState<H.Kind | null>(null);
  const [invite, setInvite] = useState(false);
  const ov = useLoad(() => (apiMode ? H.overview() : Promise.resolve(null)), [apiMode]);
  if (!apiMode) return <NeedsBackend title="People overview" />;
  const d = ov.data;
  const kpi = (label: string, value: number, to: string, tone?: string) => (
    <button className={cx("kpi", tone && value > 0 && `kpi-${tone}`)} onClick={() => go(to)}><span className="kpi-label">{label}</span><span className="kpi-value">{value}</span><span className="kpi-foot">View</span></button>
  );
  return (
    <>
      <PageHeader title="People overview" sub={d?.scope === "yours" ? "The onboarding and offboarding cases you own, manage or have tasks in." : "Every onboarding and offboarding case, and what needs a person to act."}
        actions={d?.can.start && <><Button variant="secondary" icon="plus" onClick={() => setInvite(true)}>Invite a candidate</Button><Button variant="secondary" icon="plus" onClick={() => setStart("offboarding")}>Start offboarding</Button><Button variant="primary" icon="plus" onClick={() => setStart("onboarding")}>Start onboarding</Button></>} />
      {ov.error && <ErrorNote msg={ov.error} onRetry={ov.reload} />}
      {d && <>
        <div className="kpis pp-kpis">
          {kpi("Onboarding in progress", d.counts.onboarding, "onboarding")}
          {kpi("Offboarding in progress", d.counts.offboarding, "offboarding")}
          {kpi("Waiting for an admin", d.counts.awaiting_approval, "onboarding", "warn")}
          {kpi("Overdue tasks", d.counts.overdue_tasks, "onboarding", "alert")}
          {kpi("Blocked tasks", d.counts.blocked_tasks, "onboarding", "alert")}
          {d.can.review_candidates && kpi("Candidates to review", d.counts.candidates_awaiting_review, "candidates", "warn")}
        </div>
        <Section title="Needs attention" sub={d.attention_total > d.attention.length ? `Showing the first ${d.attention.length} of ${d.attention_total}.` : "Ordered by what is most urgent."}>
          {d.attention.length === 0 ? <Empty icon="check" title="Nothing needs attention">No approvals are waiting, nothing is blocked and nothing is overdue.</Empty> :
            <div className="table-wrap"><table className="tbl hq-tbl">
              <thead><tr><th>What</th><th>Person</th><th>Owner</th><th>Due</th><th>Why</th><th></th></tr></thead>
              <tbody>{d.attention.map((a, i) => (
                <tr key={i} className="clickable" onClick={() => go(a.route)}>
                  <td className="hq-first"><b style={{ fontWeight: 600 }}>{a.what}</b></td>
                  <td data-label="Person">{a.person}</td>
                  <td data-label="Owner">{a.owner?.name ?? <span className="muted">Nobody yet</span>}</td>
                  <td data-label="Due">{a.due ? dateText(a.due) : <span className="muted">No date</span>}</td>
                  <td data-label="Why" className="pp-why">{a.reason}</td>
                  <td><a className="btn btn-ghost btn-sm" href={"#" + a.route} onClick={e => e.stopPropagation()}>Open</a></td>
                </tr>))}</tbody>
            </table></div>}
        </Section>
        <p className="muted pp-foot">Counts include only what you are allowed to see. Nothing here is estimated. No external system (ERP, VPN, Slack, Calendar) is connected, so steps that depend on one are confirmed by a person and say so.</p>
      </>}
      {start && <StartCase kind={start} onClose={() => setStart(null)} onDone={id => { setStart(null); go((start === "onboarding" ? "onb-" : "off-") + id); }} />}
      {invite && <InviteCandidate onClose={() => setInvite(false)} onDone={() => { setInvite(false); go("candidates"); }} />}
    </>
  );
}

/* ═════════════════════ Case list ═════════════════════ */

export function CaseListPage({ kind }: { kind: H.Kind }) {
  const { apiMode, isAdmin } = useStore();
  const { go } = useNav();
  const [f, setF] = useState({ stage: "active", q: "", overdue: false, blocked: false, sort: "newest", page: 1 });
  const [start, setStart] = useState(false);
  const [tpl, setTpl] = useState(false);
  const list = useLoad(() => (apiMode ? H.cases({ kind, ...f, per: 15 }) : Promise.resolve(null)), [apiMode, kind, f.stage, f.q, f.overdue, f.blocked, f.sort, f.page]);
  useEffect(() => setF(x => ({ ...x, page: 1 })), [kind]);
  const title = kind === "onboarding" ? "Onboarding" : "Offboarding";
  if (!apiMode) return <NeedsBackend title={title} />;
  const d = list.data; const pages = d ? Math.max(1, Math.ceil(d.total / d.per)) : 1;
  const set = (p: Partial<typeof f>) => setF(x => ({ ...x, page: 1, ...p }));
  return (
    <>
      <PageHeader title={title} sub={kind === "onboarding" ? "Getting a new person ready to work: approval, accounts, equipment and a first plan." : "Handing over a person's work and closing their access safely."}
        actions={isAdmin && <><Button variant="ghost" icon="edit" onClick={() => setTpl(true)}>Edit checklist</Button><Button variant="primary" icon="plus" onClick={() => setStart(true)}>Start {kind}</Button></>} />
      <div className="toolbar">
        <div className="input-ic grow"><Icon name="search" size={15} /><input type="search" placeholder="Search by person, role or department" value={f.q} onChange={e => set({ q: e.target.value })} aria-label="Search cases" /></div>
        <select value={f.stage} onChange={e => set({ stage: e.target.value })} aria-label="Stage">
          <option value="active">Open cases</option><option value="all">All cases</option><option value="awaiting_approval">Awaiting approval</option><option value="ready">Ready to start</option><option value="in_progress">In progress</option><option value="final_review">In final review</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option>
        </select>
        <select value={f.sort} onChange={e => set({ sort: e.target.value })} aria-label="Sort by"><option value="newest">Newest first</option><option value="date">{kind === "onboarding" ? "Start date" : "Last working day"}</option><option value="name">Name</option><option value="progress">Least progress</option></select>
        <label className="hq-check-inline"><input type="checkbox" checked={f.overdue} onChange={e => set({ overdue: e.target.checked })} /> Has overdue tasks</label>
        <label className="hq-check-inline"><input type="checkbox" checked={f.blocked} onChange={e => set({ blocked: e.target.checked })} /> Has blocked tasks</label>
      </div>
      {list.error && <ErrorNote msg={list.error} onRetry={list.reload} />}
      <section className="panel" style={{ overflow: "hidden" }} aria-busy={list.loading}>
        {!list.loading && d && d.items.length === 0 ? <Empty icon="team" title={f.q || f.overdue || f.blocked || f.stage !== "active" ? "No cases match" : `No ${kind} cases yet`}>
          {isAdmin ? (f.q || f.overdue || f.blocked || f.stage !== "active" ? "Try clearing a filter." : `Start one when someone ${kind === "onboarding" ? "is joining" : "is leaving"}.`) : "You are not an owner, manager or task owner on any case."}
        </Empty> :
          <div className="table-wrap"><table className="tbl hq-tbl">
            <thead><tr><th>Person</th><th>Stage</th><th>{kind === "onboarding" ? "Starts" : "Last day"}</th><th>Owner</th><th>Progress</th><th>Next step</th></tr></thead>
            <tbody>{(d?.items ?? []).map(c => (
              <tr key={c.id} className="clickable" onClick={() => go((kind === "onboarding" ? "onb-" : "off-") + c.id)}>
                <td className="hq-first"><a className="hq-link" href={"#" + (kind === "onboarding" ? "onb-" : "off-") + c.id} onClick={e => e.stopPropagation()}><b style={{ fontWeight: 600 }}>{c.person.name}</b></a><small className="muted" style={{ display: "block" }}>{[c.role_title, c.department].filter(Boolean).join(" · ") || "No role recorded"}</small></td>
                <td data-label="Stage"><Pill tone={STAGE_TONE[c.stage]} dot>{c.stage_label}</Pill></td>
                <td data-label={kind === "onboarding" ? "Starts" : "Last day"}>{dateText(c.anchor_date)}</td>
                <td data-label="Owner">{c.owner?.name ?? <span className="muted">Nobody yet</span>}</td>
                <td data-label="Progress">{c.progress ? <span className="pp-prog"><i style={{ width: c.progress.percent + "%" }} /><span>{c.progress.required_done} of {c.progress.required_total} required</span></span> : <span className="muted">Not shown</span>}</td>
                <td data-label="Next step" className="pp-why">{c.next_action ? <>{c.next_action.title}{c.next_action.blocked && <Pill tone="crit"> Blocked</Pill>}{c.overdue > 0 && <Pill tone="warn"> {c.overdue} overdue</Pill>}</> : c.stage === "awaiting_approval" ? "Waiting for approval" : <span className="muted">—</span>}
                  {kind === "offboarding" && c.pending_handover > 0 && <small className="muted" style={{ display: "block" }}>{c.pending_handover} handover item{c.pending_handover === 1 ? "" : "s"} open</small>}</td>
              </tr>))}</tbody>
          </table></div>}
        {d && d.total > d.per && <div className="tbl-foot"><span>{d.total} cases · page {f.page} of {pages}</span><span className="row"><Button size="sm" variant="ghost" disabled={f.page <= 1} onClick={() => setF(x => ({ ...x, page: x.page - 1 }))}>Previous</Button><Button size="sm" variant="ghost" disabled={f.page >= pages} onClick={() => setF(x => ({ ...x, page: x.page + 1 }))}>Next</Button></span></div>}
      </section>
      {start && <StartCase kind={kind} onClose={() => setStart(false)} onDone={id => { setStart(false); go((kind === "onboarding" ? "onb-" : "off-") + id); }} />}
      {tpl && <TemplateEditor kind={kind} onClose={() => setTpl(false)} />}
    </>
  );
}

/* ═════════════════════ Start a case ═════════════════════ */

function StartCase({ kind, onClose, onDone }: { kind: H.Kind; onClose: () => void; onDone: (id: number) => void }) {
  const { me } = useStore();
  const { toast } = useToast();
  const people = useAdminPeople();
  const cands = useLoad(() => (kind === "onboarding" ? H.candidates() : Promise.resolve(null)), [kind]);
  const approved = (cands.data?.items ?? []).filter(c => c.stage === "approved" && !c.onboarding_case_id);
  const [src, setSrc] = useState<"user" | "candidate" | "new">(kind === "onboarding" ? "new" : "user");
  const [f, setF] = useState({ person: null as number | null, candidate: null as number | null, name: "", email: "", owner: me ? Number(me.id) : null as number | null, manager: null as number | null, date: "", role: "", dept: "", reason: "", notes: "" });
  const [err, setErr] = useState<Record<string, string>>({}); const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setErr({}); setMsg("");
    const body: Record<string, unknown> = { kind, owner_id: f.owner, manager_id: f.manager, anchor_date: f.date || null, role_title: f.role, department: f.dept };
    if (kind === "offboarding") { body.person_user_id = f.person; body.reason_category = f.reason; body.restricted_notes = f.notes; }
    else if (src === "user") body.person_user_id = f.person; else if (src === "candidate") body.candidate_id = f.candidate; else body.new_person = { name: f.name, email: f.email, role_title: f.role };
    try { const c = await H.startCase(body); toast(`${c.person.name}: ${kind} case started`); onDone(c.id); }
    catch (e) { const p = G.apiProblems(e); setErr(p.fields); setMsg(Object.keys(p.fields).length ? "Please correct the highlighted fields." : p.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={kind === "onboarding" ? "Start onboarding" : "Start offboarding"} sub={kind === "onboarding" ? "The checklist is copied from the current template." : "Engineering work this person holds is listed for handover automatically."} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={busy}>{busy ? "Starting…" : `Start ${kind}`}</Button></>}>
      {msg && <div className="hq-note hq-note-crit" role="alert"><Icon name="alert" size={15} /><span>{msg}</span></div>}
      <div className="form-grid">
        {kind === "onboarding" && <Field label="Who is joining" full><select value={src} onChange={e => setSrc(e.target.value as any)}><option value="new">Someone new (no assessment)</option><option value="candidate">An approved candidate</option><option value="user">An existing HQ user</option></select></Field>}
        {(kind === "offboarding" || src === "user") && <Field label={kind === "offboarding" ? "Person leaving" : "Person"} error={err.person_user_id} full><PersonPick id="pp-person" label="Person" value={f.person} onChange={v => setF({ ...f, person: v })} people={people} /></Field>}
        {kind === "onboarding" && src === "candidate" && <Field label="Approved candidate" error={err.candidate_id} full hint={approved.length === 0 ? "No approved candidate is waiting to be onboarded." : undefined}><select value={f.candidate ?? ""} onChange={e => setF({ ...f, candidate: e.target.value ? Number(e.target.value) : null })}><option value="">Choose a candidate</option>{approved.map(c => <option key={c.id} value={c.id}>{c.name} · {c.email}</option>)}</select></Field>}
        {kind === "onboarding" && src === "new" && <><Field label="Full name" error={err.new_person}><input type="text" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field><Field label="Email"><input type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></Field></>}
        <Field label={kind === "onboarding" ? "Start date" : "Last working day"} error={err.anchor_date}><input type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Case owner" error={err.owner_id} hint="Does the day-to-day work and answers for the case."><PersonPick id="pp-owner" label="Case owner" value={f.owner} onChange={v => setF({ ...f, owner: v })} people={people} /></Field>
        <Field label="Manager" error={err.manager_id} hint="Can see this case. Optional."><PersonPick id="pp-mgr" label="Manager" value={f.manager} onChange={v => setF({ ...f, manager: v })} people={people} empty="No manager" /></Field>
        <Field label="Role"><input type="text" value={f.role} onChange={e => setF({ ...f, role: e.target.value })} /></Field>
        <Field label="Department"><input type="text" value={f.dept} onChange={e => setF({ ...f, dept: e.target.value })} /></Field>
        {kind === "offboarding" && <><Field label="Reason (admins only)" hint="Not shown to the case owner or anyone else."><input type="text" value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} placeholder="e.g. Resignation" /></Field>
          <Field label="Private notes (admins only)" full><textarea rows={2} value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></Field></>}
      </div>
    </Modal>
  );
}

/* ═════════════════════ Case detail ═════════════════════ */

export function CasePage({ id, kind }: { id: number; kind: H.Kind }) {
  const { apiMode, isAdmin } = useStore();
  const { go } = useNav();
  const { toast } = useToast();
  const [tab, setTab] = useState("tasks");
  const c = useLoad(() => (apiMode ? H.getCase(id) : Promise.resolve(null)), [apiMode, id]);
  const [dialog, setDialog] = useState<{ kind: "action"; a: H.CaseAction } | { kind: "task"; t: H.Task; mode: string } | { kind: "item"; i: H.HandoverItem; mode: string } | { kind: "addtask" } | null>(null);
  if (!apiMode) return <NeedsBackend title="Case" />;
  if (c.error && !c.data) return <><PageHeader title="Case not found" /><Empty icon="team" title="You can't open this case">It may not exist, or it may belong to someone else's responsibility. <a href={"#" + kind}>Back to {kind}</a>.</Empty></>;
  const d = c.data; if (!d) return <PageHeader title="Loading…" />;
  if (d.kind !== kind) return <Empty icon="team" title="Wrong list"><a href={"#" + (d.kind === "onboarding" ? "onb-" : "off-") + d.id}>Open this case</a></Empty>;
  const apply = (nd: H.CaseDetail, msg: string) => { c.setData(nd); toast(msg); };
  const tasks = d.tasks; const open = d.stage === "ready" || d.stage === "in_progress";
  const groups = tasks.reduce<Record<string, H.Task[]>>((a, t) => { (a[t.category] ||= []).push(t); return a; }, {});
  return (
    <>
      <PageHeader eyebrow={<><a href={"#people"}>People</a> / <a href={"#" + kind}>{kind === "onboarding" ? "Onboarding" : "Offboarding"}</a></>} title={d.person.name}
        sub={[d.role_title, d.department].filter(Boolean).join(" · ") || undefined}
        actions={d.actions && <>{d.actions.map(a => <span key={a.action} title={a.enabled ? undefined : a.why.join(" ")}><Button variant={a.action === "approve" || a.action === "complete" ? "primary" : "secondary"} disabled={!a.enabled && !a.why.length} onClick={() => setDialog({ kind: "action", a })} aria-disabled={!a.enabled}>{a.label}</Button></span>)}</>}>
        <div className="row pp-meta"><Pill tone={STAGE_TONE[d.stage]} dot>{d.stage_label}</Pill>{d.overdue > 0 && <Pill tone="warn">{d.overdue} overdue</Pill>}{d.blocked > 0 && <Pill tone="crit">{d.blocked} blocked</Pill>}</div>
      </PageHeader>
      {c.error && <ErrorNote msg={c.error} onRetry={c.reload} />}
      <div className={cx("hq-note", d.blockers_to_complete?.length ? "hq-note-warn" : "")} role="status"><Icon name="info" size={15} /><span><b>Where this stands.</b> {d.status_text}</span></div>
      {d.actions?.some(a => !a.enabled && a.why.length) && d.stage !== "completed" && d.stage !== "cancelled" && d.blockers_to_complete && d.blockers_to_complete.length > 0 && (
        <div className="hq-note hq-note-warn" role="status"><Icon name="alert" size={15} /><span><b>Before this can be completed:</b> {d.blockers_to_complete.slice(0, 4).join(" ")}{d.blockers_to_complete.length > 4 && ` And ${d.blockers_to_complete.length - 4} more.`}</span></div>)}
      <div className="pp-grid">
        <div style={{ minWidth: 0 }}>
          <Tabs value={tab} onChange={setTab} tabs={[{ id: "tasks", label: "Checklist", count: tasks.length }, ...(d.handover ? [{ id: "handover", label: "Engineering handover", count: d.handover.items.length }] : []), ...(d.events ? [{ id: "history", label: "History", count: d.events.length }] : [])]} />
          {tab === "tasks" && <div className="pp-tasks">
            {d.limited && <div className="hq-note" role="status"><Icon name="info" size={15} /><span>{d.status_text}</span></div>}
            {Object.entries(groups).map(([cat, ts]) => <Section key={cat} title={cat} className="pp-cat">
              <ul className="pp-list">{ts.map(t => <TaskRow key={t.id} t={t} stage={d.stage} onOpen={mode => setDialog({ kind: "task", t, mode })} />)}</ul>
            </Section>)}
            {d.can_edit && open && <Button variant="ghost" icon="plus" onClick={() => setDialog({ kind: "addtask" })}>Add a task</Button>}
            {tasks.length === 0 && <Empty icon="check" title="No tasks to show" />}
          </div>}
          {tab === "handover" && d.handover && <HandoverPanel d={d} onDone={apply} onOpen={(i, mode) => setDialog({ kind: "item", i, mode })} />}
          {tab === "history" && d.events && <Section title="History" sub="Who did what, newest first. Restricted details are hidden unless you are an admin."><ul className="pp-hist">
            {d.events.length === 0 && <li className="muted">Nothing yet.</li>}
            {d.events.map(e => <li key={e.id}><time>{stamp(e.created_at)}</time><span><b>{e.actor}</b> {e.action.replace(/^[a-z]+\./, "").replace(/_/g, " ")}{e.to_stage && e.from_stage !== e.to_stage ? ` → ${H_STAGE(e.to_stage)}` : ""}{e.restricted ? <i className="muted"> (details restricted)</i> : e.detail ? <>: <span className="muted">{e.detail}</span></> : null}</span></li>)}
          </ul></Section>}
        </div>
        <aside className="pp-side">
          <Section title="Case">
            <dl className="kv-list pp-kv">
              <KV k="Case owner">{d.owner?.name ?? "Nobody yet"}</KV>
              {d.manager && <KV k="Manager">{d.manager.name}</KV>}
              <KV k={kind === "onboarding" ? "Start date" : "Last working day"}>{dateText(d.anchor_date)}</KV>
              {d.progress && <KV k="Required tasks">{d.progress.required_done} of {d.progress.required_total} done</KV>}
              {d.approval && <KV k="Approval">{d.approval.approved ? `Approved by ${d.approval.by ?? "an admin"}, ${stamp(d.approval.at)}` : "Not approved yet"}</KV>}
              {d.person_account && <KV k="Login access">{d.person_account.active ? "Account is active" : "Account is deactivated"}</KV>}
              {d.candidate && <KV k="Candidate"><a href={"#" + d.candidate.route}>{d.candidate.name} ({d.candidate.stage_label})</a></KV>}
            </dl>
            {d.person.user_id && <p className="muted pp-foot">Finishing a case does not change login access. Change that on the <a href="#team">Directory</a>.</p>}
          </Section>
          {isAdmin && d.restricted && (d.restricted.reason_category || d.restricted.notes || d.restricted.closed_reason) && <Section title="Restricted" sub="Admins only">
            <dl className="kv-list pp-kv">{d.restricted.reason_category && <KV k="Reason">{d.restricted.reason_category}</KV>}{d.restricted.notes && <KV k="Notes">{d.restricted.notes}</KV>}{d.restricted.closed_reason && <KV k="Closed because">{d.restricted.closed_reason}</KV>}</dl>
          </Section>}
        </aside>
      </div>
      {dialog?.kind === "action" && <ActionDialog a={dialog.a} d={d} onClose={() => setDialog(null)} onDone={nd => { setDialog(null); apply(nd, `${dialog.a.label}: done`); }} />}
      {dialog?.kind === "task" && <TaskDialog t={dialog.t} mode={dialog.mode} d={d} onClose={() => setDialog(null)} onDone={nd => { setDialog(null); apply(nd, "Task updated"); }} />}
      {dialog?.kind === "item" && <ItemDialog i={dialog.i} mode={dialog.mode} d={d} onClose={() => setDialog(null)} onDone={nd => { setDialog(null); if ("tasks" in nd) apply(nd as H.CaseDetail, "Handover updated"); else { toast("Accepted"); go(kind === "offboarding" ? "offboarding" : "onboarding"); } }} />}
      {dialog?.kind === "addtask" && <AddTaskDialog d={d} onClose={() => setDialog(null)} onDone={nd => { setDialog(null); apply(nd, "Task added"); }} />}
    </>
  );
}
const H_STAGE = (s: string) => ({ awaiting_approval: "awaiting approval", ready: "ready", in_progress: "in progress", final_review: "final review", completed: "completed", cancelled: "cancelled" } as Record<string, string>)[s] ?? s;

function TaskRow({ t, stage, onOpen }: { t: H.Task; stage: string; onOpen: (mode: string) => void }) {
  const can = t.editable;
  return (
    <li className={cx("pp-task", t.status === "completed" && "done", t.status === "blocked" && "blocked")}>
      <div className="pp-task-main">
        <div className="pp-task-title"><b>{t.title}</b>{!t.required && <Pill tone="faint">Optional</Pill>}{t.mine && <Pill tone="brand">Yours</Pill>}</div>
        {t.instructions && <p className="muted">{t.instructions}</p>}
        <div className="pp-task-meta">
          <Pill tone={TASK_TONE[t.status]} dot>{TASK_LABEL[t.status]}</Pill>
          <span>{t.owner ? `Owner: ${t.owner.name}` : "No owner"}</span>
          <span className={cx(t.overdue && "pp-over")}>{t.due_date ? `Due ${dateText(t.due_date)}${t.overdue ? " (overdue)" : ""}` : "No due date"}</span>
          {t.integration !== "none" && <span title="This step depends on a system HQ is not connected to."><Pill tone={t.confirmation === "manually_confirmed" ? "ok" : "warn"}>{SYSTEM_LABEL[t.integration]}: {CONFIRM_LABEL[t.confirmation] || t.confirmation}</Pill></span>}
        </div>
        {t.status === "blocked" && t.blocked_reason && <p className="pp-reason"><b>Blocked:</b> {t.blocked_reason}</p>}
        {t.status === "not_applicable" && t.skip_reason && <p className="pp-reason"><b>Does not apply:</b> {t.skip_reason}</p>}
        {t.evidence_note && <p className="pp-reason"><b>Confirmation note:</b> {t.evidence_note}</p>}
        {t.status === "completed" && t.completed_by && <p className="muted pp-small">Done by {t.completed_by}, {stamp(t.completed_at)}</p>}
        {t.system_key === "handover" && <p className="muted pp-small">Completes itself when every handover item is resolved.</p>}
      </div>
      {can && t.system_key !== "handover" && <div className="pp-task-act">
        {t.status === "not_started" && <Button size="sm" variant="secondary" onClick={() => onOpen("in_progress")}>Start</Button>}
        {(t.status === "not_started" || t.status === "in_progress") && <Button size="sm" variant="primary" onClick={() => onOpen("completed")}>{t.integration !== "none" ? "Confirm done" : "Mark done"}</Button>}
        <Menu trigger={(o, tg) => <button className="bar-icon" onClick={tg} aria-expanded={o} aria-label={`More actions for ${t.title}`}><Icon name="more" size={16} /></button>}>
          {close => <>
            {t.status !== "blocked" && t.status !== "completed" && t.status !== "not_applicable" && <MenuItem onClick={() => { close(); onOpen("blocked"); }}>Mark as blocked</MenuItem>}
            {t.status === "blocked" && <MenuItem onClick={() => { close(); onOpen("in_progress"); }}>Unblock</MenuItem>}
            {t.status === "completed" && t.can_manage && <MenuItem onClick={() => { close(); onOpen("in_progress"); }}>Reopen</MenuItem>}
            {t.status !== "completed" && t.status !== "not_applicable" && <MenuItem onClick={() => { close(); onOpen("not_applicable"); }}>Does not apply</MenuItem>}
            {t.status === "not_applicable" && <MenuItem onClick={() => { close(); onOpen("not_started"); }}>Bring back</MenuItem>}
            {t.can_manage && <MenuItem onClick={() => { close(); onOpen("edit"); }}>Change owner or due date</MenuItem>}
          </>}
        </Menu>
      </div>}
    </li>
  );
}

function Dlg({ title, sub, busy, msg, onClose, onSave, saveLabel, children, danger }: { title: string; sub?: string; busy: boolean; msg: string; onClose: () => void; onSave: () => void; saveLabel: string; children: React.ReactNode; danger?: boolean }) {
  return <Modal title={title} sub={sub} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant={danger ? "secondary" : "primary"} onClick={onSave} disabled={busy}>{busy ? "Saving…" : saveLabel}</Button></>}>
    {msg && <div className="hq-note hq-note-crit" role="alert"><Icon name="alert" size={15} /><span>{msg}</span></div>}{children}</Modal>;
}
function useSave<T>(fn: () => Promise<T>, done: (r: T) => void) {
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(""); const [fields, setFields] = useState<Record<string, string>>({});
  const run = async () => { setBusy(true); setMsg(""); setFields({}); try { done(await fn()); } catch (e) { const p = G.apiProblems(e); setFields(p.fields); setMsg(p.message); } finally { setBusy(false); } };
  return { busy, msg, fields, run };
}

function ActionDialog({ a, d, onClose, onDone }: { a: H.CaseAction; d: H.CaseDetail; onClose: () => void; onDone: (c: H.CaseDetail) => void }) {
  const [reason, setReason] = useState("");
  const s = useSave(() => H.caseAction(d.id, { action: a.action, version: d.version, reason }), onDone);
  return <Dlg title={a.label} sub={d.person.name} busy={s.busy} msg={s.msg || (!a.enabled ? a.why.join(" ") : "")} onClose={onClose} onSave={s.run} saveLabel={a.label} danger={a.action === "cancel" || a.action === "reject"}>
    {a.needs_reason && <Field label="Reason" hint="At least 5 characters. Kept in the case history."><textarea rows={3} value={reason} onChange={e => setReason(e.target.value)} /></Field>}
    {!a.needs_reason && <p>{a.action === "approve" ? "Approving lets the team start finishing tasks." : a.action === "complete" ? "This closes the case. You can reopen it later if something was missed." : "Continue?"}</p>}
    {a.action === "cancel" && <p className="muted">Cancelling keeps the history. It does not delete anything or change anyone's login.</p>}
  </Dlg>;
}

function TaskDialog({ t, mode, d, onClose, onDone }: { t: H.Task; mode: string; d: H.CaseDetail; onClose: () => void; onDone: (c: H.CaseDetail) => void }) {
  const people = useAdminPeople();
  const [note, setNote] = useState(t.evidence_note); const [reason, setReason] = useState(""); const [owner, setOwner] = useState<number | null>(t.owner?.id ?? null); const [due, setDue] = useState(t.due_date ?? "");
  const body = (): Record<string, unknown> => mode === "edit" ? { version: t.version, owner_id: owner, due_date: due || null }
    : { version: t.version, status: mode, ...(mode === "completed" && t.integration !== "none" ? { evidence_note: note } : {}), ...(mode === "blocked" ? { blocked_reason: reason } : {}), ...(mode === "not_applicable" ? { skip_reason: reason } : {}) };
  const s = useSave(() => H.patchTask(d.id, t.id, body()), onDone);
  const title = { in_progress: t.status === "blocked" ? "Unblock" : t.status === "completed" ? "Reopen task" : "Start task", completed: t.integration !== "none" ? "Confirm this step by hand" : "Mark as done", blocked: "Mark as blocked", not_applicable: "This does not apply", not_started: "Bring back", edit: "Change owner or due date" }[mode] ?? "Update";
  return <Dlg title={title} sub={t.title} busy={s.busy} msg={s.msg} onClose={onClose} onSave={s.run} saveLabel={title}>
    {mode === "completed" && t.integration !== "none" && <><div className="hq-note hq-note-warn"><Icon name="alert" size={15} /><span>HQ is not connected to {SYSTEM_LABEL[t.integration]}. Do the step there, then record who confirmed it and how. This will show as “Confirmed by hand”, never as confirmed by the system.</span></div>
      <Field label="Who confirmed it, and how" error={s.fields.evidence_note}><textarea rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Checked in the VPN admin console by Sara, 14 Nov" /></Field></>}
    {mode === "blocked" && <Field label="What is blocking this?"><textarea rows={3} value={reason} onChange={e => setReason(e.target.value)} /></Field>}
    {mode === "not_applicable" && <Field label="Why does it not apply?" hint={t.required ? "This task is required, so only an admin can skip it, with at least 10 characters." : undefined}><textarea rows={3} value={reason} onChange={e => setReason(e.target.value)} /></Field>}
    {mode === "edit" && <div className="form-grid"><Field label="Owner"><PersonPick id="pp-t-owner" label="Owner" value={owner} onChange={setOwner} people={people} empty="No owner" /></Field><Field label="Due date" error={s.fields.due_date}><input type="date" value={due} onChange={e => setDue(e.target.value)} /></Field></div>}
    {["in_progress", "not_started"].includes(mode) && <p>{mode === "not_started" ? "This task goes back to not started." : "This marks the task as in progress."}</p>}
  </Dlg>;
}

function AddTaskDialog({ d, onClose, onDone }: { d: H.CaseDetail; onClose: () => void; onDone: (c: H.CaseDetail) => void }) {
  const people = useAdminPeople();
  const [f, setF] = useState({ title: "", instructions: "", owner: d.owner?.id ?? null as number | null, due: "", required: false });
  const s = useSave(() => H.addTask(d.id, { title: f.title, instructions: f.instructions, owner_id: f.owner, due_date: f.due || null, required: f.required }), onDone);
  return <Dlg title="Add a task" sub="Only this case gets it. To change every future case, edit the checklist." busy={s.busy} msg={s.msg} onClose={onClose} onSave={s.run} saveLabel="Add task">
    <div className="form-grid"><Field label="Title" error={s.fields.title} full><input type="text" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></Field>
      <Field label="Details" full><textarea rows={2} value={f.instructions} onChange={e => setF({ ...f, instructions: e.target.value })} /></Field>
      <Field label="Owner"><PersonPick id="pp-n-owner" label="Owner" value={f.owner} onChange={v => setF({ ...f, owner: v })} people={people} empty="Case owner" /></Field>
      <Field label="Due date"><input type="date" value={f.due} onChange={e => setF({ ...f, due: e.target.value })} /></Field>
      <label className="hq-check-inline"><input type="checkbox" checked={f.required} onChange={e => setF({ ...f, required: e.target.checked })} /> Required to complete the case</label></div>
  </Dlg>;
}

/* ═════════════════════ Engineering handover ═════════════════════ */

function HandoverPanel({ d, onDone, onOpen }: { d: H.CaseDetail; onDone: (c: H.CaseDetail, m: string) => void; onOpen: (i: H.HandoverItem, mode: string) => void }) {
  const { isAdmin } = useStore();
  const h = d.handover!; const live = d.stage === "in_progress" || d.stage === "final_review";
  const s = useSave(() => H.syncHandover(d.id), r => onDone(r.case, r.added || r.reopened ? `${r.added} new, ${r.reopened} reopened` : "Already up to date"));
  return (
    <Section title="Engineering handover" sub="Work this person still holds. Finished work keeps its history and is never changed. Nothing is reassigned for you."
      actions={d.can_reassign && live && <Button size="sm" variant="secondary" icon="refresh" onClick={s.run} disabled={s.busy}>Check again</Button>}>
      {s.msg && <div className="hq-note hq-note-crit" role="alert"><Icon name="alert" size={15} /><span>{s.msg}</span></div>}
      <div className="pp-hsum"><span><b>{h.pending}</b> need a replacement</span><span><b>{h.reassigned}</b> replacement chosen</span><span><b>{h.accepted}</b> accepted</span><span><b>{h.exceptions}</b> left as is</span></div>
      {h.items.length === 0 ? <Empty icon="check" title="Nothing to hand over">This person holds no unfinished components, reviews, QA or open blockers.</Empty> :
        <div className="table-wrap"><table className="tbl hq-tbl"><thead><tr><th>Component</th><th>Role</th><th>Status</th><th>Replacement</th><th></th></tr></thead>
          <tbody>{h.items.map(i => <tr key={i.id}>
            <td className="hq-first">{i.component && <a href={"#c-" + i.component.code} className="comp-link"><code className="cid">{i.component.code}</code><span>{i.component.name}</span></a>}{i.blocker && <small className="muted" style={{ display: "block" }}>Blocker: {i.blocker.title}</small>}</td>
            <td data-label="Role">{ROLE_LABEL[i.role]}</td>
            <td data-label="Status"><Pill tone={i.status === "pending" ? "warn" : i.status === "exception" ? "faint" : "ok"} dot>{HANDOVER_LABEL[i.status]}</Pill>{i.exception_reason && <small className="muted" style={{ display: "block" }}>{i.exception_reason}</small>}</td>
            <td data-label="Replacement">{i.to?.name ?? <span className="muted">—</span>}{i.status === "reassigned" && <small className="muted" style={{ display: "block" }}>Not accepted yet</small>}</td>
            <td><div className="pp-row-act">{live && i.status === "pending" && d.can_reassign && <Button size="sm" variant="secondary" onClick={() => onOpen(i, "reassign")}>Choose replacement</Button>}
              {live && i.status === "pending" && isAdmin && <Button size="sm" variant="ghost" onClick={() => onOpen(i, "exception")}>Leave as is</Button>}
              {live && i.status === "reassigned" && <Button size="sm" variant="ghost" onClick={() => onOpen(i, "accept")}>Mark accepted</Button>}
              {live && i.status === "reassigned" && d.can_reassign && <Button size="sm" variant="ghost" onClick={() => onOpen(i, "reassign")}>Change</Button>}</div></td>
          </tr>)}</tbody></table></div>}
      <p className="muted pp-foot">Choosing a replacement updates the component's owner, reviewer or QA contact using the same rules as the component page, and adds a neutral line to the component's history. It does not say why.</p>
    </Section>
  );
}

function ItemDialog({ i, mode, d, onClose, onDone }: { i: H.HandoverItem; mode: string; d: H.CaseDetail; onClose: () => void; onDone: (c: H.CaseDetail | { ok: true }) => void }) {
  const people = useAdminPeople().filter(p => p.is_active && p.id !== d.person.user_id);
  const [to, setTo] = useState<number | null>(i.to?.id ?? null); const [note, setNote] = useState(""); const [reason, setReason] = useState("");
  const s = useSave(() => mode === "reassign" ? H.reassign(d.id, i.id, to, note) : mode === "accept" ? H.acceptItem(d.id, i.id) : H.exceptItem(d.id, i.id, reason), onDone);
  const t = mode === "reassign" ? "Choose a replacement" : mode === "accept" ? "Mark as accepted" : "Leave as it is";
  return <Dlg title={t} sub={`${i.component?.code ?? ""} · ${ROLE_LABEL[i.role]}`} busy={s.busy} msg={s.msg} onClose={onClose} onSave={s.run} saveLabel={t}>
    {mode === "reassign" && <><Field label={`New ${ROLE_LABEL[i.role].toLowerCase()}`}><PersonPick id="pp-h-to" label="Replacement" value={to} onChange={setTo} people={people} /></Field>
      <Field label="Note for the case history (optional)" hint="Kept in the case, visible to people who can open it. Not added to the component history."><input type="text" value={note} onChange={e => setNote(e.target.value)} /></Field></>}
    {mode === "accept" && <p>Confirm that {i.to?.name ?? "the replacement"} has taken this over.</p>}
    {mode === "exception" && <><div className="hq-note hq-note-warn"><Icon name="alert" size={15} /><span>The work stays assigned to the person leaving. This is recorded as an exception with your name.</span></div><Field label="Why is it being left as it is?" hint="At least 10 characters."><textarea rows={3} value={reason} onChange={e => setReason(e.target.value)} /></Field></>}
  </Dlg>;
}

/* ═════════════════════ Checklist template ═════════════════════ */

function TemplateEditor({ kind, onClose }: { kind: H.Kind; onClose: () => void }) {
  const { toast } = useToast();
  const t = useLoad(() => H.templates(), []);
  const [rows, setRows] = useState<H.TemplateTask[] | null>(null);
  useEffect(() => { if (t.data) setRows(t.data[kind].tasks.map(x => ({ ...x }))); }, [t.data, kind]);
  const s = useSave(() => H.saveTemplate(kind, rows!, t.data![kind].version), r => { toast("Checklist saved. Cases already started keep their own copy."); onClose(); });
  const up = (i: number, p: Partial<H.TemplateTask>) => setRows(r => r!.map((x, k) => k === i ? { ...x, ...p } : x));
  const move = (i: number, dlt: number) => setRows(r => { const a = [...r!]; const j = i + dlt; if (j < 0 || j >= a.length) return a; [a[i], a[j]] = [a[j], a[i]]; return a; });
  return <Modal title={`${kind === "onboarding" ? "Onboarding" : "Offboarding"} checklist`} sub="New cases copy this list. Cases already started are not changed." onClose={onClose} wide
    footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={s.run} disabled={s.busy || !rows}>{s.busy ? "Saving…" : "Save checklist"}</Button></>}>
    {t.error && <ErrorNote msg={t.error} onRetry={t.reload} />}
    {s.msg && <div className="hq-note hq-note-crit" role="alert"><Icon name="alert" size={15} /><span>{s.msg}</span></div>}
    <p className="muted pp-foot">Step order, who owns each step and how many days from the date it falls due are set here. “Needs” marks a step that depends on a system HQ is not connected to, so a person confirms it by hand.</p>
    <ol className="pp-tpl">{(rows ?? []).map((r, i) => <li key={r.key}>
      <div className="pp-tpl-row">
        <input type="text" value={r.title} onChange={e => up(i, { title: e.target.value })} aria-label={`Title of step ${i + 1}`} />
        <select value={r.owner} onChange={e => up(i, { owner: e.target.value })} aria-label="Owner role" disabled={!!r.system}><option value="case_owner">Case owner</option><option value="manager">Manager</option><option value="admin">Admin</option><option value="person">The person</option></select>
        <label className="pp-days">Day <input type="number" value={r.offset_days} onChange={e => up(i, { offset_days: Number(e.target.value) })} aria-label="Days from the date" /></label>
        <select value={r.integration} onChange={e => up(i, { integration: e.target.value })} aria-label="Needs system" disabled={!!r.system}><option value="none">Needs: nothing</option>{Object.entries(SYSTEM_LABEL).map(([k, v]) => <option key={k} value={k}>Needs: {v}</option>)}</select>
        <label className="hq-check-inline"><input type="checkbox" checked={r.required} onChange={e => up(i, { required: e.target.checked })} disabled={!!r.system} /> Required</label>
        <span className="row"><button className="bar-icon" onClick={() => move(i, -1)} aria-label="Move up" disabled={i === 0}><Icon name="chevronUp" size={14} /></button><button className="bar-icon" onClick={() => move(i, 1)} aria-label="Move down" disabled={i === rows!.length - 1}><Icon name="chevronDown" size={14} /></button>
          {!r.system && <button className="bar-icon" onClick={() => setRows(x => x!.filter((_, k) => k !== i))} aria-label={`Remove ${r.title}`}><Icon name="trash" size={14} /></button>}</span>
      </div>
      {r.system && <small className="muted">This step is built in and completes itself from the handover list.</small>}
    </li>)}</ol>
    <Button variant="ghost" icon="plus" onClick={() => setRows(r => [...r!, { key: "step_" + Math.random().toString(36).slice(2, 7), title: "", instructions: "", category: "Additional", required: false, integration: "none", owner: "case_owner", offset_days: 0 }])}>Add a step</Button>
  </Modal>;
}

/* ═════════════════════ Candidates ═════════════════════ */

const CAND_TONE: Record<string, string> = { invited: "info", assessment_open: "info", submitted: "review", approved: "ok", rejected: "faint", cancelled: "faint", expired: "warn" };

export function CandidatesPage() {
  const { apiMode, isAdmin } = useStore();
  const { go } = useNav();
  const [q, setQ] = useState(""); const [st, setSt] = useState(""); const [inv, setInv] = useState(false);
  const list = useLoad(() => (apiMode && isAdmin ? H.candidates() : Promise.resolve(null)), [apiMode, isAdmin]);
  if (!apiMode) return <NeedsBackend title="Candidates" />;
  if (!isAdmin) return <><PageHeader title="Candidates" /><Empty icon="shield" title="Admins only">Candidate assessments and decisions are limited to admins.</Empty></>;
  const rows = (list.data?.items ?? []).filter(c => (!st || c.view === st) && (!q || `${c.name} ${c.email}`.toLowerCase().includes(q.toLowerCase())));
  return <>
    <PageHeader title="Candidates" sub="People invited to an assessment. Approving one lets you start their onboarding without entering them again." actions={<Button variant="primary" icon="plus" onClick={() => setInv(true)}>Invite a candidate</Button>} />
    <div className="toolbar"><div className="input-ic grow"><Icon name="search" size={15} /><input type="search" placeholder="Search by name or email" value={q} onChange={e => setQ(e.target.value)} aria-label="Search candidates" /></div>
      <select value={st} onChange={e => setSt(e.target.value)} aria-label="Stage"><option value="">All stages</option><option value="invited">Invited</option><option value="assessment_open">Assessment open</option><option value="expired">Window ended</option><option value="submitted">Submitted</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="cancelled">Cancelled</option></select></div>
    {list.error && <ErrorNote msg={list.error} onRetry={list.reload} />}
    <section className="panel" style={{ overflow: "hidden" }}>
      {!list.loading && rows.length === 0 ? <Empty icon="team" title={q || st ? "No candidates match" : "No candidates yet"}>{q || st ? "Try clearing a filter." : "Invite someone to give them an assessment link and a one-time code."}</Empty> :
        <div className="table-wrap"><table className="tbl hq-tbl"><thead><tr><th>Candidate</th><th>Stage</th><th>Assessment</th><th>Deadline</th><th>Submitted</th></tr></thead>
          <tbody>{rows.map(c => <tr key={c.id} className="clickable" onClick={() => go("cand-" + c.id)}>
            <td className="hq-first"><a className="hq-link" href={"#cand-" + c.id} onClick={e => e.stopPropagation()}><b style={{ fontWeight: 600 }}>{c.name}</b></a><small className="muted" style={{ display: "block" }}>{c.email}</small></td>
            <td data-label="Stage"><Pill tone={CAND_TONE[c.view]} dot>{c.stage_label}</Pill></td>
            <td data-label="Assessment">{c.assessment_title}</td>
            <td data-label="Deadline">{c.deadline_at ? stamp(c.deadline_at) : <span className="muted">Starts at first sign-in</span>}</td>
            <td data-label="Submitted">{c.received_at ? stamp(c.received_at) : <span className="muted">No</span>}</td></tr>)}</tbody></table></div>}
    </section>
    {inv && <InviteCandidate onClose={() => setInv(false)} onDone={() => { setInv(false); list.reload(); }} />}
  </>;
}

function AccessBox({ a }: { a: H.Access }) {
  const link = location.origin + location.pathname + a.invitation_path.replace(/^\//, "");
  const copy = (t: string) => { try { navigator.clipboard.writeText(t); } catch { /* ignore */ } };
  return <div className="hq-note hq-note-warn pp-access" role="status"><Icon name="key" size={15} /><span>
    <b>Share these with the candidate now. They are shown only once.</b><br />{a.delivery}
    <span className="pp-secret"><code>{link}</code><Button size="sm" variant="ghost" onClick={() => copy(link)}>Copy link</Button></span>
    <span className="pp-secret"><code>{a.code}</code><Button size="sm" variant="ghost" onClick={() => copy(a.code)}>Copy code</Button> <small className="muted">The code works once and expires in {a.code_valid_minutes} minutes.</small></span>
  </span></div>;
}

function InviteCandidate({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: "", email: "", role_title: "", assessment_title: "", assessment_brief: "", assessment_instructions: "", assessment_hours: 48 });
  const [access, setAccess] = useState<H.Access | null>(null);
  const s = useSave(() => H.invite(f), r => setAccess(r.access));
  if (access) return <Modal title="Candidate invited" onClose={onDone} footer={<Button variant="primary" onClick={onDone}>Done</Button>}><AccessBox a={access} /></Modal>;
  const set = (k: string) => (e: React.ChangeEvent<any>) => setF({ ...f, [k]: e.target.value });
  return <Dlg title="Invite a candidate" sub="They get a private link and a one-time code. The 48-hour window starts when they first sign in." busy={s.busy} msg={s.msg} onClose={onClose} onSave={s.run} saveLabel="Create invitation">
    <div className="form-grid">
      <Field label="Name" error={s.fields.name}><input type="text" value={f.name} onChange={set("name")} /></Field>
      <Field label="Email" error={s.fields.email}><input type="email" value={f.email} onChange={set("email")} /></Field>
      <Field label="Role"><input type="text" value={f.role_title} onChange={set("role_title")} /></Field>
      <Field label="Window (hours)" error={s.fields.assessment_hours}><input type="number" min={1} max={168} value={f.assessment_hours} onChange={e => setF({ ...f, assessment_hours: Number(e.target.value) })} /></Field>
      <Field label="Assessment title" error={s.fields.assessment_title} full><input type="text" value={f.assessment_title} onChange={set("assessment_title")} /></Field>
      <Field label="Brief" error={s.fields.assessment_brief} full><textarea rows={5} value={f.assessment_brief} onChange={set("assessment_brief")} /></Field>
      <Field label="Instructions (optional)" full><textarea rows={3} value={f.assessment_instructions} onChange={set("assessment_instructions")} /></Field>
    </div>
  </Dlg>;
}

export function CandidatePage({ id }: { id: number }) {
  const { apiMode, isAdmin } = useStore();
  const { toast } = useToast();
  const c = useLoad(() => (apiMode && isAdmin ? H.candidate(id) : Promise.resolve(null)), [apiMode, isAdmin, id]);
  const [act, setAct] = useState<{ action: string; label: string; needs_reason: boolean } | null>(null);
  const [access, setAccess] = useState<H.Access | null>(null);
  const [start, setStart] = useState(false);
  const { go } = useNav();
  if (!apiMode) return <NeedsBackend title="Candidate" />;
  if (!isAdmin) return <><PageHeader title="Candidate" /><Empty icon="shield" title="Admins only" /></>;
  if (c.error && !c.data) return <><PageHeader title="Candidate not found" /><Empty icon="team" title="No such candidate"><a href="#candidates">Back to candidates</a></Empty></>;
  const d = c.data; if (!d) return <PageHeader title="Loading…" />;
  return <>
    <PageHeader eyebrow={<><a href="#people">People</a> / <a href="#candidates">Candidates</a></>} title={d.name} sub={`${d.email}${d.role_title ? " · " + d.role_title : ""}`}
      actions={<>{d.actions.map(a => <Button key={a.action} variant={a.action === "approve" ? "primary" : "secondary"} onClick={() => setAct(a)} disabled={!a.enabled}>{a.label}</Button>)}
        {d.stage === "approved" && !d.onboarding_case_id && <Button variant="primary" icon="arrowRight" onClick={() => setStart(true)}>Start onboarding</Button>}
        {d.onboarding_case_id && <a className="btn btn-secondary btn-md" href={"#onb-" + d.onboarding_case_id}>Open onboarding case</a>}</>}>
      <div className="row pp-meta"><Pill tone={CAND_TONE[d.view]} dot>{d.stage_label}</Pill></div>
    </PageHeader>
    {access && <AccessBox a={access} />}
    <div className="pp-grid"><div style={{ minWidth: 0 }}>
      <Section title="Assessment" sub={d.assessment_title}><div className="panel-body"><p className="pp-pre">{d.assessment_brief}</p>{d.assessment_instructions && <><h3 className="pp-h3">Instructions</h3><p className="pp-pre">{d.assessment_instructions}</p></>}</div></Section>
      <Section title="Submission" sub={d.submission ? `Received ${stamp(d.submission.received_at)} by the server clock` : "Nothing submitted yet"}>
        {d.submission ? <dl className="kv-list pp-kv panel-body"><KV k="Receipt">{d.submission.receipt_id}</KV><KV k="Repository">{d.submission.repository_url ? <a href={d.submission.repository_url} target="_blank" rel="noopener noreferrer">{d.submission.repository_url}</a> : "None"}</KV><KV k="LinkedIn">{d.submission.linkedin_url ? <a href={d.submission.linkedin_url} target="_blank" rel="noopener noreferrer">{d.submission.linkedin_url}</a> : "None"}</KV><KV k="Notes"><span className="pp-pre">{d.submission.notes || "None"}</span></KV><KV k="Checksum"><code>{d.submission.checksum.slice(0, 16)}…</code></KV></dl> :
          <Empty icon="file" title="No submission">{d.view === "expired" ? "The window has ended without one. Extend the deadline or close the invitation." : "The candidate has not submitted."}</Empty>}
      </Section>
      <Section title="History"><ul className="pp-hist">{d.events.map(e => <li key={e.id}><time>{stamp(e.created_at)}</time><span><b>{e.actor}</b> {e.action.replace("candidate.", "").replace(/_/g, " ")}{e.detail ? <>: <span className="muted">{e.detail}</span></> : null}</span></li>)}</ul></Section>
    </div>
      <aside className="pp-side"><Section title="Timing"><dl className="kv-list pp-kv"><KV k="Window">{d.assessment_hours} hours</KV><KV k="First sign-in">{stamp(d.first_sign_in_at)}</KV><KV k="Deadline">{d.deadline_at ? stamp(d.deadline_at) : "Starts at first sign-in"}</KV>{d.decided_at && <KV k="Decided">{stamp(d.decided_at)} by {d.decided_by}</KV>}{d.decision_reason && <KV k="Reason">{d.decision_reason}</KV>}</dl></Section></aside></div>
    {act && <CandidateActionDialog a={act} d={d} onClose={() => setAct(null)} onDone={(r) => { setAct(null); c.setData(r.candidate); if (r.access) setAccess(r.access); toast(`${act.label}: done`); }} />}
    {start && <StartCase kind="onboarding" onClose={() => setStart(false)} onDone={id => { setStart(false); go("onb-" + id); }} />}
  </>;
}

function CandidateActionDialog({ a, d, onClose, onDone }: { a: { action: string; label: string; needs_reason: boolean }; d: H.CandidateDetail; onClose: () => void; onDone: (r: { candidate: H.CandidateDetail; access: H.Access | null }) => void }) {
  const [reason, setReason] = useState(""); const [hours, setHours] = useState(24);
  const s = useSave(() => H.candidateAction(d.id, { action: a.action, version: d.version, reason, ...(a.action === "extend" ? { hours } : {}) }), onDone);
  return <Dlg title={a.label} sub={d.name} busy={s.busy} msg={s.msg} onClose={onClose} onSave={s.run} saveLabel={a.label} danger={a.action === "reject" || a.action === "cancel"}>
    {a.action === "extend" && <Field label="Add hours" hint="Counted from the later of now and the current deadline."><input type="number" min={1} max={168} value={hours} onChange={e => setHours(Number(e.target.value))} /></Field>}
    {a.needs_reason && <Field label="Reason" hint="At least 5 characters. Only admins can read it."><textarea rows={3} value={reason} onChange={e => setReason(e.target.value)} /></Field>}
    {a.action === "reissue" && <p>This cancels the earlier link and code and creates a new pair. You will see them once.</p>}
  </Dlg>;
}
