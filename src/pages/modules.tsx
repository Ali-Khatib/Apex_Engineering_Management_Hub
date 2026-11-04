import React from "react";
import { useStore, useNav } from "../store";
import type { Component } from "../types";
import { Icon } from "../icons";
import { Empty, PersonChip, StatusPill, cx } from "../ui";
import { LAYERS, LAYER_ORDER, WAVES } from "../seed";
import { LayerOfTag, WaveTag, BarChart } from "./lib";

export function Modules() {
  const { state } = useStore();
  return (
    <>
      <header className="ph">
        <h1>Platform modules</h1>
        <p className="lede">The 20 shared building blocks Apex has already built, SP-01 to SP-20. Before building something new, check whether one of these already does it.</p>
      </header>
      <div className="mgrid">
        {state.modules.map(m => {
          const cs = state.components.filter(c => c.lib?.sps.includes(m.id));
          const layers = LAYER_ORDER.filter(k => cs.some(c => c.lib?.layer === k));
          return (
            <a key={m.id} href={"#m-" + m.id} className="mcard">
              <span className="mcard-id">{m.id}</span>
              <b>{m.name}</b>
              <p>{m.description}</p>
              <span className="mcard-foot">
                <span><strong>{cs.length}</strong> component{cs.length === 1 ? "" : "s"} build on it</span>
                <span className="mcard-layers">{layers.length} layer{layers.length === 1 ? "" : "s"}</span>
              </span>
            </a>
          );
        })}
      </div>
      <p className="note">One-line summaries are written from each module's name. Each module's full documentation is in its Google Drive folder.</p>
    </>
  );
}

export function ModulePage({ id }: { id: string }) {
  const { state } = useStore();
  const { openComponents } = useNav();
  const m = state.modules.find(x => x.id === id);
  if (!m) return <Empty icon="layers" title="Module not found" action={<a className="btn btn-secondary btn-md" href="#modules">All modules</a>} />;
  const cs = state.components.filter(c => c.lib?.sps.includes(m.id));
  const rows = LAYER_ORDER.map(k => ({ key: k, label: LAYERS[k].name, value: cs.filter(c => c.lib?.layer === k).length })).filter(r => r.value).sort((a, b) => b.value - a.value);
  return (
    <>
      <header className="ph ph-module">
        <span className="mcard-id big">{m.id}</span>
        <h1>{m.name}</h1>
        <p className="lede">{m.description}</p>
        <div className="row" style={{ marginTop: 16 }}>
          <a className="btn btn-primary btn-md" href={m.url} target="_blank" rel="noopener"><Icon name="drive" />Open module folder</a>
          <button className="btn btn-secondary btn-md" onClick={() => openComponents({ sp: m.id })}><Icon name="components" />See the components that build on it</button>
        </div>
      </header>
      <div className="stats">
        <div><b>{cs.length}</b><small>components build on it</small></div>
        <div><b>{cs.filter(c => ["Now", "P0"].includes(c.lib?.wave || "")).length}</b><small>selected now</small></div>
        <div><b>{cs.filter(c => c.ownerId).length}</b><small>with an owner</small></div>
        <div><b>{rows.length}</b><small>platform layers</small></div>
      </div>
      <ModuleDocs m={m} cs={cs} />

      {cs.length === 0 ? <Empty icon="components" title="No components map to this module yet" /> : (
        <div className="two two-wide">
          <section className="card">
            <div className="card-head"><h2>Components that build on {m.id}</h2><span>{cs.length} total, grouped by roadmap</span></div>
            {WAVES.map(w => {
              const list = cs.filter(c => c.lib?.wave === w.id);
              if (!list.length) return null;
              return (
                <div key={w.id} className="wavegroup">
                  <div className="wavegroup-head"><WaveTag wave={w.id} /><span>{w.hint}</span><span className="muted">{list.length}</span></div>
                  <div className="list">{list.map(c => (
                    <a key={c.id} href={"#c-" + c.id} className="li3">
                      <code className="cid">{c.id}</code>
                      <span className="li3-main"><b>{c.name}</b><small>{c.summary}</small></span>
                      <LayerOfTag c={c} short />
                      <PersonChip id={c.ownerId} size={20} />
                    </a>
                  ))}</div>
                </div>
              );
            })}
          </section>
          <section className="card">
            <div className="card-head"><h2>By platform layer</h2></div>
            <BarChart rows={rows} onPick={k => openComponents({ sp: m.id, category: LAYERS[k].name })} />
          </section>
        </div>
      )}
    </>
  );
}


