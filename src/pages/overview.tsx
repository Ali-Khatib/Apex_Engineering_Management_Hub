import React, { useMemo, useState } from "react";
import { useStore, useNav } from "../store";
import { Icon } from "../icons";
import { Button, PageHeader, Section, Pill, PersonChip, StatusPill, PriorityPill, RiskPill, DueText, Avatar, cx, Empty } from "../ui";
import { kpis, risk, stage, STAGE_LABEL, isDone, isOverdue, daysUntil, fmtDate, personName, ago, STATUS_LABEL, PRIORITY_ORDER } from "../logic";
import { NewComponentModal } from "./componentForms";
import { HistoryLine } from "./activity";
import type { Status, Priority } from "../types";

export const STATUS_COLOR: Record<Status, string> = { not_started: "var(--fg-4)", in_progress: "var(--info)", blocked: "var(--crit)", under_review: "var(--review)", completed: "var(--ok)" };
const PRI_COLOR: Record<Priority, string> = { critical: "var(--crit)", high: "var(--warn)", medium: "var(--fg-3)", low: "var(--line-strong)" };

export function QuickFilters({ active, onPick }: { active?: string; onPick: (q: string) => void }) {
  const { state } = useStore();
  const k = kpis(state);
  const items: [string, string, number, boolean?][] = [
    ["all", "All", state.components.length],
    ["unassigned", "Unassigned", k.unassigned, k.unassigned > 0],
    ["at_risk", "At risk", k.atRisk, k.atRisk > 0],
    ["blocked", "Blocked", k.blocked, k.blocked > 0],
    ["review", "Ready for review", k.review],
    ["overdue", "Overdue", k.overdue, k.overdue > 0],
    ["ready", "Ready for deployment", k.ready],
    ["mine", "Mine", state.components.filter(c => c.ownerId === state.me).length],
  ];
  return <div className="chips" role="group" aria-label="Quick filters">{items.map(([id, l, n, alert]) => <button key={id} className={cx("chip", active === id && "on", alert && "chip-alert")} onClick={() => onPick(id)} aria-pressed={active === id}>{l}<span className="n">{n}</span></button>)}</div>;
}

function Bars({ rows, onPick, max }: { rows: { key: string; label: React.ReactNode; segs: { v: number; color: string; title: string }[] }[]; onPick?: (k: string) => void; max?: number }) {
  const m = max || Math.max(1, ...rows.map(r => r.segs.reduce((a, s) => a + s.v, 0)));
  return (
    <div className="bars">
      {rows.map(r => {
        const total = r.segs.reduce((a, s) => a + s.v, 0);
        const Tag: any = onPick ? "button" : "div";
        return (
          <Tag key={r.key} className="bar-row" onClick={onPick ? () => onPick(r.key) : undefined} title={r.segs.filter(s => s.v).map(s => `${s.title}: ${s.v}`).join("\n")}>
            <span className="lbl">{r.label}</span>
            <span className="bar-track" style={{ width: `${Math.max(total / m * 100, total ? 4 : 0)}%`, background: total ? undefined : "transparent" }}>{r.segs.map((s, i) => s.v > 0 && <i key={i} style={{ width: `${s.v / total * 100}%`, background: s.color }} />)}</span>
            <span className="v">{total}</span>
          </Tag>
        );
      })}
    </div>
  );
}

function WeeklyColumns({ data }: { data: { label: string; v: number; cur?: boolean }[] }) {
  const W = 340, H = 180, pad = { l: 22, r: 6, t: 16, b: 24 };
  const max = Math.max(2, ...data.map(d => d.v));
  const bw = (W - pad.l - pad.r) / data.length;
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const ticks = Array.from(new Set([0, Math.ceil(max / 2), max]));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" style={{ width: "100%", height: "auto" }} role="img" aria-label="Components completed per week">
      {ticks.map(t => <g key={t}><line className="grid" x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} /><text x={pad.l - 6} y={y(t) + 4} textAnchor="end">{t}</text></g>)}
      {data.map((d, i) => <g key={i}>
        <rect className={cx("bar", d.cur && "cur")} x={pad.l + i * bw + bw * 0.2} y={y(d.v)} width={bw * 0.6} height={Math.max(0, y(0) - y(d.v))} rx="3" />
        {d.v > 0 && <text x={pad.l + i * bw + bw / 2} y={y(d.v) - 4} textAnchor="middle" style={{ fill: "var(--fg)", fontWeight: 600 }}>{d.v}</text>}
        {(i % 2 === 0 || d.cur) && <text x={pad.l + i * bw + bw / 2} y={H - 6} textAnchor="middle">{d.label}</text>}
      </g>)}
    </svg>
  );
}

