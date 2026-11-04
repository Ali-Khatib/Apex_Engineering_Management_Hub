import React, { useMemo, useState } from "react";
import { useStore, useNav } from "../store";
import { Icon } from "../icons";
import { Button, PageHeader, Section, Tabs, Empty, cx, Pill } from "../ui";
import { ago, fmtDate, fmtDateTime, personName, STATUS_LABEL } from "../logic";
import type { HistoryEntry, Notice } from "../types";

function iconFor(h: HistoryEntry) {
  const a = h.action.toLowerCase();
  if (h.source === "github") return a.includes("pull") ? "pr" : "commit";
  if (a.includes("blocker")) return "blockers";
  if (a.includes("owner") || a.includes("reviewer") || a.includes("handoff")) return "mywork";
  if (a.includes("qa") || a.includes("evidence") || a.includes("review") || a.includes("criterion")) return "readiness";
  if (a.includes("deploy")) return "rocket";
  if (a.includes("plan") || a.includes("eta") || a.includes("milestone")) return "calendar";
  if (a.includes("status")) return "flag";
  if (a.includes("page")) return "practices";
  if (a.includes("created")) return "plus";
  return "edit";
}

export function HistoryLine({ h, showComponent, compact }: { h: HistoryEntry; showComponent?: boolean; compact?: boolean }) {
  const { state } = useStore();
  const who = state.people.find(p => p.id === h.by);
  const val = (v?: string) => { if (!v) return v; if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return fmtDate(v); const p = state.people.find(x => x.id === v); if (p) return personName(p); return (STATUS_LABEL as any)[v] || v; };
  const comp = h.entity === "component" ? state.components.find(c => c.id === h.entityId) : null;
  const prac = h.entity === "practice" ? state.practices.find(p => p.id === h.entityId) : null;
  const detail = h.from && h.to ? <>{val(h.from)} → {val(h.to)}</> : h.to ? val(h.to) : h.from ? <s>{val(h.from)}</s> : null;
  return (
    <div className="feed-item">
      <span className={cx("feed-ic", h.source === "github" && "gh")}><Icon name={iconFor(h)} size={14} /></span>
      <span className="feed-text">
        <span className="feed-who">{who ? personName(who) : h.by}</span> {h.action.charAt(0).toLowerCase() + h.action.slice(1)}
        {showComponent && comp && <> · <a href={"#c-" + comp.id}>{compact ? comp.id : comp.name}</a></>}
        {showComponent && prac && <> · <a href={"#p-" + prac.id}>{prac.title}</a></>}
        {!compact && <span className={cx("src", "src-" + h.source)}>{h.source === "github" ? "GitHub" : "Apex"}</span>}
        {(detail || h.reason) && <span className="sub">{detail}{detail && h.reason ? " · " : ""}{h.reason && <i>{h.reason}</i>}</span>}
      </span>
      <time className="feed-time" title={fmtDateTime(h.at)}>{ago(h.at)}</time>
    </div>
  );
}

const KIND_LABEL: Record<Notice["kind"], string> = { assignment: "Assignments", review: "Reviews", blocker: "Blockers", deadline: "Deadlines", handoff: "Handoffs", comment: "Comments" };
const NOTICE_ICON: Record<Notice["kind"], string> = { assignment: "mywork", review: "readiness", blocker: "blockers", deadline: "clock", handoff: "handoff", comment: "message" };

export function Activity() {
  const { state, me, markRead, markAllRead } = useStore();
  const { go } = useNav();
  const [tab, setTab] = useState("notifications");
  const [kind, setKind] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [src, setSrc] = useState("");
  const [ent, setEnt] = useState("");
  const [limit, setLimit] = useState(40);
  const mine = state.notices.filter(n => n.to === me?.id && (!kind || n.kind === kind) && (!unreadOnly || !n.read));
  const unread = state.notices.filter(n => n.to === me?.id && !n.read).length;
  const hist = useMemo(() => state.history.filter(h => (!src || h.source === src) && (!ent || h.entity === ent)), [state.history, src, ent]);
  return (
    <>
      <PageHeader title="Activity" sub="Your notifications, and the complete change history of owners, status, plans, readiness and reviews across the platform." />
      <section className="panel" style={{ overflow: "hidden" }}>
        <div style={{ padding: "6px 12px 0" }}><Tabs value={tab} onChange={setTab} tabs={[{ id: "notifications", label: "My notifications", count: unread || undefined }, { id: "history", label: "Change history", count: state.history.length }]} /></div>
        {tab === "notifications" ? <>
          <div className="toolbar" style={{ padding: "14px 20px", borderBottom: "1px solid var(--line)" }}>
            <div className="chips">{["", ...Object.keys(KIND_LABEL)].map(k => <button key={k} className={cx("chip", kind === k && "on")} onClick={() => setKind(k)}>{k ? KIND_LABEL[k as Notice["kind"]] : "All"}</button>)}</div>
            <label className="check" style={{ marginLeft: "auto" }}><input type="checkbox" checked={unreadOnly} onChange={e => setUnreadOnly(e.target.checked)} />Unread only</label>
            {unread > 0 && <Button size="sm" onClick={markAllRead}>Mark all read</Button>}
          </div>
          {mine.length === 0 ? <Empty icon="activity" title="No notifications">You'll be notified about assignments, reviews, blockers, deadlines and handoffs that involve you.</Empty> :
            <div>{mine.map(n => (
              <button key={n.id} className="notif" style={{ padding: "14px 20px" }} onClick={() => { markRead(n.id); if (n.componentId) go("c-" + n.componentId); }}>
                <span className={cx("notif-ic", "k-" + n.kind)}><Icon name={NOTICE_ICON[n.kind]} size={15} /></span>
                <span style={{ minWidth: 0 }}><b>{n.title}</b><small style={{ whiteSpace: "normal" }}>{n.body}</small><time>{fmtDateTime(n.at)} · {KIND_LABEL[n.kind]}</time></span>
                {!n.read ? <i className="unread-dot" /> : <i />}
              </button>
            ))}</div>}
          <div className="sync-note" style={{ borderRadius: 0 }}><Icon name="slack" size={14} />In production, the same notifications can also go to email and Slack, per person.</div>
        </> : <>
          <div className="toolbar" style={{ padding: "14px 20px", borderBottom: "1px solid var(--line)" }}>
            <select value={src} onChange={e => setSrc(e.target.value)} aria-label="Source"><option value="">All sources</option><option value="apex">Apex</option><option value="github">GitHub</option></select>
            <select value={ent} onChange={e => setEnt(e.target.value)} aria-label="Record type"><option value="">All records</option>{[["component", "Components"], ["practice", "Best practices"], ["plan", "Plan & milestones"], ["person", "People"], ["repo", "Repositories"], ["about", "Vision page"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            <span className="muted" style={{ fontSize: 13, marginLeft: "auto" }}>{hist.length} entries</span>
          </div>
          <div className="panel-body" style={{ paddingTop: 4 }}>
            <div className="feed">{hist.slice(0, limit).map(h => <HistoryLine key={h.id} h={h} showComponent />)}</div>
            {hist.length > limit && <div style={{ paddingTop: 12 }}><Button onClick={() => setLimit(l => l + 40)}>Show more</Button></div>}
          </div>
        </>}
      </section>
    </>
  );
}
