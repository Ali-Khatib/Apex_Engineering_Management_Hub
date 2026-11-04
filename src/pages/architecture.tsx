import React, { useMemo, useState } from "react";
import { useStore, useNav } from "../store";
import { Icon } from "../icons";
import { Empty, cx, StatusPill, PersonChip } from "../ui";
import { LAYERS, LAYER_ORDER } from "../seed";
import { isDone, openBlockers, personName } from "../logic";
import type { Component } from "../types";

/**
 * Platform architecture explorer.
 *
 * A single graph of 127 components and 389 edges is accurate and useless, so
 * this starts at the level people can actually hold: the 20 platform modules,
 * sized by how much of the library builds on each. Selecting one opens what
 * it carries. Selecting a component opens its own map on its page.
 *
 * Every edge comes from lib.sps or deps. Where a relationship is not recorded,
 * the page says so instead of drawing something plausible.
 */
export function Architecture() {
  const { state, person } = useStore();
  const { go } = useNav();
  const [q, setQ] = useState("");
  const [layer, setLayer] = useState("");
  const [sel, setSel] = useState<string | null>(null);

  const cs = state.components;

  const modules = useMemo(() => state.modules.map(m => {
    const users = cs.filter(c => c.lib?.sps.includes(m.id));
    const layers = [...new Set(users.map(c => c.lib?.layer).filter(Boolean))] as string[];
    return { m, users, layers, n: users.length };
  }).sort((a, b) => b.n - a.n), [state.modules, cs]);

  const visible = useMemo(() => modules.filter(({ m, users, layers }) => {
    const s = q.trim().toLowerCase();
    if (layer && !layers.includes(layer)) return false;
    if (!s) return true;
    return m.id.toLowerCase().includes(s) || m.name.toLowerCase().includes(s)
      || m.description.toLowerCase().includes(s)
      || users.some(c => c.name.toLowerCase().includes(s) || c.id.toLowerCase().includes(s));
  }), [modules, q, layer]);

  const selected = sel ? modules.find(x => x.m.id === sel) : null;
  const maxN = modules[0]?.n || 1;

  // Modules that share components, which is the only module-to-module
  // relationship the data actually supports.
  const siblings = useMemo(() => {
    if (!selected) return [];
    const ids = new Set(selected.users.map(c => c.id));
    return modules
      .filter(x => x.m.id !== selected.m.id)
      .map(x => ({ ...x, shared: x.users.filter(c => ids.has(c.id)).length }))
      .filter(x => x.shared > 0)
      .sort((a, b) => b.shared - a.shared)
      .slice(0, 6);
  }, [selected, modules]);

  const unmapped = cs.filter(c => !c.lib?.sps.length).length;

  return (
    <>
      <header className="ph">
        <h1>Architecture</h1>
        <p className="lede">The 20 platform modules, sized by how much of the component library builds on each. Select one to see what it carries and which other modules it shares work with. Every line here comes from a recorded relationship.</p>
      </header>

      <div className="filters" style={{ marginBottom: 16 }}>
        <div className="input-ic" style={{ flex: "1 1 260px" }}>
          <Icon name="search" size={15} />
          <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Search modules and the components that use them" aria-label="Search architecture" />
        </div>
        <select value={layer} onChange={e => setLayer(e.target.value)} aria-label="Platform layer">
          <option value="">Any platform layer</option>
          {LAYER_ORDER.map(k => <option key={k} value={k}>{LAYERS[k].name}</option>)}
        </select>
        {(q || layer || sel) && <button className="axis-clear" onClick={() => { setQ(""); setLayer(""); setSel(null); }}>Clear</button>}
      </div>

      <div className="split" style={{ gridTemplateColumns: "minmax(0, 1.35fr) minmax(0, 1fr)" }}>
        <section className="spec">
          <header className="spec-head">
            <h2>Platform modules</h2>
            <span>{visible.length} of {modules.length} shown · bar is how many components build on it</span>
          </header>
          <div className="archlist">
            {visible.length === 0 && <div style={{ padding: 20 }}><Empty icon="layers" title="No module matches" /></div>}
            {visible.map(({ m, n, layers }) => (
              <button key={m.id} className={cx("archrow", sel === m.id && "on")} onClick={() => setSel(sel === m.id ? null : m.id)} aria-pressed={sel === m.id}>
                <code className="cid">{m.id}</code>
                <span className="archrow-main">
                  <b>{m.name}</b>
                  <small>{m.description}</small>
                </span>
                <span className="archrow-bar" aria-hidden><i style={{ width: `${(n / maxN) * 100}%` }} /></span>
                <span className="archrow-n">{n}</span>
              </button>
            ))}
          </div>
          {unmapped > 0 && (
            <p className="arch-gap">
              <Icon name="alert" size={13} />
              <span>{unmapped} components name no platform module. They either extend nothing, or the mapping was never recorded. The component map does not distinguish between the two.</span>
            </p>
          )}
        </section>

        <section className="spec">
          <header className="spec-head">
            <h2>{selected ? `${selected.m.id} in detail` : "Select a module"}</h2>
            <span>{selected ? `${selected.n} components build on it` : "Nothing selected"}</span>
          </header>
          <div className="spec-body">
            {!selected ? (
              <p className="muted" style={{ fontSize: 13, lineHeight: 1.6 }}>
                Pick a module on the left to see the components that build on it, the layers it reaches, and the other modules it shares work with.
              </p>
            ) : (
              <>
                <p style={{ margin: "0 0 16px", fontSize: 14, lineHeight: 1.6, color: "var(--fg-2)" }}>{selected.m.description}</p>

                <h3 className="arch-h">Layers it reaches</h3>
                <div className="row" style={{ gap: 6, marginBottom: 18, flexWrap: "wrap" }}>
                  {selected.layers.length
                    ? selected.layers.map(k => <span key={k} className="lchip" style={{ pointerEvents: "none" }}>{LAYERS[k].name}</span>)
                    : <span className="missing"><Icon name="alert" size={12} />No component maps to it yet</span>}
                </div>

                <h3 className="arch-h">Shares components with</h3>
                {siblings.length ? (
                  <ul className="archsib">
                    {siblings.map(x => (
                      <li key={x.m.id}><button onClick={() => setSel(x.m.id)}><code className="cid">{x.m.id}</code><span>{x.m.name}</span><em>{x.shared} shared</em></button></li>
                    ))}
                  </ul>
                ) : <p className="missing" style={{ marginBottom: 18 }}><Icon name="alert" size={12} />No other module shares a component with this one.</p>}

                <h3 className="arch-h" style={{ marginTop: 18 }}>Components that build on it</h3>
                <div className="archcomps">
                  {selected.users.slice(0, 14).map(c => (
                    <a key={c.id} href={"#c-" + c.id} className={cx("archcomp", isDone(c) && "done", openBlockers(state, c.id).length && "blocked")}>
                      <code className="cid">{c.id}</code>
                      <span>{c.name}</span>
                      <StatusPill s={c.status} />
                    </a>
                  ))}
                </div>
                {selected.users.length > 14 && (
                  <button className="spec-link" onClick={() => go("m-" + selected.m.id)}>See all {selected.users.length} on the module page <Icon name="arrowRight" size={13} /></button>
                )}
                {selected.users.length <= 14 && (
                  <button className="spec-link" onClick={() => go("m-" + selected.m.id)}>Open the module page <Icon name="arrowRight" size={13} /></button>
                )}
              </>
            )}
          </div>
        </section>
      </div>

      <p className="kn-foot">
        <Icon name="alert" size={14} />
        <span>What this cannot show: module interfaces, APIs, data flows, external services and infrastructure. None of those are recorded against a module, and drawing them would mean inventing Apex's architecture. Each module page lists exactly which fields are missing.</span>
      </p>
    </>
  );
}
