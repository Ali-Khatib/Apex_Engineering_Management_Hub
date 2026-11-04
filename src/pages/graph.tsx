import React, { useMemo, useState } from "react";
import { useStore, useNav } from "../store";
import { Icon } from "../icons";
import { PageHeader, Empty, cx } from "../ui";
import { LayerOfTag, WaveTag } from "./lib";
import type { Component } from "../types";

/**
 * Build order.
 *
 * This replaced a pannable canvas of 127 boxes and 389 arrows. It was accurate
 * and unreadable, and it answered no question anyone actually asks.
 *
 * The honest reading of this library is that it has no clean build order: every
 * component names at least one prerequisite, and 55 groups of components depend on one
 * another in a loop. So the page says that, ranks the components the most other work
 * names as a prerequisite, and lists the loops that have to be broken — which is
 * a decision for a person, not something a diagram can resolve.
 */

type Loop = { ids: string[]; key: string };

function analyse(cs: Component[]) {
  const ids = new Set(cs.map(c => c.id));
  const deps = new Map(cs.map(c => [c.id, c.deps.filter(d => ids.has(d))]));

  const neededBy = new Map<string, string[]>();
  cs.forEach(c => deps.get(c.id)!.forEach(d => {
    const a = neededBy.get(d) || []; a.push(c.id); neededBy.set(d, a);
  }));

  // Shortest loop through each component, de-duplicated by its member set.
  const loops = new Map<string, Loop>();
  const colour = new Map<string, number>();
  const stack: string[] = [];
  const walk = (u: string) => {
    colour.set(u, 1); stack.push(u);
    for (const v of deps.get(u) || []) {
      if (!colour.has(v)) walk(v);
      else if (colour.get(v) === 1) {
        const ring = stack.slice(stack.indexOf(v));
        const key = [...ring].sort().join("|");
        const cur = loops.get(key);
        if (!cur || ring.length < cur.ids.length) loops.set(key, { ids: ring, key });
      }
    }
    colour.set(u, 2); stack.pop();
  };
  cs.forEach(c => { if (!colour.has(c.id)) walk(c.id); });

  return {
    deps, neededBy,
    loops: [...loops.values()].sort((a, b) => a.ids.length - b.ids.length || a.ids[0].localeCompare(b.ids[0])),
    noPrereq: cs.filter(c => deps.get(c.id)!.length === 0),
  };
}

