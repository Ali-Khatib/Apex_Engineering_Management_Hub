import React, { useMemo, useState } from "react";
import { useStore, useNav } from "../store";
import { Icon } from "../icons";
import { Markdown, Section, Empty, cx, LifecyclePill } from "../ui";
import { WAVES } from "../seed";
import { lifecycle, lifecycleCounts, LIFECYCLE, situation, type Lifecycle } from "../logic";

/**
 * Two independent axes, shown as two independent filters.
 *
 *   Wave      — the source sheet's planning classification. Stored, never
 *               derived, never rewritten here.
 *   Lifecycle — how far the work has actually got. Derived at read time.
 *
 * A component's lifecycle says nothing about its wave, and the reverse, so the
 * page states that plainly and lets both be filtered at once.
 */
export function Roadmap() {
  const { state } = useStore();
  const { go } = useNav();
  const [wave, setWave] = useState<string>("");
  const [life, setLife] = useState<Lifecycle | "">("");
  const [shown, setShown] = useState(30);

  const all = state.components;
  const waveCounts = useMemo(() => Object.fromEntries(WAVES.map(w => [w.id, all.filter(c => c.lib?.wave === w.id).length])), [all]);
  const lifeCounts = useMemo(() => lifecycleCounts(state, all), [state, all]);

  const list = useMemo(() => all
    .filter(c => (!wave || c.lib?.wave === wave) && (!life || lifecycle(state, c) === life))
    .sort((a, b) => (a.lib?.layer || "").localeCompare(b.lib?.layer || "") || a.id.localeCompare(b.id)),
    [all, wave, life, state]);

  const unassigned = list.filter(c => !c.ownerId && c.status !== "completed").length;
  const decisions = list.filter(c => lifecycle(state, c) === "awaiting_decision").length;
  const filtered = !!wave || !!life;

  return (
    <>
      <header className="ph">
        <h1>Roadmap</h1>
        <p className="lede"><b>Lifecycle</b> is how far the work has actually got. <b>Planning wave</b> is where the component map of 20 October put it. Neither decides the other, so you can filter by both.</p>
      </header>

      {/* The seven states are a sequence, so the page shows them as one.
          Reading top to bottom is the explanation; no legend required. */}
      <ol className="rm-track" aria-label="Where the library stands">
        {LIFECYCLE.map(l => (
          <li key={l.id}>
            <button className={cx("rm-step", "lc-" + l.tone, life === l.id && "on")} onClick={() => setLife(life === l.id ? "" : l.id)} aria-pressed={life === l.id}>
              <strong>{lifeCounts[l.id]}</strong>
              <span>{l.label}</span>
            </button>
          </li>
        ))}
      </ol>

      <div className="rm-bar">
        <p className="rm-help">
          {life ? LIFECYCLE.find(l => l.id === life)!.help : "Select a stage to see only those components. Each one also carries the planning wave it came from, which is a separate question."}
        </p>
        <div className="rm-wave">
          <label htmlFor="rm-wave">Planning wave</label>
          <select id="rm-wave" value={wave} onChange={e => setWave(e.target.value)}>
            <option value="">Any wave ({all.length})</option>
            {WAVES.filter(w => waveCounts[w.id]).map(w => <option key={w.id} value={w.id}>{w.label} ({waveCounts[w.id]}) — {w.hint}</option>)}
          </select>
        </div>
      </div>

      {lifeCounts.ready === 0 && lifeCounts.assigned === 0 && !life && !wave && (
        <p className="axis-note">
          <Icon name="alert" size={14} />
          <span><b>Nothing is ready to start.</b> Every component names at least one prerequisite that is not finished, so no owned component has a clear run at it. <button onClick={() => go("map")}>Resolve dependencies</button></span>
        </p>
      )}

      <div className="axis-sum">
        <span><b>{list.length}</b> component{list.length === 1 ? "" : "s"}{filtered ? " shown" : ""}
          {wave && <> · wave <em>{WAVES.find(w => w.id === wave)!.label}</em></>}
        </span>
        <span className="axis-sum-right">
          {unassigned > 0 && <button className="axis-flag f-warn" onClick={() => setLife("selected")}><i />{unassigned} with no owner</button>}
          {decisions > 0 && <button className="axis-flag f-review" onClick={() => setLife("awaiting_decision")}><i />{decisions} need a decision</button>}
          {filtered && <button className="axis-clear" onClick={() => { setWave(""); setLife(""); }}>Clear</button>}
        </span>
      </div>

      {list.length === 0 ? (
        <Empty icon="plan" title="Nothing matches both filters">No component is in that stage and that planning wave at once. That combination may simply not exist.</Empty>
      ) : (
        <div className="rlist">
          {list.slice(0, shown).map(c => (
            <a key={c.id} href={"#c-" + c.id} className={cx("ritem", !c.ownerId && c.status !== "completed" && "no-owner")}>
              <span className="ritem-head">
                <code className="cid">{c.id}</code>
                <b>{c.name}</b>
                <LifecyclePill c={c} />
                <span className="ritem-wave" title="Planning wave, from the source sheet">{c.lib?.wave || "No wave"}</span>
              </span>
              <span className="ritem-sit">{situation(state, c)}</span>
              <span className="ritem-sum">{c.summary}</span>
            </a>
          ))}
        </div>
      )}
      {shown < list.length && (
        <div style={{ paddingTop: 14 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setShown(n => n + 30)}>Show more ({list.length - shown} left)</button>
        </div>
      )}

      <Section
        title="Before anything is assigned"
        sub="Nothing on this roadmap gets an owner until architecture review has worked through these checks. This is why many components sit in Selected for a round with nobody on them.">
        <div className="panel-body"><Markdown src={state.plan.notes} /></div>
      </Section>
    </>
  );
}
