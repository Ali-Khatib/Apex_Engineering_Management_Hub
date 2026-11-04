import React, { useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { Icon } from "../icons";
import { cx } from "../ui";
import { isDone, personName } from "../logic";
import type { DepModel } from "../depmath";
import type { Component } from "../types";

/**
 * One component at a time, with what it needs on the left and what is waiting
 * on it on the right. 127 components and 389 edges drawn at once is accurate
 * and unreadable, so the graph starts focused and you walk it by clicking.
 *
 * Edges that close a loop are drawn in red and labelled, because that is the
 * one thing on this page that needs a decision rather than a schedule.
 */

const NW = 184, NH = 46, GAP = 12, COLW = 252;
const CAP = 9;

export function DepGraph({ model, focus, onFocus }: {
  model: DepModel; focus: string; onFocus: (id: string) => void;
}) {
  const { state, person, component } = useStore();
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const c = component(focus);

  // Being in some loop somewhere is not the same as being in a loop with the
  // component on screen. Only the second is worth marking here, and it keeps
  // the red for the handful of nodes that genuinely cannot be sequenced
  // against this one.
  const sharesLoop = useMemo(() => {
    const s = new Set<string>();
    if (!c) return s;
    for (const l of model.loops) if (l.ids.includes(c.id)) l.ids.forEach(id => { if (id !== c.id) s.add(id); });
    return s;
  }, [model.loops, c]);

  const geo = useMemo(() => {
    if (!c) return null;
    const get = (id: string) => component(id);
    const needs = (model.deps.get(c.id) || []).map(get).filter(Boolean) as Component[];
    const feeds = (model.neededBy.get(c.id) || []).map(get).filter(Boolean) as Component[];
    const nShown = needs.slice(0, CAP), fShown = feeds.slice(0, CAP);
    const rows = Math.max(nShown.length + (needs.length > CAP ? 1 : 0), fShown.length + (feeds.length > CAP ? 1 : 0), 1);
    const H = rows * (NH + GAP) - GAP;
    const col = (items: Component[], x: number, extra: number) => {
      const n = items.length + (extra ? 1 : 0);
      const top = (H - (n * (NH + GAP) - GAP)) / 2;
      return items.map((it, i) => ({ c: it, x, y: top + i * (NH + GAP) }))
        .concat(extra ? [{ c: null as any, x, y: top + items.length * (NH + GAP) }] : []);
    };
    return {
      H, needs, feeds,
      left: col(nShown, 0, needs.length > CAP ? needs.length - CAP : 0),
      right: col(fShown, COLW * 2, feeds.length > CAP ? feeds.length - CAP : 0),
      mid: { x: COLW, y: (H - NH) / 2 },
      W: COLW * 2 + NW,
    };
  }, [c, model, component]);

  if (!c || !geo) return <p className="dg-none">Pick a component to see its dependencies.</p>;

  const vw = geo.W / zoom, vh = geo.H / zoom;
  const vb = `${-24 + pan.x} ${-24 + pan.y} ${vw + 48} ${vh + 48}`;

  const down = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const k = vw / (e.currentTarget as HTMLElement).clientWidth;
    setPan({ x: d.px - (e.clientX - d.x) * k, y: d.py - (e.clientY - d.y) * k });
  };
  const up = () => { drag.current = null; };

  const edge = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const x1 = from.x + NW, y1 = from.y + NH / 2, x2 = to.x, y2 = to.y + NH / 2;
    const m = (x1 + x2) / 2;
    return `M${x1} ${y1} C${m} ${y1} ${m} ${y2} ${x2} ${y2}`;
  };

  const Node = ({ n, role }: { n: { c: Component | null; x: number; y: number }; role: "need" | "feed" }) => {
    if (!n.c) {
      const extra = role === "need" ? geo.needs.length - CAP : geo.feeds.length - CAP;
      return (
        <g transform={`translate(${n.x} ${n.y})`}>
          <rect className="dg-n dg-more" width={NW} height={NH} rx="9" />
          <text className="dg-n-name" x={NW / 2} y={NH / 2 + 4} textAnchor="middle">and {extra} more</text>
        </g>
      );
    }
    const d = n.c;
    const loop = sharesLoop.has(d.id);
    return (
      <g transform={`translate(${n.x} ${n.y})`} className="dg-g" onClick={() => onFocus(d.id)} role="button" tabIndex={0}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onFocus(d.id); } }}>
        <title>{d.name} — {isDone(d) ? "completed" : d.ownerId ? `owned by ${personName(person(d.ownerId))}` : "no owner"}</title>
        <rect className={cx("dg-n", isDone(d) && "done", !d.ownerId && !isDone(d) && "noown", loop && "loop")} width={NW} height={NH} rx="9" />
        <text className="dg-n-id" x="11" y="18">{d.id}</text>
        <text className="dg-n-name" x="11" y="33">{d.name.length > 26 ? d.name.slice(0, 25) + "…" : d.name}</text>
        {isDone(d) && <text className="dg-n-tick" x={NW - 12} y="19" textAnchor="end">done</text>}
        {loop && !isDone(d) && <text className="dg-n-loop" x={NW - 12} y="19" textAnchor="end">loop</text>}
      </g>
    );
  };

  return (
    <div className="dg">
      <div className="dg-bar">
        <span className="dg-title">
          <b>{c.name}</b> needs {geo.needs.length} component{geo.needs.length === 1 ? "" : "s"} finished first,
          and {geo.feeds.length} {geo.feeds.length === 1 ? "is" : "are"} waiting on it.
        </span>
        <div className="dg-nav">
          <button className="tl-btn" onClick={() => setZoom(z => Math.min(2.4, z * 1.25))} aria-label="Zoom in">+</button>
          <button className="tl-btn" onClick={() => setZoom(z => Math.max(0.6, z / 1.25))} aria-label="Zoom out">&minus;</button>
          <button className="tl-btn tl-btn-w" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>Reset</button>
        </div>
      </div>

      <div className="dg-canvas" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}>
        <svg viewBox={vb} width="100%" height={Math.min(560, Math.max(260, geo.H + 48))} role="img"
          aria-label={`Dependencies of ${c.name}`}>
          <defs>
            <marker id="dga" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0 1 L7 4 L0 7 z" fill="currentColor" />
            </marker>
          </defs>

          {geo.left.map((n, i) => n.c && (
            <path key={"l" + i} className={cx("dg-e", model.loopEdges.has(`${c.id}>${n.c.id}`) && "loop", isDone(n.c) && "ok")}
              d={edge(n, geo.mid)} markerEnd="url(#dga)" />
          ))}
          {geo.right.map((n, i) => n.c && (
            <path key={"r" + i} className={cx("dg-e", model.loopEdges.has(`${n.c.id}>${c.id}`) && "loop")}
              d={edge(geo.mid, n)} markerEnd="url(#dga)" />
          ))}

          {geo.left.map((n, i) => <Node key={"nl" + i} n={n} role="need" />)}
          {geo.right.map((n, i) => <Node key={"nr" + i} n={n} role="feed" />)}

          <g transform={`translate(${geo.mid.x} ${geo.mid.y})`}>
            <rect className="dg-n dg-focus" width={NW} height={NH} rx="9" />
            <text className="dg-n-id focus" x="11" y="18">{c.id}</text>
            <text className="dg-n-name focus" x="11" y="33">{c.name.length > 26 ? c.name.slice(0, 25) + "…" : c.name}</text>
          </g>

          {geo.left.length > 0 && <text className="dg-colh" x={NW / 2} y={-10} textAnchor="middle">Must finish first</text>}
          <text className="dg-colh" x={geo.mid.x + NW / 2} y={-10} textAnchor="middle">Selected</text>
          {geo.right.length > 0 && <text className="dg-colh" x={COLW * 2 + NW / 2} y={-10} textAnchor="middle">Waiting on it</text>}
        </svg>
      </div>

      <div className="dg-legend">
        <span><i className="k dg-k-ok" />Prerequisite already finished</span>
        <span><i className="k dg-k-loop" />Edge that closes a loop</span>
        <span><i className="k dg-k-noown" />No owner</span>
        <span className="dg-hint">Click any box to walk to it. Drag the canvas to pan.</span>
      </div>
    </div>
  );
}
