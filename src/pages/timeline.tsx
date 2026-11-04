import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { Icon } from "../icons";
import { Avatar, cx } from "../ui";
import {
  DAY, dayOf, fmtDate, isDone, isScheduled, personName, risk, spanDays,
  conflicts, overlaps, daysUntil,
} from "../logic";
import type { Component } from "../types";

/**
 * A timeline of recorded dates. Nothing here is inferred: a component appears
 * only if it carries both a start and a due date, and the ones that do not are
 * listed underneath by name rather than placed somewhere plausible. A bar in a
 * guessed position reads as a commitment, and nobody made it.
 *
 * There is no horizontal scrolling. The visible window is a range of dates,
 * and the buttons move and widen that range, so the chart is always exactly as
 * wide as the page.
 */

const ZOOMS = [21, 45, 90, 180, 365];
const LBL = 268;   // label column, px. Fixed so the arrow overlay can do maths.
const ROW = 34;

type Link = { key: string; late: boolean; d: string; span: { y: number; x1: number; x2: number } | null };

const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const monthsIn = (from: number, to: number) => {
  const out: number[] = [];
  const d = new Date(from); d.setDate(1); d.setHours(0, 0, 0, 0);
  if (d.getTime() < from) d.setMonth(d.getMonth() + 1);
  while (d.getTime() <= to) { out.push(d.getTime()); d.setMonth(d.getMonth() + 1); }
  return out;
};
const weeksIn = (from: number, to: number) => {
  const out: number[] = [];
  const d = new Date(from); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7));   // next Monday
  while (d.getTime() <= to) { out.push(d.getTime()); d.setDate(d.getDate() + 7); }
  return out;
};

