import React, { useState } from "react";
import { useStore } from "../store";
import { Markdown, PersonChip, cx, OwnerState } from "../ui";
import { WAVES, LAYERS } from "../seed";
import { LayerOfTag } from "./lib";

export function Roadmap() {
  const { state } = useStore();
  const [wave, setWave] = useState("Now");
  const counts = Object.fromEntries(WAVES.map(w => [w.id, state.components.filter(c => c.lib?.wave === w.id).length]));
  const cur = WAVES.find(w => w.id === wave)!;
  const list = state.components.filter(c => c.lib?.wave === wave).sort((a, b) => (a.lib!.layer).localeCompare(b.lib!.layer) || a.id.localeCompare(b.id));
  return (
    <>
      <header className="ph">
        <h1>Roadmap</h1>
        <p className="lede">Which components are selected for this round, which come next, and which need a decision first. Stages are taken exactly from the component map.</p>
      </header>
      <div className="wavetabs" role="tablist">
        {WAVES.filter(w => counts[w.id]).map(w => (
          <button key={w.id} role="tab" aria-selected={wave === w.id} className={cx("wavetab", wave === w.id && "on")} onClick={() => setWave(w.id)}>
            <b>{w.label}</b><span>{counts[w.id]}</span>
          </button>
        ))}
      </div>
      <p className="wavehint"><b>{cur.label}:</b> {cur.hint}. {list.filter(c => !c.ownerId).length} of {list.length} have no owner yet.</p>
      <div className="rgrid">
        {list.map(c => (
          <a key={c.id} href={"#c-" + c.id} className="rcard">
            <span className="rcard-top"><code className="cid">{c.id}</code><LayerOfTag c={c} short /></span>
            <b>{c.name}</b>
            <p>{c.summary}</p>
            <span className="rcard-foot"><span className="rcard-sp">{c.lib?.sps.length ? c.lib.sps.join(" · ") : "No SP mapping"}</span><OwnerState c={c} size={20} /></span>
          </a>
        ))}
      </div>
      <section className="card">
        <div className="card-head"><h2>Before anything is assigned</h2></div>
        <Markdown src={state.plan.notes} />
      </section>
    </>
  );
}