export function Graph() {
  const { state, component } = useStore();
  const { openComponents } = useNav();
  const cs = state.components;
  const [open, setOpen] = useState<string | null>(null);
  const [showLoops, setShowLoops] = useState(6);

  const { deps, neededBy, loops, noPrereq } = useMemo(() => analyse(cs), [cs]);

  const foundations = useMemo(() => cs
    .map(c => ({ c, n: (neededBy.get(c.id) || []).length }))
    .filter(x => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 12), [cs, neededBy]);

  const prerequisites = [...neededBy.keys()].length;
  const maxNeeded = foundations.length ? foundations[0].n : 1;
  const inLoop = new Set(loops.flatMap(l => l.ids));

  const sel = open ? component(open) : null;
  const selNeeds = sel ? (deps.get(sel.id) || []).map(d => component(d)).filter(Boolean) as Component[] : [];
  const selFeeds = sel ? (neededBy.get(sel.id) || []).map(d => component(d)).filter(Boolean) as Component[] : [];

  return (
    <>
      <PageHeader
        title="Build order"
        sub={`Every one of the ${cs.length} components names at least one other component it needs first, and ${loops.length} groups of them need each other in a loop. There is no single order to build them in until somebody decides which of those loops to break.`} />

      <div className="kpis-3" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <button className="kpi" onClick={() => openComponents({})}>
          <span className="kpi-label">Components with nothing to wait for</span>
          <span className="kpi-value num">{noPrereq.length}</span>
          <span className="kpi-foot">every component names a prerequisite</span>
        </button>
        <button className="kpi" onClick={() => foundations[0] && setOpen(foundations[0].c.id)}>
          <span className="kpi-label">Named as a prerequisite</span>
          <span className="kpi-value num">{prerequisites}</span>
          <span className="kpi-foot">of {cs.length} components, by at least one other</span>
        </button>
        <button className={cx("kpi", loops.length && "kpi-alert")} onClick={() => setShowLoops(loops.length)}>
          <span className="kpi-label">Loops to break</span>
          <span className="kpi-value num">{loops.length}</span>
          <span className="kpi-foot">{inLoop.size} components are caught in one</span>
        </button>
      </div>

      <div className="split" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <section className="card">
          <div className="card-head">
            <h2>Build these first</h2>
            <span>How many components name each one</span>
          </div>
          <p className="rd-note" style={{ margin: "0 18px 6px" }}>
            Whatever is decided about the loops, the work that the most other components are waiting on
            is worth finishing early.
          </p>
          <div className="hbars">
            {foundations.map(({ c, n }, i) => (
              <button key={c.id} className="hbar" onClick={() => setOpen(c.id)}>
                <span className="hbar-label">{c.name}</span>
                <span className="hbar-track"><i className={cx(i === 0 && "lead")} style={{ width: `${n / maxNeeded * 100}%` }} /></span>
                <span className="hbar-v num">{n}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Loops to break</h2>
            <span>Shortest first</span>
          </div>
          <p className="rd-note" style={{ margin: "0 18px 6px" }}>
            These components each need the other, so neither can be finished first. Somebody has to decide
            which dependency to drop or split.
          </p>
          <div className="list">
            {loops.length === 0 && <Empty icon="check" title="No circular dependencies" />}
            {loops.slice(0, showLoops).map(l => (
              <button key={l.key} className="li3 li3-plain" onClick={() => setOpen(l.ids[0])}>
                <span className="li3-main">
                  <b>{l.ids.map(id => component(id)?.name || id).join(l.ids.length === 2 ? " and " : " → ")}</b>
                  <small>{l.ids.length === 2 ? "each needs the other" : `a ring of ${l.ids.length}`} · {l.ids.join(" → ")} → {l.ids[0]}</small>
                </span>
                <Icon name="arrowRight" size={14} />
              </button>
            ))}
          </div>
          {showLoops < loops.length && (
            <div style={{ padding: "4px 18px 16px" }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowLoops(s => s + 12)}>
                Show more loops
              </button>
            </div>
          )}
        </section>
      </div>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <h2>Check one component</h2>
          <span>What it needs, and what is waiting on it</span>
        </div>
        <div className="list">
          {cs.slice(0, 8).map(c => (
            <button key={c.id} className="li3" onClick={() => setOpen(c.id)} style={{ width: "100%", textAlign: "left" }}>
              <code className="cid">{c.id}</code>
              <span className="li3-main">
                <b>{c.name}</b>
                <small>needs {(deps.get(c.id) || []).length} · {(neededBy.get(c.id) || []).length} waiting on it{inLoop.has(c.id) ? " · in a loop" : ""}</small>
              </span>
              <LayerOfTag c={c} short />
              <WaveTag wave={c.lib?.wave} />
            </button>
          ))}
        </div>
        <div style={{ padding: "4px 18px 16px" }}>
          <button className="btn btn-secondary btn-sm" onClick={() => openComponents({})}>
            Search all {cs.length} components
          </button>
        </div>
      </section>

      {sel && (
        <div className="overlay" onClick={() => setOpen(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <div className="modal-head">
              <div>
                <code className="cid">{sel.id}</code>
                <h3 style={{ fontSize: 17, fontWeight: 600, marginTop: 2 }}>{sel.name}</h3>
              </div>
              <button className="modal-x" onClick={() => setOpen(null)} aria-label="Close"><Icon name="x" size={16} /></button>
            </div>
            <div className="modal-body" style={{ display: "grid", gap: 18 }}>
              <p className="md" style={{ margin: 0 }}>{sel.summary}</p>
              <div>
                <h4 className="modal-sub">Needs these finished first ({selNeeds.length})</h4>
                {selNeeds.length === 0
                  ? <p className="rd-note" style={{ margin: 0 }}>Nothing. This one can be started today.</p>
                  : <div className="list" style={{ padding: 0 }}>
                    {selNeeds.map(d => (
                      <a key={d.id} href={"#c-" + d.id} className="li3" onClick={() => setOpen(null)}>
                        <code className="cid">{d.id}</code>
                        <span className="li3-main"><b>{d.name}</b></span>
                        <WaveTag wave={d.lib?.wave} />
                      </a>
                    ))}
                  </div>}
              </div>
              <div>
                <h4 className="modal-sub">Waiting on this one ({selFeeds.length})</h4>
                {selFeeds.length === 0
                  ? <p className="rd-note" style={{ margin: 0 }}>Nothing is waiting on this one.</p>
                  : <div className="list" style={{ padding: 0 }}>
                    {selFeeds.slice(0, 6).map(d => (
                      <a key={d.id} href={"#c-" + d.id} className="li3" onClick={() => setOpen(null)}>
                        <code className="cid">{d.id}</code>
                        <span className="li3-main"><b>{d.name}</b></span>
                        <WaveTag wave={d.lib?.wave} />
                      </a>
                    ))}
                    {selFeeds.length > 6 && <p className="rd-note" style={{ margin: "8px 0 0" }}>and {selFeeds.length - 6} more.</p>}
                  </div>}
              </div>
            </div>
            <div className="modal-foot">
              <a className="btn btn-primary btn-md" href={"#c-" + sel.id} onClick={() => setOpen(null)}>Open this component</a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