export function Timeline({ rows, unscheduled, showDeps, chain, note }: {
  rows: Component[];
  unscheduled: Component[];
  showDeps?: boolean;
  chain?: Set<string>;
  note?: React.ReactNode;
}) {
  const { state, person } = useStore();
  const [sel, setSel] = useState<string | null>(null);
  const [arrows, setArrows] = useState(!!showDeps);
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);

  // The full extent of the recorded dates, which is what "fit" means.
  const extent = useMemo(() => {
    if (!rows.length) return null;
    const a = Math.min(...rows.map(c => dayOf(c.start)));
    const b = Math.max(...rows.map(c => Math.max(dayOf(c.due), c.eta ? dayOf(c.eta) : 0)));
    return { a, b, days: Math.ceil((b - a) / DAY) };
  }, [rows]);

  const [zoom, setZoom] = useState(() => {
    const need = (extent?.days ?? 90) + 8;
    return Math.max(0, ZOOMS.findIndex(z => z >= need)) || (need > ZOOMS[ZOOMS.length - 1] ? ZOOMS.length - 1 : 0);
  });
  const span = ZOOMS[zoom];
  const [from, setFrom] = useState(() => startOfDay((extent?.a ?? Date.now()) - 4 * DAY));
  const to = from + span * DAY;

  useLayoutEffect(() => {
    const m = () => setW(wrap.current?.clientWidth ?? 0);
    m();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(m) : null;
    if (ro && wrap.current) ro.observe(wrap.current);
    return () => ro?.disconnect();
  }, []);

  const pct = (t: number) => ((t - from) / (to - from)) * 100;
  const months = useMemo(() => monthsIn(from, to), [from, to]);
  const weeks = useMemo(() => (span <= 45 ? weeksIn(from, to) : []), [from, to, span]);
  const todayPct = pct(startOfDay(Date.now()));

  const visible = useMemo(() => rows.filter(c => dayOf(c.due) >= from && dayOf(c.start) <= to), [rows, from, to]);
  const hidden = rows.length - visible.length;

  /**
   * Arrow geometry, in real pixels so the arrowheads stay round.
   *
   * Only prerequisites that finish before the work depending on them starts are
   * drawn. A prerequisite due *after* that start has to travel backwards across
   * the whole chart, and with 60 of them the result was a wall of crossing red
   * lines that hid the bars. Those are counted instead and flagged on the row
   * itself, which is where somebody can act on them.
   *
   * With a row selected, only that row's links are drawn.
   */
  /**
   * Dependencies, drawn for the component you select rather than all at once.
   *
   * A forward arrow cannot be drawn for most of these. Every prerequisite in
   * this library is due to finish AFTER the work that needs it is meant to
   * start, so an arrow would run backwards across the whole chart. Hiding that
   * made the chart look tidy and say nothing.
   *
   * So selecting a row does three things: marks its prerequisites and the work
   * waiting on it, connects them, and draws the overlap in red where a
   * prerequisite finishes late. The red span is the finding, not a defect in
   * the drawing.
   */
  const rel = useMemo(() => {
    const empty = { needs: new Set<string>(), feeds: new Set<string>(), links: [] as Link[] };
    if (!sel) return empty;
    const idx = new Map(visible.map((c, i) => [c.id, i]));
    const me = visible.find(c => c.id === sel);
    if (!me) return empty;
    const trackW = Math.max(0, w - LBL);
    // Track coordinates. The overlay is offset to the track in CSS, so the
    // label column is not part of this scale.
    const x = (t: number) => (pct(t) / 100) * trackW;
    const yOf = (i: number) => i * ROW + ROW / 2;

    const needs = new Set(me.deps.filter(d => idx.has(d)));
    const feeds = new Set(visible.filter(c => c.deps.includes(me.id)).map(c => c.id));
    const links: Link[] = [];

    const add = (from: Component, to: Component) => {
      const i = idx.get(from.id)!, j = idx.get(to.id)!;
      const x1 = x(dayOf(from.due)), x2 = x(dayOf(to.start));
      const late = dayOf(from.due) > dayOf(to.start);
      links.push({
        key: from.id + ">" + to.id, late,
        // A line joining two bars that overlap in time has nowhere to go but
        // backwards, and a backwards line reads as a stray mark. The overlap
        // itself is the fact worth drawing: the stretch of the prerequisite
        // that happens after the work needing it was meant to begin. It sits
        // on the prerequisite's own row, under its own bar.
        d: late ? "" : `M${x1} ${yOf(i)} H${Math.max(x1 + 8, x2 - 12)} V${yOf(j)} H${x2}`,
        span: late ? { y: yOf(i), x1: x2, x2: x1 } : null,
      });
    };
    for (const d of needs) add(visible.find(c => c.id === d)!, me);
    for (const f of feeds) add(me, visible.find(c => c.id === f)!);
    return { needs, feeds, links: w < 520 ? [] : links };
  }, [sel, visible, w, from, to]);

  /** Shown on every row so dependencies are legible without selecting anything. */
  const counts = useMemo(() => {
    const inSet = new Set(rows.map(c => c.id));
    const m = new Map<string, { needs: number; feeds: number }>();
    for (const c of rows) m.set(c.id, { needs: c.deps.filter(d => inSet.has(d)).length, feeds: 0 });
    for (const c of rows) for (const d of c.deps) { const e = m.get(d); if (e) e.feeds++; }
    return m;
  }, [rows]);

  const selC = sel ? rows.find(c => c.id === sel) : null;
  const pan = (n: number) => setFrom(f => f + Math.round(span * n) * DAY);

  return (
    <div className="tl">
      <div className="tl-top">
        <div className="tl-nav">
          <button className="tl-btn" onClick={() => pan(-0.4)} aria-label="Earlier"><Icon name="chevronLeft" size={15} /></button>
          <button className="tl-btn tl-btn-w" onClick={() => setFrom(startOfDay(Date.now() - Math.round(span * 0.25) * DAY))}>Today</button>
          <button className="tl-btn" onClick={() => pan(0.4)} aria-label="Later"><Icon name="chevronRight" size={15} /></button>
        </div>
        <span className="tl-range">{fmtDate(new Date(from).toISOString().slice(0, 10))} to {fmtDate(new Date(to).toISOString().slice(0, 10))}</span>
        <div className="tl-nav">
          <button className="tl-btn" disabled={zoom === 0} onClick={() => setZoom(z => Math.max(0, z - 1))} aria-label="Zoom in">&minus;</button>
          <span className="tl-zoom">{span} days</span>
          <button className="tl-btn" disabled={zoom === ZOOMS.length - 1} onClick={() => setZoom(z => Math.min(ZOOMS.length - 1, z + 1))} aria-label="Zoom out">+</button>
        </div>
        {extent && (
          <button className="tl-btn tl-btn-w" onClick={() => {
            const need = extent.days + 8;
            const z = ZOOMS.findIndex(x => x >= need);
            setZoom(z === -1 ? ZOOMS.length - 1 : z);
            setFrom(startOfDay(extent.a - 4 * DAY));
          }}>Fit all dates</button>
        )}
        <span className="tl-hint">Select a row to see what it waits on</span>
      </div>

      {note}

      {rows.length === 0 ? (
        <p className="tl-none">No component in this filter carries both a start and a due date, so there is nothing to put on a timeline.</p>
      ) : (
        <div className="tl-chart" ref={wrap}>
          <div className="tl-axis" style={{ ["--lbl" as any]: LBL + "px" }}>
            <span className="tl-axis-lbl">Component</span>
            <div className="tl-axis-track">
              {months.map(m => <span key={m} className="tl-tick tl-tick-m" style={{ left: pct(m) + "%" }}>{new Date(m).toLocaleDateString("en-GB", { month: "short" })}</span>)}
              {weeks.map(m => <span key={m} className="tl-tick" style={{ left: pct(m) + "%" }}>{new Date(m).getDate()}</span>)}
              {todayPct >= 0 && todayPct <= 100 && <span className="tl-tick tl-tick-t" style={{ left: todayPct + "%" }}>today</span>}
            </div>
          </div>

          <div className="tl-rows" style={{ ["--lbl" as any]: LBL + "px", ["--row" as any]: ROW + "px" }}>
            <div className="tl-grid" aria-hidden>
              {months.map(m => <i key={m} className="tl-vline tl-vline-m" style={{ left: pct(m) + "%" }} />)}
              {weeks.map(m => <i key={m} className="tl-vline" style={{ left: pct(m) + "%" }} />)}
              {todayPct >= 0 && todayPct <= 100 && <i className="tl-today" style={{ left: todayPct + "%" }} />}
            </div>

            {rel.links.length > 0 && (
              <svg className="tl-arrows" width={w} height={visible.length * ROW} aria-hidden>
                <defs>
                  <marker id="tlh" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                    <path d="M0 1 L7 4 L0 7 z" fill="currentColor" />
                  </marker>
                </defs>
                {rel.links.map(l => (
                  <g key={l.key}>
                    {l.span && (
                      <rect className="tl-overlap" x={Math.min(l.span.x1, l.span.x2)} y={l.span.y - 9}
                        width={Math.abs(l.span.x2 - l.span.x1)} height={18} rx="3" />
                    )}
                    {l.d && <path className="tl-arrow" d={l.d} markerEnd="url(#tlh)" />}
                  </g>
                ))}
              </svg>
            )}

            {visible.map(c => {
              const r = risk(state, c).level;
              const cf = conflicts(state, c);
              const ov = overlaps(state, c);
              const tone = isDone(c) ? "done" : r === "blocked" ? "blk" : r === "at_risk" ? "risk" : "go";
              const l = Math.max(0, pct(dayOf(c.start)));
              const rt = Math.min(100, pct(dayOf(c.due)));
              const slip = c.eta && dayOf(c.eta) > dayOf(c.due) ? Math.min(100, pct(dayOf(c.eta))) : null;
                const n = counts.get(c.id) ?? { needs: 0, feeds: 0 };
                // A component can be on both sides of the selection at once. That is
                // not a display quirk, it is one of the loops the Dependencies page
                // counts, and it is worth saying so here rather than picking a side.
                const role = rel.needs.has(c.id)
                  ? (rel.feeds.has(c.id) ? "loop" : "needs")
                  : rel.feeds.has(c.id) ? "feeds" : null;
                const dim = !!sel && sel !== c.id && !role;
                return (
                <button key={c.id}
                  className={cx("tl-row", sel === c.id && "on", role && "rel-" + role, dim && "dim", chain?.has(c.id) && "chain")}
                  onClick={() => setSel(s => s === c.id ? null : c.id)}
                  aria-label={`${c.name}, ${fmtDate(c.start)} to ${fmtDate(c.due)}, needs ${n.needs}, ${n.feeds} waiting on it`}>
                  <span className="tl-row-lbl">
                    <Avatar p={person(c.ownerId)} size={18} />
                    <b>{c.name}</b>
                    {(cf.length > 0 || ov.length > 0) && (
                      <i className="tl-warn" title={[...cf.map(x => x.text), ...(ov.length ? [`${personName(person(c.ownerId))} has ${ov.length} other component${ov.length > 1 ? "s" : ""} booked over the same dates.`] : [])].join("\n")}>
                        <Icon name="alert" size={12} />
                      </i>
                    )}
                    {role && <em className={"tl-role " + role}>{role === "needs" ? "first" : role === "feeds" ? "after" : "loop"}</em>}
                    <span className="tl-deps" title={`Needs ${n.needs} finished first. ${n.feeds} waiting on it.`}>
                      {n.needs > 0 && <i className="d-needs">{n.needs}</i>}
                      {n.feeds > 0 && <i className="d-feeds">{n.feeds}</i>}
                    </span>
                  </span>
                  <span className="tl-row-track">
                    {slip !== null && <i className="tl-slip" style={{ left: rt + "%", width: Math.max(0.4, slip - rt) + "%" }} />}
                    <i className={cx("tl-bar", "b-" + tone)} style={{ left: l + "%", width: Math.max(0.8, rt - l) + "%" }} />
                  </span>
                </button>
              );
            })}
          </div>

          <div className="tl-legend">
            <span><i className="k b-go" />On track</span>
            <span><i className="k b-risk" />At risk</span>
            <span><i className="k b-blk" />Blocked</span>
            <span><i className="k b-done" />Completed</span>
            <span><i className="k k-slip" />ETA past the due date</span>
            <span><i className="k k-late" />Prerequisite still running after the work needing it was due to start</span>
            {hidden > 0 && <span className="tl-hidden">{hidden} bar{hidden === 1 ? "" : "s"} fall outside this window. Widen it or press Fit all dates.</span>}
          </div>
        </div>
      )}

      {selC && <TimelineDetail c={selC} onClose={() => setSel(null)} />}

      {unscheduled.length > 0 && (
        <section className="tl-un">
          <h3>{unscheduled.length} components carry no dates</h3>
          <p>
            Nobody has recorded a start or a due date for these, so they cannot be placed on a timeline.
            They are listed here by name instead of being put somewhere plausible.
          </p>
          <div className="tl-un-list">
            {unscheduled.slice(0, 24).map(c => (
              <a key={c.id} href={"#c-" + c.id} className="tl-un-i">
                <code className="cid">{c.id}</code>
                <b>{c.name}</b>
                <span>{c.lib?.wave || "No wave"}</span>
              </a>
            ))}
          </div>
          {unscheduled.length > 24 && <p className="tl-un-more">and {unscheduled.length - 24} more.</p>}
        </section>
      )}
    </div>
  );
}

