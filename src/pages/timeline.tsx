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
const LBL = 224;   // label column, px. Fixed so the arrow overlay can do maths.
const ROW = 34;

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
  const { edges, lateCount } = useMemo(() => {
    const idx = new Map(visible.map((c, i) => [c.id, i]));
    const trackW = Math.max(0, w - LBL);
    const x = (t: number) => LBL + (pct(t) / 100) * trackW;
    const out: { d: string; key: string }[] = [];
    let late = 0;
    for (const c of visible) for (const dep of c.deps) {
      const i = idx.get(dep), j = idx.get(c.id);
      if (i === undefined || j === undefined) continue;
      const p = visible[i];
      if (dayOf(p.due) > dayOf(c.start)) { late++; continue; }
      if (!arrows || w < 520) continue;
      if (sel && sel !== c.id && sel !== p.id) continue;
      const x1 = x(dayOf(p.due)), y1 = i * ROW + ROW / 2;
      const x2 = x(dayOf(c.start)), y2 = j * ROW + ROW / 2;
      const mid = Math.max(x1 + 8, x2 - 12);
      out.push({ key: dep + ">" + c.id, d: `M${x1} ${y1} H${mid} V${y2} H${x2}` });
    }
    return { edges: out, lateCount: late };
  }, [arrows, visible, w, from, to, sel]);

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
        <label className="tl-toggle">
          <input type="checkbox" checked={arrows} onChange={e => setArrows(e.target.checked)} />
          Show dependency links
        </label>
      </div>

      {arrows && (
        <p className="tl-note">
          <Icon name="info" size={14} />
          <span>
            {edges.length === 0 && lateCount > 0 ? (
              <>
                <b>Not one of the {lateCount} prerequisites between these bars finishes before the work that needs it starts.</b> Every
                link would run backwards across the chart, so they are flagged on the rows instead of drawn. On the dates as recorded,
                no component here can begin when it is meant to.
              </>
            ) : (
              <>
                {edges.length} link{edges.length === 1 ? "" : "s"} drawn{sel ? " for the selected row" : ""}: a prerequisite that finishes
                before the work needing it starts.
                {lateCount > 0 && <> The other {lateCount} run backwards, because the prerequisite is not due until after that start.
                  Those are flagged on the row rather than drawn, since the lines would cross everything.</>}
                {!sel && " Select a row to see only its own links."}
              </>
            )}
          </span>
        </p>
      )}

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

            {edges.length > 0 && (
              <svg className="tl-arrows" width={w} height={visible.length * ROW} aria-hidden>
                <defs>
                  <marker id="tlh" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                    <path d="M0 1 L7 4 L0 7 z" fill="currentColor" />
                  </marker>
                </defs>
                {edges.map(e => <path key={e.key} className="tl-arrow" d={e.d} markerEnd="url(#tlh)" />)}
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
              return (
                <button key={c.id} className={cx("tl-row", sel === c.id && "on", chain?.has(c.id) && "chain")} onClick={() => setSel(s => s === c.id ? null : c.id)} aria-label={`${c.name}, ${fmtDate(c.start)} to ${fmtDate(c.due)}`}>
                  <span className="tl-row-lbl">
                    <Avatar p={person(c.ownerId)} size={18} />
                    <b>{c.name}</b>
                    {(cf.length > 0 || ov.length > 0) && (
                      <i className="tl-warn" title={[...cf.map(x => x.text), ...(ov.length ? [`${personName(person(c.ownerId))} has ${ov.length} other component${ov.length > 1 ? "s" : ""} booked over the same dates.`] : [])].join("\n")}>
                        <Icon name="alert" size={12} />
                      </i>
                    )}
                  </span>
                  <span className="tl-row-track">
                    {slip !== null && <i className="tl-slip" style={{ left: rt + "%", width: Math.max(0.4, slip - rt) + "%" }} />}
                    <i className={cx("tl-bar", "b-" + tone)} style={{ left: l + "%", width: Math.max(0.8, rt - l) + "%" }}>
                      <em>{spanDays(c)}d</em>
                    </i>
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