export function Overview() {
  const { state, isAdmin, person } = useStore();
  const { openComponents, go } = useNav();
  const [newOpen, setNewOpen] = useState(false);
  const k = kpis(state);
  const cs = state.components;
  const risks = useMemo(() => cs.map(c => ({ c, r: risk(state, c) })), [state]);
  const attention = risks.filter(x => x.r.level === "blocked" || x.r.level === "at_risk")
    .sort((a, b) => (a.r.level === "blocked" ? 0 : 1) - (b.r.level === "blocked" ? 0 : 1) || PRIORITY_ORDER[a.c.priority] - PRIORITY_ORDER[b.c.priority] || a.c.due.localeCompare(b.c.due));
  const upcoming = cs.filter(c => !isDone(c) && daysUntil(c.due) >= 0 && daysUntil(c.due) <= 21).sort((a, b) => a.due.localeCompare(b.due)).slice(0, 5);
  const projProgress = state.projects.map(p => {
    const pc = cs.filter(c => c.projectId === p.id);
    return { p, done: pc.filter(isDone).length, total: pc.length };
  });
  const stat = (label: string, value: number, hint: string, onClick: () => void, tone?: string) => (
    <button className={cx("kpi", tone)} onClick={onClick}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      <span className="kpi-foot">{hint}</span>
    </button>
  );
  return (
    <>
      <PageHeader title="Overview" sub={new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
        actions={isAdmin && <Button variant="primary" icon="plus" onClick={() => setNewOpen(true)}>New component</Button>} />

      <div className="kpis kpis-4">
        {stat("Components", k.total, `${k.completed} done · ${k.projects} projects`, () => openComponents({}))}
        {stat("In progress", k.inProgress + k.review, `${k.review} in review`, () => openComponents({ status: "in_progress" }))}
        {stat("Need attention", k.atRisk + k.blocked, `${k.blocked} blocked · ${k.unassigned} without owner`, () => openComponents({ quick: "at_risk" }), k.atRisk + k.blocked ? "kpi-alert" : undefined)}
        {stat("Ready to ship", k.ready + k.deployed, `${k.deployed} already deployed`, () => openComponents({ quick: "ready" }), "kpi-good")}
      </div>

      <div className="split">
        <Section title="Needs attention" actions={attention.length > 5 && <Button size="sm" variant="ghost" iconRight="arrowRight" onClick={() => openComponents({ quick: "at_risk" })}>All {attention.length}</Button>}>
          <div className="list-plain">
            {attention.length === 0 && <Empty icon="check" title="Everything is on track" />}
            {attention.slice(0, 5).map(({ c, r }) => (
              <a key={c.id} href={"#c-" + c.id} className="li li-lg">
                <span style={{ minWidth: 0 }}><b>{c.name}</b><small className={r.level === "blocked" ? "t-crit-text" : "t-warn-text"}>{r.reasons[0]}</small></span>
                <DueText c={c} />
              </a>
            ))}
          </div>
        </Section>
        <div className="stack-v">
          <Section title="Coming up">
            <div className="list-plain">
              {upcoming.length === 0 && <Empty icon="calendar" title="Nothing due in the next three weeks" />}
              {upcoming.map(c => (
                <a key={c.id} href={"#c-" + c.id} className="li"><span style={{ minWidth: 0 }}><b>{c.name}</b><small>{personName(person(c.ownerId))}</small></span><DueText c={c} /></a>
              ))}
            </div>
          </Section>
          <Section title="Projects">
            <div className="panel-body" style={{ display: "grid", gap: 16 }}>
              {projProgress.map(x => (
                <button key={x.p.id} className="proj-row" onClick={() => openComponents({ project: x.p.id })}>
                  <span className="row-between"><span>{x.p.name}</span><span className="muted tnum">{x.done}/{x.total}</span></span>
                  <span className="progress"><i style={{ width: `${x.total ? x.done / x.total * 100 : 0}%` }} /></span>
                </button>
              ))}
            </div>
          </Section>
        </div>
      </div>
      {newOpen && <NewComponentModal onClose={() => setNewOpen(false)} />}
    </>
  );
}
