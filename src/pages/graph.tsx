import React, { useMemo, useState } from "react";
import { useStore, useNav } from "../store";
import { Icon } from "../icons";
import { PageHeader, Empty, cx } from "../ui";
import { LayerOfTag, WaveTag } from "./lib";
import { CycleCard } from "./cycles";
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
  const [showLoops, setShowLoops] = useState(8);
  const [showFoundations, setShowFoundations] = useState(false);

  const { deps, neededBy, loops, noPrereq } = useMemo(() => analyse(cs), [cs]);

  const foundations = useMemo(() => cs
    .map(c => ({ c, n: (neededBy.get(c.id) || []).length }))
    .filter(x => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 12), [cs, neededBy]);

  const prerequisites = [...neededBy.keys()].length;
  const maxNeeded = foundations.length ? foundations[0].n : 1;
  const inLoop = new Set(loops.flatMap(l => l.ids));

  const decided = loops.filter(l => ["decided", "deferred"].includes(state.cycleDecisions?.[l.key]?.status || "")).length;
  const sel = open ? component(open) : null;
  const selNeeds = sel ? (deps.get(sel.id) || []).map(d => component(d)).filter(Boolean) as Component[] : [];
  const selFeeds = sel ? (neededBy.get(sel.id) || []).map(d => component(d)).filter(Boolean) as Component[] : [];

  return (
    <>
      <PageHeader
        title="Dependency resolution"
        sub={`${loops.length} groups of components need each other in a loop, so neither end can be finished first. Each one needs a person to decide how to break it. Nothing here changes a dependency on its own.`} />

      {/* The statistics are context for the decisions, not the point of the
          page, so they are one sentence rather than three metric cards. */}
      <p className="dr-context">
        Every one of the {cs.length} components names at least one prerequisite, and {inLoop.size} are caught in a loop.
        Until the loops are decided there is no valid build order for the library as a whole.
        <button onClick={() => setShowFoundations(v => !v)}>{showFoundations ? "Hide" : "Show"} what the most work depends on</button>
      </p>

      {showFoundations && (
        <section className="dr-found">
          <h2>Most depended on</h2>
          <p>Whatever is decided about the loops, finishing these early unblocks the most other work.</p>
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
      )}

      <div className="dr-head">
        <h2>Decisions needed</h2>
        <span>{decided} of {loops.length} decided · shortest loops first, they are usually the easiest to resolve</span>
      </div>

      <div className="cyclist dr-list">
        {loops.length === 0 && <Empty icon="check" title="No circular dependencies" />}
        {loops.slice(0, showLoops).map(l => <CycleCard key={l.key} loop={l} />)}
      </div>
      {showLoops < loops.length && (
        <div style={{ padding: "14px 0 0" }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowLoops(s => s + 12)}>
            Show more ({loops.length - showLoops} left)
          </button>
        </div>
      )}

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
