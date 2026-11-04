import React, { useMemo, useState } from "react";
import { useStore, useNav, useToast } from "../store";
import { Icon } from "../icons";
import { Button, PageHeader, Section, Pill, PersonChip, Modal, Drawer, Field, PersonSelect, Tabs, Empty, cx, KV, CompLink, Avatar } from "../ui";
import { OPEN_BLOCKER, daysUntil, fmtDate, relDays, ago, personName, iso, today, addDays, fmtDateTime } from "../logic";
import type { Blocker, BlockerStatus, Handoff } from "../types";

export const BLOCKER_CATEGORIES = ["Technical dependency", "Missing access", "Infrastructure issue", "External API issue", "Unavailable credentials or configuration", "Pending decision", "Third-party dependency", "Failed CI/CD pipeline", "QA rejection", "Missing documentation", "Resource availability", "Client-side dependency"];
const STATUS: [BlockerStatus, string, string][] = [["open", "Open", "crit"], ["acknowledged", "Acknowledged", "warn"], ["in_progress", "In progress", "info"], ["waiting_external", "Waiting on external party", "review"], ["escalated", "Escalated", "crit-solid"], ["resolved", "Resolved", "ok"], ["closed", "Closed", "faint"]];
export const blockerStatus = (s: BlockerStatus) => { const x = STATUS.find(z => z[0] === s)!; return <Pill tone={x[2]} dot>{x[1]}</Pill>; };
const SEV_TONE = { critical: "crit-solid", high: "crit", medium: "warn", low: "neutral" } as const;

export function BlockerModal({ componentId, onClose }: { componentId?: string; onClose: () => void }) {
  const { state, addBlocker, me } = useStore();
  const { toast } = useToast();
  const [f, setF] = useState({ componentId: componentId || "", title: "", description: "", category: BLOCKER_CATEGORIES[0], severity: "high" as Blocker["severity"], responsibleId: null as string | null, nextAction: "", target: addDays(iso(today()), 3), slack: "" });
  const [err, setErr] = useState<Record<string, string>>({});
  const save = () => {
    const e: Record<string, string> = {};
    if (!f.componentId) e.componentId = "Choose the component this blocks.";
    if (!f.title.trim()) e.title = "Summarise the blocker in a few words.";
    if (!f.responsibleId) e.responsibleId = "Someone must own unblocking it.";
    if (!f.nextAction.trim()) e.nextAction = "Say what has to happen next.";
    if (f.target < iso(today())) e.target = "Target date can't be in the past.";
    if (/(password|secret|token|api[_ -]?key)\s*[:=]\s*\S{6,}/i.test(f.description)) e.description = "Looks like a credential. Never paste secrets here; reference the Vault path instead.";
    setErr(e); if (Object.keys(e).length) return;
    addBlocker({ ...f, title: f.title.trim(), description: f.description.trim(), nextAction: f.nextAction.trim(), slack: f.slack.trim() || undefined } as any);
    toast("Blocker raised. Responsible person and owner notified."); onClose();
  };
  return (
    <Modal title="Raise a blocker" sub="Recorded here instead of buried in chat, with a clear owner and next step." onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Raise blocker</Button></>}>
      <div className="form-grid">
        <Field label="Component" error={err.componentId} full><select value={f.componentId} onChange={e => setF({ ...f, componentId: e.target.value })} disabled={!!componentId}><option value="">Choose…</option>{state.components.map(c => <option key={c.id} value={c.id}>{c.id} · {c.name}</option>)}</select></Field>
        <Field label="What's blocked" error={err.title} full><input type="text" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="e.g. Staging database credentials not issued" /></Field>
        <Field label="Details" error={err.description} full hint="Never include credentials or secret values."><textarea rows={3} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="Category"><select value={f.category} onChange={e => setF({ ...f, category: e.target.value })}>{BLOCKER_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Severity"><select value={f.severity} onChange={e => setF({ ...f, severity: e.target.value as any })}>{["critical", "high", "medium", "low"].map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}</select></Field>
        <Field label="Responsible for unblocking" error={err.responsibleId}><PersonSelect value={f.responsibleId} onChange={v => setF({ ...f, responsibleId: v })} emptyLabel="Choose a person" /></Field>
        <Field label="Target resolution date" error={err.target}><input type="date" value={f.target} onChange={e => setF({ ...f, target: e.target.value })} /></Field>
        <Field label="Next action" error={err.nextAction} full><input type="text" value={f.nextAction} onChange={e => setF({ ...f, nextAction: e.target.value })} placeholder="Who does what next" /></Field>
        <Field label="Slack thread or channel" hint="Optional" full><input type="text" value={f.slack} onChange={e => setF({ ...f, slack: e.target.value })} placeholder="#channel or thread link" /></Field>
      </div>
    </Modal>
  );
}