function TimelineDetail({ c, onClose }: { c: Component; onClose: () => void }) {
  const { state, person } = useStore();
  const cf = conflicts(state, c);
  const ov = overlaps(state, c);
  const d = daysUntil(c.due);
  return (
    <div className="tl-det">
      <div className="tl-det-head">
        <code className="cid">{c.id}</code>
        <b>{c.name}</b>
        <button className="tl-det-x" onClick={onClose} aria-label="Close"><Icon name="x" size={14} /></button>
      </div>
      <dl className="tl-det-dl">
        <div><dt>Owner</dt><dd>{c.ownerId ? personName(person(c.ownerId)) : "Nobody"}</dd></div>
        <div><dt>Recorded start</dt><dd>{fmtDate(c.start)}</dd></div>
        <div><dt>Due</dt><dd>{fmtDate(c.due)}{!isDone(c) && d < 0 && <em> · {-d} days ago</em>}</dd></div>
        <div><dt>Current ETA</dt><dd>{c.eta ? fmtDate(c.eta) : "Not recorded"}</dd></div>
        <div><dt>Length</dt><dd>{spanDays(c)} days</dd></div>
      </dl>
      {(cf.length > 0 || ov.length > 0) ? (
        <ul className="tl-det-cf">
          {cf.map((x, i) => <li key={i}>{x.text}</li>)}
          {ov.length > 0 && <li>{personName(person(c.ownerId))} is booked on {ov.length} other component{ov.length > 1 ? "s" : ""} over the same dates: {ov.slice(0, 3).map(x => x.name).join(", ")}{ov.length > 3 ? ` and ${ov.length - 3} more` : ""}.</li>}
        </ul>
      ) : <p className="tl-det-ok">The dates on this record do not contradict each other or any prerequisite.</p>}
      <a className="btn btn-secondary btn-sm" href={"#c-" + c.id}>Open the component</a>
    </div>
  );
}
