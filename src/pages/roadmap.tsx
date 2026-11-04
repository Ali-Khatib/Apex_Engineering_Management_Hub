import React, { useMemo, useState } from "react";
import { useStore, useNav } from "../store";
import { Icon } from "../icons";
import { Markdown, Section, PersonChip, cx, OwnerState, LifecyclePill } from "../ui";
import { WAVES } from "../seed";
import { LayerOfTag } from "./lib";
import { lifecycle, lifecycleCounts, LIFECYCLE, type Lifecycle } from "../logic";

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
        <p className="lede">Two separate questions. <b>Planning wave</b> is where the component map of 20 October put a component. <b>Lifecycle</b> is how far the work has actually got. Neither one decides the other, so you can filter by both.</p>
      </header>

      <div className="axis">
        <div className="axis-head">
          <h2>Lifecycle</h2>
          <span>What is actually happening. Worked out from owner, dependencies and status.</span>
        </div>
        <div className="axis-row" role="group" aria-label="Filter by lifecycle">
          <button className={cx("axis-chip", !life && "on")} onClick={() => setLife("")}>All<b>{all.length}</b></button>
          {LIFECYCLE.map(l => (
            <button key={l.id} className={cx("axis-chip", "lc-" + l.tone, life === l.id && "on")} onClick={() => setLife(life === l.id ? "" : l.id)} title={l.help} aria-pressed={life === l.id}>
              <i aria-hidden />{l.label}<b>{lifeCounts[l.id]}</b>
            </button>
          ))}
        </div>
      </div>

      {lifeCounts.ready === 0 && lifeCounts.assigned === 0 && (
        <p className="axis-note">
          <Icon name="alert" size={14} />
          <span>
            <b>Nothing is ready to start.</b> Every component names at least one prerequisite that is not finished, so no owned component has a clear run at it.
            That is a dependency problem, not a staffing one. <button onClick={() => go("map")}>Open build order</button>
          </span>
        </p>
      )}

      <div className="axis">
        <div className="axis-head">
          <h2>Planning wave</h2>
          <span>Taken exactly from the source sheet. Not changed by this platform.</span>
        </div>
        <div className="axis-row" role="group" aria-label="Filter by planning wave">
          <button className={cx("axis-chip", !wave && "on")} onClick={() => setWave("")}>All<b>{all.length}</b></button>
          {WAVES.filter(w => waveCounts[w.id]).map(w => (
            <button key={w.id} className={cx("axis-chip", wave === w.id && "on")} onClick={() => setWave(wave === w.id ? "" : w.id)} title={w.hint} aria-pressed={wave === w.id}>
              {w.label}<b>{waveCounts[w.id]}</b>
            </button>
          ))}
        </div>
      </div>

      <div className="axis-sum">
        <span><b>{list.length}</b> component{list.length === 1 ? "" : "s"}{filtered ? " match" : ""}
          {life && <> · lifecycle <em>{LIFECYCLE.find(l => l.id === life)!.label}</em></>}
          {wave && <> · wave <em>{WAVES.find(w => w.id === wave)!.label}</em></>}
        </span>
        <span className="axis-sum-right">
          {unassigned > 0 && <button className="axis-flag f-warn" onClick={() => { setLife("selected"); }}><i />{unassigned} with no owner</button>}
          {decisions > 0 && <button className="axis-flag f-review" onClick={() => setLife("awaiting_decision")}><i />{decisions} need a decision</button>}
          {filtered && <button className="axis-clear" onClick={() => { setWave(""); setLife(""); }}>Clear filters</button>}
        </span>
      </div>

      {list.length === 0 ? (
        <div className="empty"><strong>Nothing matches both filters</strong><p>No component is in that lifecycle state and that planning wave at the same time. That combination may simply not exist.</p><button className="btn btn-secondary btn-md" onClick={() => { setWave(""); setLife(""); }}>Clear filters</button></div>
      ) : (
        <div className="rgrid">
          {list.map(c => (
            <a key={c.id} href={"#c-" + c.id} className={cx("rcard", !c.ownerId && c.status !== "completed" && "no-owner")}>
              <span className="rcard-top"><code className="cid">{c.id}</code><LayerOfTag c={c} short /></span>
              <b>{c.name}</b>
              <p>{c.summary}</p>
              <span className="rcard-axes">
                <LifecyclePill c={c} />
                <span className="rcard-wave" title="Planning wave from the source sheet">{c.lib?.wave || "No wave"}</span>
              </span>
              <span className="rcard-foot">
                <span className="rcard-sp">{c.lib?.sps.length ? c.lib.sps.join(" · ") : "No SP mapping"}</span>
                <OwnerState c={c} size={20} />
              </span>
            </a>
          ))}
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