export function BlockerRow({ b, hideComponent }: { b: Blocker; hideComponent?: boolean }) {
  const [open, setOpen] = useState(false);
  const d = daysUntil(b.target);
  const over = OPEN_BLOCKER(b) && d < 0;
  return (
    <>
      <button className={cx("blki", "sev-" + b.severity)} onClick={() => setOpen(true)}>
        <div className="blki-top">
          <code className="cid">{b.id}</code>
          <b>{b.title}</b>
          <Pill tone={SEV_TONE[b.severity]}>{b.severity}</Pill>
          {blockerStatus(b.status)}
        </div>
        <div className="blki-where">
          {!hideComponent && <><CompLink id={b.componentId} showId={false} /><span aria-hidden>·</span></>}
          <span>{b.category}</span>
        </div>
        <div className="blki-next">
          <span className="blki-lbl">Next</span>
          <span className="blki-act">{b.nextAction}</span>
          <PersonChip id={b.responsibleId} size={18} />
          <span className={cx("blki-due", over && "is-over")}>{fmtDate(b.target)}{OPEN_BLOCKER(b) && <em>{relDays(b.target)}</em>}</span>
        </div>
      </button>
      {open && <BlockerDrawer b={b} onClose={() => setOpen(false)} />}
    </>
  );
}

