import React, { useEffect, useMemo, useRef, useState } from "react";
import { useStore, useToast } from "../store";
import { Icon } from "../icons";
import { Button, PageHeader, Section, Segmented, Markdown, MarkdownEditor, Modal, Field, ConfirmButton, Pill, Avatar, cx, Empty } from "../ui";
import { Graph } from "./graph";
import { addDays, iso, today, fmtDate, daysUntil, personName, isDone, ago, STATUS_LABEL } from "../logic";
import type { Component, Milestone } from "../types";

const DAY = 86400000;
const toT = (s: string) => new Date(s + "T00:00:00").getTime();

export function Plan({ initialTab = "timeline" }: { initialTab?: "timeline" | "deps" }) {
  const [view, setView] = useState<"timeline" | "deps">(initialTab);
  const { state, isAdmin, person, updateComponent, savePlanNotes, deleteMilestone } = useStore();
  const { toast } = useToast();
  const [groupBy, setGroupBy] = useState<"project" | "category">("project");
  const [scale, setScale] = useState<"week" | "month">("week");
  const [editNotes, setEditNotes] = useState(false);
  const [notes, setNotes] = useState(state.plan.notes);
  const [ms, setMs] = useState<Milestone | null | "new">(null);
  const [drag, setDrag] = useState<{ id: string; mode: "move" | "end"; sx: number; ds: number; de: number } | null>(null);
  const dayW = scale === "week" ? 18 : 6;
  const ganttRef = useRef<HTMLDivElement>(null);
  const cs = state.components;
  const t0 = useMemo(() => { const m = Math.min(...cs.map(c => toT(c.start)), toT(iso(today()))) - 7 * DAY; const d = new Date(m); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); }, [cs]);
  const t1 = useMemo(() => Math.max(...cs.map(c => Math.max(toT(c.due), toT(c.eta))), ...state.milestones.map(m => toT(m.date))) + 21 * DAY, [cs, state.milestones]);
  const days = Math.round((t1 - t0) / DAY);
  const x = (s: string) => Math.round((toT(s) - t0) / DAY) * dayW;
  const width = days * dayW;
  const weeks = Array.from({ length: Math.ceil(days / 7) }, (_, i) => t0 + i * 7 * DAY);
  const months = (() => { const out: number[] = []; const d = new Date(t0); d.setDate(1); d.setMonth(d.getMonth() + 1); while (d.getTime() < t1) { out.push(d.getTime()); d.setMonth(d.getMonth() + 1); } return out; })();
  const todayX = Math.round((toT(iso(today())) - t0) / DAY) * dayW;
  useEffect(() => { const el = ganttRef.current; if (el) el.scrollLeft = Math.max(0, todayX - (el.clientWidth - 260) * 0.3); }, [scale]);

  const groups = groupBy === "project"
    ? state.projects.map(p => ({ key: p.id, label: p.name, items: cs.filter(c => c.projectId === p.id) }))
    : [...new Set(cs.map(c => c.category))].map(cat => ({ key: cat, label: cat, items: cs.filter(c => c.category === cat) }));

  const shifted = (c: Component) => {
    if (!drag || drag.id !== c.id) return { start: c.start, due: c.due };
    return { start: addDays(c.start, drag.ds), due: addDays(c.due, drag.de) };
  };
  const onDown = (e: React.PointerEvent, c: Component, mode: "move" | "end") => {
    if (!isAdmin) return;
    e.preventDefault(); e.stopPropagation(); (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setDrag({ id: c.id, mode, sx: e.clientX, ds: 0, de: 0 });
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const dd = Math.round((e.clientX - drag.sx) / dayW);
    const c = cs.find(x => x.id === drag.id)!;
    if (drag.mode === "move") setDrag({ ...drag, ds: dd, de: dd });
    else setDrag({ ...drag, ds: 0, de: Math.max(dd, Math.round((toT(c.start) - toT(c.due)) / DAY) + 1) });
  };
  const onUp = () => {
    if (!drag) return;
    const c = cs.find(x => x.id === drag.id)!;
    if (drag.ds || drag.de) {
      const s = shifted(c);
      updateComponent(c.id, { start: s.start, due: s.due, eta: c.eta === c.due ? s.due : c.eta }, "Rescheduled on the development plan");
      toast(`${c.id} now due ${fmtDate(s.due)}. Owner notified.`);
    }
    setDrag(null);
  };

  return (
    <>
      <header className="hero-head"><div><h1>Plan</h1><p className="lede">Milestones, the schedule, and what depends on what.</p></div>
        <Segmented options={[{ id: "timeline", label: "Timeline" }, { id: "deps", label: "Dependencies" }]} value={view} onChange={setView} />
      </header>
      {view === "deps" ? <Graph embedded /> : <>
      <div className="row" style={{ justifyContent: "flex-end", marginTop: -12 }}>
        <Segmented options={[{ id: "project", label: "By project" }, { id: "category", label: "By category" }]} value={groupBy} onChange={setGroupBy} />
        <Segmented options={[{ id: "week", label: "Weeks" }, { id: "month", label: "Months" }]} value={scale} onChange={setScale} />
      </div>

      <section className="panel" style={{ overflow: "hidden" }}>
        <div className="panel-head" style={{ paddingBottom: 14 }}>
          <div><h2>Schedule</h2><p>{isAdmin ? "Drag a bar to move it, or its right edge to change the due date. Every change is recorded with the owner notified." : "Read-only for members. Admins can reschedule by dragging."}</p></div>
          <div className="legend">{(["not_started", "in_progress", "blocked", "under_review", "completed"] as const).map(s => <span key={s}><i className={"b-" + s} style={{ border: "1px solid", width: 14 }} />{STATUS_LABEL[s]}</span>)}<span><i style={{ background: "var(--brand)", transform: "rotate(45deg)", width: 9, height: 9 }} />Milestone</span></div>
        </div>
        <div className="gantt" ref={ganttRef} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <div className="gantt-inner" style={{ width: 260 + width }}>
            <div className="g-row g-head" style={{ gridTemplateColumns: `260px ${width}px` }}>
              <div className="g-row-label">Component</div>
              <div className="g-track" style={{ height: 30 }}>
                {scale === "week" ? weeks.map(w => <span key={w} className="g-week" style={{ left: (w - t0) / DAY * dayW }}>{new Date(w).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>)
                  : months.map(m => <span key={m} className="g-week" style={{ left: (m - t0) / DAY * dayW }}>{new Date(m).toLocaleDateString("en-GB", { month: "short", year: "2-digit" })}</span>)}
              </div>
            </div>
            <div className="g-row" style={{ gridTemplateColumns: `260px ${width}px`, minHeight: 52 }}>
              <div className="g-row-label"><Icon name="flag" size={14} /><b style={{ fontWeight: 600 }}>Milestones</b></div>
              <div className="g-track">
                {state.milestones.map(m => <span key={m.id} className="g-ms" style={{ left: x(m.date) }} title={`${m.name} · ${fmtDate(m.date)}`}><i /><span>{m.name.length > 22 ? m.name.slice(0, 21) + "…" : m.name}</span></span>)}
              </div>
            </div>
            <div style={{ position: "relative" }}>
              <div style={{ position: "absolute", left: 260, top: 0, bottom: 0, width, pointerEvents: "none", zIndex: 1 }}>
                <span className="g-today" style={{ left: todayX }} />
                {state.milestones.map(m => <span key={m.id} className="g-ms-line" style={{ left: x(m.date) }} />)}
              </div>
              {groups.map(g => (
                <React.Fragment key={g.key}>
                  <div className="g-row g-row-cat" style={{ gridTemplateColumns: `260px ${width}px` }}><div className="g-row-label">{g.label} · {g.items.length}</div><div /></div>
                  {g.items.sort((a, b) => a.start.localeCompare(b.start)).map(c => {
                    const s = shifted(c);
                    const left = x(s.start), w = Math.max(dayW, x(s.due) - left + dayW);
                    const acc = c.criteria.length ? c.criteria.filter(k => k.status === "accepted").length / c.criteria.length : 0;
                    const etaW = c.eta > c.due ? x(c.eta) - x(s.due) : 0;
                    const o = person(c.ownerId);
                    return (
                      <div key={c.id} className="g-row" style={{ gridTemplateColumns: `260px ${width}px` }}>
                        <div className="g-row-label"><Avatar p={o} size={20} /><a href={"#c-" + c.id} title={c.name}>{c.name}</a></div>
                        <div className="g-track">
                          {etaW > 0 && <span className="g-eta" style={{ left: left + w, width: etaW }} title={`ETA ${fmtDate(c.eta)}`} />}
                          <div className={cx("g-bar", "b-" + c.status, isAdmin && "edit", drag?.id === c.id && "drag")} style={{ left, width: w }} onPointerDown={e => onDown(e, c, "move")}
                            title={`${c.id} ${c.name}\n${fmtDate(s.start)} → ${fmtDate(s.due)}${c.eta > c.due ? `\nETA ${fmtDate(c.eta)}` : ""}\nOwner: ${personName(o)}`}>
                            <i className="fill" style={{ width: `${acc * 100}%`, background: "currentColor" }} />
                            <span>{drag?.id === c.id ? `${fmtDate(s.start)} → ${fmtDate(s.due)}` : c.id}</span>
                            {isAdmin && <span className="handle" onPointerDown={e => onDown(e, c, "end")} aria-hidden />}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
        <div className="sync-note" style={{ borderRadius: 0 }}><Icon name="readiness" size={14} />Shaded part of each bar = share of acceptance criteria accepted.</div>
      </section>

      <div className="split">
        <Section title="Plan notes" sub={`Approach, focus and risks · updated ${ago(state.plan.updatedAt)} by ${personName(person(state.plan.updatedBy))}`} actions={isAdmin && !editNotes && <Button size="sm" icon="edit" onClick={() => { setNotes(state.plan.notes); setEditNotes(true); }}>Edit</Button>}>
          <div className="panel-body">
            {editNotes ? <div style={{ display: "grid", gap: 12 }}><MarkdownEditor value={notes} onChange={setNotes} rows={16} /><div className="row" style={{ justifyContent: "flex-end" }}><Button variant="ghost" onClick={() => setEditNotes(false)}>Cancel</Button><Button variant="primary" onClick={() => { savePlanNotes(notes); setEditNotes(false); toast("Plan notes saved"); }}>Save notes</Button></div></div>
              : <Markdown src={state.plan.notes} />}
          </div>
        </Section>
        <Section title="Milestones" actions={isAdmin && <Button size="sm" icon="plus" onClick={() => setMs("new")}>Add</Button>}>
          <div className="list-plain">
            {state.milestones.length === 0 && <Empty icon="flag" title="No milestones yet" />}
            {state.milestones.map(m => {
              const mc = m.componentIds.map(id => cs.find(c => c.id === id)).filter(Boolean) as Component[];
              const done = mc.filter(isDone).length; const d = daysUntil(m.date);
              const late = mc.filter(c => !isDone(c) && c.eta > m.date).length;
              return (
                <div key={m.id} style={{ display: "grid", gap: 8 }}>
                  <div className="row-between"><b>{m.name}</b>{isAdmin && <Button size="sm" variant="ghost" icon="edit" aria-label={`Edit ${m.name}`} onClick={() => setMs(m)} />}</div>
                  <span className="muted" style={{ fontSize: 13 }}>{fmtDate(m.date)} · {d < 0 ? `${-d} days ago` : d === 0 ? "today" : `in ${d} days`} · {done}/{mc.length} components done</span>
                  <div className="progress"><i style={{ width: `${mc.length ? done / mc.length * 100 : 0}%` }} /></div>
                  {late > 0 && d >= 0 && <span style={{ color: "var(--crit)", fontSize: 12.5 }}><Icon name="alert" size={12} /> {late} component{late > 1 ? "s have ETAs" : " has an ETA"} after this date</span>}
                </div>
              );
            })}
          </div>
        </Section>
      </div>
      </>}
      {ms && <MilestoneModal m={ms === "new" ? null : ms} onClose={() => setMs(null)} onDelete={id => { deleteMilestone(id); toast("Milestone removed"); }} />}
    </>
  );
}

function MilestoneModal({ m, onClose, onDelete }: { m: Milestone | null; onClose: () => void; onDelete: (id: string) => void }) {
  const { state, saveMilestone } = useStore();
  const { toast } = useToast();
  const [f, setF] = useState<Milestone>(m || { id: "ms" + Date.now().toString(36), name: "", date: addDays(iso(today()), 30), description: "", componentIds: [] });
  const [err, setErr] = useState("");
  return (
    <Modal title={m ? "Edit milestone" : "New milestone"} onClose={onClose} footer={<>
      {m && <span style={{ marginRight: "auto" }}><ConfirmButton label="Delete" onConfirm={() => { onDelete(m.id); onClose(); }} /></span>}
      <Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => { if (!f.name.trim()) { setErr("Name the milestone."); return; } saveMilestone({ ...f, name: f.name.trim() }); toast("Milestone saved"); onClose(); }}>Save milestone</Button></>}>
      <Field label="Name" error={err}><input type="text" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="Date"><input type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></Field>
      <Field label="What it means"><textarea rows={2} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></Field>
      <div className="field"><label>Components in this milestone</label>
        <div style={{ maxHeight: 200, overflowY: "auto", border: "1px solid var(--line-strong)", borderRadius: 10, padding: 6, display: "grid", gap: 2 }}>
          {state.components.map(c => <label key={c.id} className="check" style={{ padding: "4px 6px" }}><input type="checkbox" checked={f.componentIds.includes(c.id)} onChange={() => setF({ ...f, componentIds: f.componentIds.includes(c.id) ? f.componentIds.filter(x => x !== c.id) : [...f.componentIds, c.id] })} /><span><code className="cid">{c.id}</code> {c.name}</span></label>)}
        </div>
      </div>
    </Modal>
  );
}
