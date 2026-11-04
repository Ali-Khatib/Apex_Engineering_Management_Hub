import React, { useMemo, useState } from "react";
import { useStore, useNav } from "../store";
import { Icon } from "../icons";
import { StatusPill, PersonChip, Pill, cx } from "../ui";
import { personName, fmtDate, isDone, openBlockers, nextAction, risk } from "../logic";
import type { Component } from "../types";

/* ──────────────────────────────────────────────────────────────────────────
   The specification used to be one generated markdown document: every field
   flattened into a heading and a paragraph. The structure was already in the
   record (lib.op, lib.inputs, lib.outputs, lib.entities, lib.trigger …), so
   these panels render that structure directly instead of prose about it.
   ────────────────────────────────────────────────────────────────────────── */

/** A labelled fact. Used where a value is short and scannable. */
export function Fact({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={cx("fact", wide && "fact-wide")}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Information the record does not carry. Named, never invented. */
export function Missing({ what }: { what: string }) {
  return <span className="missing"><Icon name="alert" size={12} />Not recorded: {what}</span>;
}

/** The operation contract: what goes in, what comes back. */
export function Contract({ c }: { c: Component }) {
  const lib = c.lib;
  if (!lib) return null;
  const io = (items: string[]) => items.length
    ? <ul className="io-list">{items.map(x => <li key={x}><code>{x}</code></li>)}</ul>
    : <Missing what="fields" />;
  return (
    <div className="spec-contract">
      <div className="contract-head">
        <span className="contract-op">{lib.op || <Missing what="operation" />}</span>
        {lib.entities.length > 0 && (
          <span className="contract-ent">
            Keeps {lib.entities.map(e => <code key={e}>{e}</code>)}
          </span>
        )}
      </div>
      <div className="contract-io">
        <div className="io">
          <h5>Takes in</h5>
          {io(lib.inputs)}
        </div>
        <div className="io-arrow" aria-hidden><Icon name="arrowRight" size={18} /></div>
        <div className="io">
          <h5>Gives back</h5>
          {io(lib.outputs)}
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   Architecture map. Every edge is a relationship already in the record:
   lib.sps (modules this builds on), deps (must finish first) and the inverse
   of deps (components waiting on this). Nothing is inferred.
   ────────────────────────────────────────────────────────────────────────── */
const NW = 158, NH = 40, VGAP = 10, CAP = 4;

function NodeBox({ x, y, title, sub, tone, onClick, title2 }: { x: number; y: number; title: string; sub?: string; tone: string; onClick?: () => void; title2?: string }) {
  const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
  return (
    <g className={cx("amap-node", "t-" + tone, onClick && "is-link")} onClick={onClick} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }) : undefined}>
      <title>{title2 || title}</title>
      <rect x={x} y={y} width={NW} height={NH} rx="7" />
      <text x={x + 11} y={y + (sub ? 17 : 24)} className="amap-t">{clip(title, 22)}</text>
      {sub && <text x={x + 11} y={y + 31} className="amap-s">{clip(sub, 26)}</text>}
    </g>
  );
}

export function ArchitectureMap({ c }: { c: Component }) {
  const { state } = useStore();
  const { go } = useNav();
  const [sel, setSel] = useState<string | null>(null);

  const mods = (c.lib?.sps || []).map(id => state.modules.find(m => m.id === id)).filter(Boolean) as { id: string; name: string; description: string }[];
  const deps = c.deps.map(d => state.components.find(x => x.id === d)).filter(Boolean) as Component[];
  const dependents = state.components.filter(x => x.deps.includes(c.id));

  const left = [
    ...mods.slice(0, CAP).map(m => ({ key: m.id, title: m.id, sub: m.name, tone: "mod", to: "m-" + m.id, full: `${m.id} ${m.name} — ${m.description}` })),
    ...deps.slice(0, CAP).map(d => ({ key: d.id, title: d.name, sub: `${d.id} · ${d.ownerId ? personName(state.people.find(p => p.id === d.ownerId)) : "Unassigned"}`, tone: isDone(d) ? "done" : openBlockers(state, d.id).length ? "blocked" : d.ownerId ? "active" : "idle", to: "c-" + d.id, full: `${d.id} ${d.name}` })),
  ];
  const right = dependents.slice(0, CAP * 2).map(d => ({ key: d.id, title: d.name, sub: `${d.id} · ${d.ownerId ? personName(state.people.find(p => p.id === d.ownerId)) : "Unassigned"}`, tone: isDone(d) ? "done" : "idle", to: "c-" + d.id, full: `${d.id} ${d.name}` }));

  const rows = Math.max(left.length, right.length, 1);
  const H = Math.max(rows * (NH + VGAP) + 56, 190);
  const W = 720;
  const colL = 8, colC = (W - NW) / 2, colR = W - NW - 8;
  const midY = H / 2 - NH / 2;
  const yOf = (i: number, n: number) => (H - 44 - n * NH - (n - 1) * VGAP) / 2 + 30 + i * (NH + VGAP);

  const edge = (x1: number, y1: number, x2: number, y2: number, k: string, tone: string) => {
    const mx = (x1 + x2) / 2;
    return <path key={k} className={cx("amap-edge", "e-" + tone)} d={`M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`} markerEnd="url(#amap-arrow)" />;
  };

  const hiddenL = (mods.length > CAP ? mods.length - CAP : 0) + (deps.length > CAP ? deps.length - CAP : 0);
  const hiddenR = dependents.length > CAP * 2 ? dependents.length - CAP * 2 : 0;

  if (!left.length && !right.length) {
    return <div className="amap-empty"><Icon name="graph" size={18} /><div><b>No recorded relationships</b><p>This component names no platform module and no dependency, and nothing names it. Add them from Edit, or in the dependency graph.</p></div></div>;
  }

  return (
    <div className="amap">
      <svg viewBox={`0 0 ${W} ${H}`} className="amap-svg" role="img" aria-label="Architecture: what this component builds on, needs first, and feeds">
        <defs>
          <marker id="amap-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 1 L7 4 L0 7 z" className="amap-arrowhead" />
          </marker>
        </defs>
        <text x={colL} y="16" className="amap-col">Builds on · needs first</text>
        <text x={colR} y="16" className="amap-col">Waiting on this</text>

        {left.map((n, i) => edge(colL + NW, yOf(i, left.length) + NH / 2, colC - 6, midY + NH / 2, "l" + n.key, n.tone))}
        {right.map((n, i) => edge(colC + NW, midY + NH / 2, colR - 6, yOf(i, right.length) + NH / 2, "r" + n.key, n.tone))}

        {left.map((n, i) => <NodeBox key={n.key} x={colL} y={yOf(i, left.length)} title={n.title} sub={n.sub} tone={sel && sel !== n.key ? "dim" : n.tone} title2={n.full} onClick={() => { setSel(n.key); go(n.to); }} />)}
        {right.map((n, i) => <NodeBox key={n.key} x={colR} y={yOf(i, right.length)} title={n.title} sub={n.sub} tone={sel && sel !== n.key ? "dim" : n.tone} title2={n.full} onClick={() => { setSel(n.key); go(n.to); }} />)}
        <NodeBox x={colC} y={midY} title={c.name} sub={c.id} tone="self" title2={`${c.id} ${c.name}`} />

        {hiddenL > 0 && <text x={colL + 4} y={H - 10} className="amap-more">+{hiddenL} more</text>}
        {hiddenR > 0 && <text x={colR + 4} y={H - 10} className="amap-more">+{hiddenR} more</text>}
      </svg>
      <div className="amap-key">
        <span><i className="k-mod" />Platform module</span>
        <span><i className="k-done" />Complete</span>
        <span><i className="k-active" />Owned</span>
        <span><i className="k-blocked" />Blocked</span>
        <span><i className="k-idle" />Unassigned</span>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   Dependencies that answer: what does it give me, who owns it, is it
   holding me up, and what happens next.
   ────────────────────────────────────────────────────────────────────────── */
export function DependencyCard({ d, direction }: { d: Component; direction: "needs" | "feeds" }) {
  const { state, person } = useStore();
  const ob = openBlockers(state, d.id);
  const done = isDone(d);
  const na = nextAction(state, d);
  const state_ = done ? "done" : ob.length ? "blocked" : !d.ownerId ? "idle" : "active";
  const holdsUp = direction === "needs" && !done;
  return (
    <a href={"#c-" + d.id} className={cx("depc", "s-" + state_)}>
      <div className="depc-top">
        <code className="cid">{d.id}</code>
        <b>{d.name}</b>
        <StatusPill s={d.status} />
      </div>
      <p className="depc-what">{d.purpose || d.summary || <Missing what="purpose" />}</p>
      <div className="depc-meta">
        <span className="depc-owner">{d.ownerId ? <PersonChip id={d.ownerId} size={18} /> : <em>No owner</em>}</span>
        {d.due && <span className="depc-due">due {fmtDate(d.due)}</span>}
        {holdsUp && <span className="depc-hold">{ob.length ? "Blocked, holds this up" : !d.ownerId ? "Unassigned, holds this up" : "Must finish first"}</span>}
      </div>
      <div className="depc-next"><span>Next</span>{na.text}{na.who && <em>{personName(person(na.who))}</em>}</div>
    </a>
  );
}

/** The one thing to do now, stated before any documentation. */
export function NextActionBar({ c }: { c: Component }) {
  const { state, person } = useStore();
  const na = useMemo(() => nextAction(state, c), [state, c]);
  const r = risk(state, c);
  // The blocker alarm below states the same action in full, so this would be
  // the same sentence twice.
  if (openBlockers(state, c.id).length) return null;
  if (isDone(c)) return <div className="nab is-done"><Icon name="check" size={16} /><div><b>Delivered</b><span>Checks passed, QA accepted and deployment approved.</span></div></div>;
  return (
    <div className={cx("nab", na.urgent && "is-urgent")}>
      <Icon name={na.urgent ? "alert" : "arrowRight"} size={16} />
      <div>
        <b>{na.text}</b>
        <span>{na.who ? `${personName(person(na.who))} · ` : ""}{r.reasons.length ? r.reasons[0] : `${c.criteria.filter(k => k.status === "accepted").length} of ${c.criteria.length} acceptance criteria accepted`}</span>
      </div>
    </div>
  );
}

/** Blockers read as an alarm, not as more documentation. */
export function BlockerAlarm({ c, onAdd }: { c: Component; onAdd: () => void }) {
  const { state, person } = useStore();
  const ob = openBlockers(state, c.id);
  if (!ob.length) return null;
  return (
    <div className="balarm" role="alert">
      <div className="balarm-head">
        <Icon name="blockers" size={16} />
        <b>{ob.length === 1 ? "This component is blocked" : `${ob.length} blockers on this component`}</b>
        <button onClick={onAdd}>Add another</button>
      </div>
      {ob.map(b => (
        <div key={b.id} className="balarm-item">
          <div className="balarm-t"><code>{b.id}</code><b>{b.title}</b><Pill tone={b.severity === "critical" ? "crit-solid" : b.severity === "high" ? "crit" : "warn"}>{b.severity}</Pill></div>
          <p>{b.description}</p>
          <dl className="balarm-dl">
            <Fact label="Next action">{b.nextAction}</Fact>
            <Fact label="Responsible">{b.responsibleId ? <PersonChip id={b.responsibleId} size={18} /> : <em>Nobody assigned</em>}</Fact>
            <Fact label="Target">{fmtDate(b.target)}</Fact>
          </dl>
        </div>
      ))}
    </div>
  );
}

/**
 * §7: the same page serves an engineer, a reviewer, QA and management. Rather
 * than hiding information from anyone, this names the reader's own stake in
 * this component and what, if anything, is waiting on them.
 */
export function YourPart({ c }: { c: Component }) {
  const { state, me, isAdmin } = useStore();
  if (!me) return null;
  const owner = c.ownerId === me.id;
  const reviewer = c.reviewerId === me.id;
  const qa = c.qaId === me.id;

  let role = "", todo = "", tone = "idle";
  if (owner) {
    role = "You own this component";
    const na = nextAction(state, c);
    todo = na.who === me.id ? na.text : `Waiting on someone else. ${na.text}`;
    tone = na.who === me.id ? "act" : "wait";
  } else if (qa && ["awaiting", "in_progress"].includes(c.gates.qa.state)) {
    role = "You are the QA contact"; todo = "A QA decision is waiting on you"; tone = "act";
  } else if (qa) {
    role = "You are the QA contact"; todo = c.gates.qa.state === "accepted" ? "You have accepted this" : "Nothing to review yet";
    tone = c.gates.qa.state === "accepted" ? "done" : "wait";
  } else if (reviewer && (c.review === "in_review" || c.criteria.some(k => k.status === "submitted"))) {
    role = "You are the reviewer"; todo = "A review is waiting on you"; tone = "act";
  } else if (reviewer) {
    role = "You are the reviewer"; todo = "Nothing submitted for review yet"; tone = "wait";
  } else if (isAdmin) {
    role = "You are not assigned to this"; todo = "As an admin you can reassign it or change its priority"; tone = "idle";
  } else {
    role = "You are not assigned to this"; todo = "Read only. Ask an admin if it should be yours."; tone = "idle";
  }
  return (
    <div className={cx("ypart", "y-" + tone)}>
      <b>{role}</b>
      <span>{todo}</span>
    </div>
  );
}