/**
 * §11 asks a module to document its responsibilities, capabilities, inputs,
 * outputs, interfaces, dependencies, repository, owner and integration steps.
 * The module record holds an id, a name, a one-line description and a folder
 * link, and nothing else. Rather than invent the rest, this states exactly
 * which fields exist and which still need writing, and shows what can be
 * derived honestly from the components that build on the module.
 */
function ModuleDocs({ m, cs }: { m: { id: string; name: string; description: string; url: string }; cs: Component[] }) {
  // Derived, not declared: the field names components exchange when they build
  // on this module. Useful as evidence, not a substitute for a real contract.
  const inputs = [...new Set(cs.flatMap(c => c.lib?.inputs || []))].slice(0, 12);
  const outputs = [...new Set(cs.flatMap(c => c.lib?.outputs || []))].slice(0, 12);

  const FIELDS: { label: string; have: boolean; note: string }[] = [
    { label: "Purpose", have: !!m.description, note: m.description ? "One line, from the module register." : "Not written." },
    { label: "Module folder", have: !!m.url, note: m.url ? "Linked." : "No link recorded." },
    { label: "Responsibilities", have: false, note: "What this module is and is not accountable for." },
    { label: "Capabilities", have: false, note: "What a consumer can actually ask it to do." },
    { label: "Interfaces and APIs", have: false, note: "Endpoints, message shapes, versioning policy." },
    { label: "Declared inputs and outputs", have: false, note: "The module's own contract, as opposed to what consumers happen to pass." },
    { label: "Module dependencies", have: false, note: "Which other SP modules this one needs." },
    { label: "Repository", have: false, note: "No repository is linked to a module record." },
    { label: "Integration instructions", have: false, note: "How to adopt it in a new component." },
    { label: "Owner", have: false, note: "No owner field exists on a module record." },
  ];
  const missing = FIELDS.filter(f => !f.have).length;

  return (
    <section className="spec" style={{ margin: "0 0 18px" }}>
      <header className="spec-head">
        <h2>Documentation</h2>
        <span>{missing} of {FIELDS.length} fields still need writing. Nothing here is generated.</span>
      </header>
      <div className="spec-body">
        <ul className="docf">
          {FIELDS.map(f => (
            <li key={f.label} className={cx(!f.have && "no")}>
              <Icon name={f.have ? "check" : "alert"} size={13} />
              <span><b>{f.label}</b><small>{f.note}</small></span>
              {!f.have && <em>Needs documentation</em>}
            </li>
          ))}
        </ul>

        {(inputs.length > 0 || outputs.length > 0) && (
          <div className="docd">
            <h3>Observed in consuming components</h3>
            <p>Field names that components building on {m.id} declare. Derived from those components, not from this module. Treat as evidence towards a contract, not the contract itself.</p>
            <div className="contract-io" style={{ border: "1px solid var(--line)", borderRadius: "var(--r)" }}>
              <div className="io"><h3>Inputs they pass</h3><ul className="io-list">{inputs.map(x => <li key={x}><code>{x}</code></li>)}</ul></div>
              <div className="io-arrow" aria-hidden><Icon name="arrowRight" size={16} /></div>
              <div className="io"><h5>Outputs they expect</h5><ul className="io-list">{outputs.map(x => <li key={x}><code>{x}</code></li>)}</ul></div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