function BlockerDrawer({ b, onClose }: { b: Blocker; onClose: () => void }) {
  const { state, me, isAdmin, updateBlocker, component } = useStore();
  const { toast } = useToast();
  const canEdit = isAdmin || b.responsibleId === me?.id || b.reportedBy === me?.id || component(b.componentId)?.ownerId === me?.id;
  const [f, setF] = useState({ status: b.status, responsibleId: b.responsibleId, nextAction: b.nextAction, target: b.target, note: "" });
  const hist = state.history.filter(h => h.action.includes(b.id));
  const save = () => {
    updateBlocker(b.id, { status: f.status, responsibleId: f.responsibleId, nextAction: f.nextAction, target: f.target }, f.note.trim() || undefined);
    toast(f.status !== b.status ? `Blocker ${f.status.replace(/_/g, " ")}` : "Blocker updated"); onClose();
  };
  return (
    <Drawer title={b.title} sub={<>{b.id} · <a href={"#c-" + b.componentId}>{component(b.componentId)?.name}</a></>} onClose={onClose}
      footer={canEdit ? <><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save update</Button></> : undefined}>
      <div className="row">{blockerStatus(b.status)}<Pill tone={SEV_TONE[b.severity]}>{b.severity}</Pill><Pill tone="faint">{b.category}</Pill></div>
      {b.description && <p style={{ color: "var(--fg-2)" }}>{b.description}</p>}
      <dl>
        <KV k="Reported by"><PersonChip id={b.reportedBy} sub={fmtDateTime(b.createdAt)} /></KV>
        <KV k="Affected owner"><PersonChip id={component(b.componentId)?.ownerId} /></KV>
        {b.slack && <KV k="Discussion"><span className="row" style={{ gap: 6 }}><Icon name="slack" size={14} />{b.slack}</span></KV>}
        <KV k="Last updated">{ago(b.updatedAt)}</KV>
      </dl>
      {canEdit ? (
        <div style={{ display: "grid", gap: 14 }}>
          <Field label="Status"><select value={f.status} onChange={e => setF({ ...f, status: e.target.value as BlockerStatus })}>{STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          <Field label="Responsible"><PersonSelect value={f.responsibleId} onChange={v => setF({ ...f, responsibleId: v })} /></Field>
          <Field label="Next action"><input type="text" value={f.nextAction} onChange={e => setF({ ...f, nextAction: e.target.value })} /></Field>
          <Field label="Target date"><input type="date" value={f.target} onChange={e => setF({ ...f, target: e.target.value })} /></Field>
          <Field label="Update note" hint="Kept in the component history"><textarea rows={2} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></Field>
        </div>
      ) : <p className="muted" style={{ fontSize: 13 }}>Only the responsible person, the reporter, the component owner or an admin can update this blocker.</p>}
      {hist.length > 0 && <div><h4 style={{ fontSize: 13, marginBottom: 8 }}>History</h4><div style={{ display: "grid", gap: 6, fontSize: 13 }}>{hist.map(h => <div key={h.id} className="muted">{fmtDateTime(h.at)} · {personName(state.people.find(p => p.id === h.by))} · {h.action}{h.reason ? ` — ${h.reason}` : ""}</div>)}</div></div>}
    </Drawer>
  );
}

export function HandoffCard({ h }: { h: Handoff }) {
  const { me, isAdmin, person, toggleHandoffItem, ackHandoff, component } = useStore();
  const { toast } = useToast();
  const isNew = h.toId === me?.id;
  const done = h.checklist.filter(x => x.done).length;
  const all = done === h.checklist.length;
  return (
    <div className="ho">
      <div className="row-between">
        <div className="ho-flow">
          <code className="cid">{h.id}</code>
          <PersonChip id={h.fromId} /><Icon name="arrowRight" size={14} className="muted" /><PersonChip id={h.toId} />
        </div>
        {h.status === "completed" ? <Pill tone="ok">Acknowledged {h.ackAt && fmtDate(h.ackAt)}</Pill> : <Pill tone="info" dot>Awaiting acknowledgement · due {fmtDate(h.target)}</Pill>}
      </div>
      <div style={{ fontSize: 13 }}><a href={"#c-" + h.componentId} style={{ fontWeight: 500 }}>{component(h.componentId)?.name}</a> <span className="muted">· {h.reason}</span></div>
      <div className="grid-3" style={{ gap: 14, fontSize: 13 }}>
        <div><div className="muted" style={{ fontSize: 12 }}>Completed</div>{h.completed}</div>
        <div><div className="muted" style={{ fontSize: 12 }}>Outstanding</div>{h.outstanding}</div>
        <div><div className="muted" style={{ fontSize: 12 }}>Known issues</div>{h.knownIssues}</div>
      </div>
      <div className="checklist">
        <div className="row-between"><span className="muted" style={{ fontSize: 12 }}>Handover checklist · {done}/{h.checklist.length}</span></div>
        {h.checklist.map(it => (
          <label key={it.id} className="check" style={{ opacity: h.status === "completed" ? .75 : 1 }}>
            <input type="checkbox" checked={it.done} disabled={h.status === "completed" || !(isNew || isAdmin || h.fromId === me?.id)} onChange={() => toggleHandoffItem(h.id, it.id)} />
            <span style={{ textDecoration: it.done ? "line-through" : undefined, color: it.done ? "var(--fg-3)" : undefined }}>{it.text}</span>
          </label>
        ))}
      </div>
      {h.status !== "completed" && (isNew ? (
        <div className="row"><Button variant="primary" icon="check" disabled={!all} onClick={() => { ackHandoff(h.id); toast("Handoff acknowledged. You now own this component."); }}>Acknowledge handoff</Button>{!all && <span className="muted" style={{ fontSize: 12 }}>Tick every item to acknowledge.</span>}</div>
      ) : <span className="muted" style={{ fontSize: 12 }}>Waiting for {person(h.toId)?.first} to tick the checklist and acknowledge.</span>)}
    </div>
  );
}

export function Blockers() {
  const { state, person } = useStore();
  const [tab, setTab] = useState("active");
  const [modal, setModal] = useState(false);
  const [who, setWho] = useState("");
  const active = state.blockers.filter(OPEN_BLOCKER);
  const resolved = state.blockers.filter(b => !OPEN_BLOCKER(b));
  const overdue = active.filter(b => daysUntil(b.target) < 0);
  const critical = active.filter(b => b.severity === "critical");
  const affectingDates = active.filter(b => { const c = state.components.find(x => x.id === b.componentId); return c && daysUntil(c.due) <= 14; });
  const byPerson = useMemo(() => {
    const m = new Map<string, number>(); active.forEach(b => b.responsibleId && m.set(b.responsibleId, (m.get(b.responsibleId) || 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [state.blockers]);
  const list = (tab === "active" ? active : resolved).filter(b => !who || b.responsibleId === who).sort((a, b) => ({ critical: 0, high: 1, medium: 2, low: 3 }[a.severity] - { critical: 0, high: 1, medium: 2, low: 3 }[b.severity]) || a.target.localeCompare(b.target));
  const pending = state.handoffs.filter(h => h.status === "awaiting_ack");
  return (
    <>
      <PageHeader title="Blockers" sub="What is stopping progress, who is clearing it, and by when."
        actions={<Button variant="primary" icon="plus" onClick={() => setModal(true)}>Raise blocker</Button>} />

      <div className="bl-bar">
        <Tabs value={tab} onChange={setTab} tabs={[
          { id: "active", label: "Active", count: active.length },
          ...(state.handoffs.length ? [{ id: "handoffs", label: "Handoffs", count: pending.length || undefined }] : []),
          { id: "resolved", label: "Resolved", count: resolved.length },
        ]} />
        {tab !== "handoffs" && byPerson.length > 0 && (
          <div className="bl-who" role="group" aria-label="Filter by who is responsible">
            <button className={cx("axis-chip", !who && "on")} onClick={() => setWho("")}>Anyone<b>{active.length}</b></button>
            {byPerson.map(([id, n]) => (
              <button key={id} className={cx("axis-chip", who === id && "on")} onClick={() => setWho(who === id ? "" : id)} aria-pressed={who === id}>
                {personName(person(id))}<b>{n}</b>
              </button>
            ))}
          </div>
        )}
      </div>

      {tab === "handoffs" ? (
        <div style={{ display: "grid", gap: 12 }}>
          {state.handoffs.length === 0
            ? <Empty icon="handoff" title="No handoffs yet">Start one from a component's Assign action when ownership changes.</Empty>
            : state.handoffs.map(h => <HandoffCard key={h.id} h={h} />)}
        </div>
      ) : list.length === 0 ? (
        <Empty icon={tab === "active" ? "check" : "blockers"} title={tab === "active" ? "Nothing is blocked right now" : "Nothing has been resolved yet"}>
          {tab === "active"
            ? "Raise a blocker when a component cannot move forward for a reason outside the person building it."
            : "Resolved blockers stay here with who cleared them and when."}
        </Empty>
      ) : (
        <div className="panel"><div className="blklist">{list.map(b => <BlockerRow key={b.id} b={b} />)}</div></div>
      )}

      {modal && <BlockerModal onClose={() => setModal(false)} />}
    </>
  );
}
