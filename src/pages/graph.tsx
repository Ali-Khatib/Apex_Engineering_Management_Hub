import React, { useMemo, useState } from "react";
import { useStore } from "../store";
import { Icon } from "../icons";
import { Empty, cx } from "../ui";
import { WaveTag } from "./lib";
import { CycleCard } from "./cycles";
import { DepGraph } from "./depgraph";
import { Timeline } from "./timeline";
import { analyse } from "../depmath";
import { ViewSwitch, ViewPane, useView, type ViewDef } from "../views";
import { isDone, isScheduled, dayOf, fmtDate, longestChain, openBlockers, STATUS_LABEL, situation } from "../logic";
import type { Component } from "../types";

/**
 * Dependencies. Four ways of reading the same records:
 *
 *   List       — every prerequisite as a sentence, with both ends' status.
 *   Graph      — one component at a time, with what it needs and what needs it.
 *   Plan       — the recorded dates, and the build order the records imply.
 *   Decisions  — the loops, which need a person rather than a schedule.
 *
 * Nothing on this page edits a dependency. Recording a decision about a loop
 * is a minute of that decision; the loop stays in the data until somebody
 * changes the component itself.
 */

type DV = "list" | "graph" | "plan" | "decisions";
const VIEWS: ViewDef<DV>[] = [
  { id: "list", label: "List", icon: "components", answers: "Every prerequisite written out: what needs what, and whether it is satisfied yet." },
  { id: "graph", label: "Graph", icon: "graph", answers: "One component at a time, with what must finish before it and what is waiting on it." },
  { id: "plan", label: "Plan", icon: "calendar", answers: "The recorded dates, and the build order those dependencies imply. Not an approved schedule." },
  { id: "decisions", label: "Decisions", icon: "flag", answers: "The loops. Two components that each need the other cannot be sequenced, so a person has to choose." },
];

/**
 * The order the dependency records imply: everything with nothing outstanding,
 * then everything whose prerequisites are all in an earlier step, and so on.
 * It stops when nothing new can be placed, which is what a loop does to a
 * build order. That remainder is the honest output, not a failure.
 */
function proposedOrder(cs: Component[]) {
  const ids = new Set(cs.map(c => c.id));
  const left = new Map(cs.map(c => [c.id, c.deps.filter(d => ids.has(d))]));
  const placed = new Set<string>();
  const steps: Component[][] = [];
  for (let guard = 0; guard < 60 && placed.size < cs.length; guard++) {
    const step = cs.filter(c => !placed.has(c.id) && left.get(c.id)!.every(d => placed.has(d)));
    if (!step.length) break;
    step.forEach(c => placed.add(c.id));
    steps.push(step);
  }
  return { steps, stuck: cs.filter(c => !placed.has(c.id)) };
}

export function Graph() {
  const { state, component } = useStore();
  const [view, setView] = useView<DV>("deps", "list");
  const cs = state.components;
  const model = useMemo(() => analyse(cs), [cs]);

  const mostNeeded = useMemo(() => cs
    .map(c => ({ c, n: (model.neededBy.get(c.id) || []).length }))
    .sort((a, b) => b.n - a.n)[0]?.c.id || cs[0]?.id, [cs, model]);
  const [focus, setFocus] = useState<string>(mostNeeded);

  const decided = model.loops.filter(l => ["decided", "deferred"].includes(state.cycleDecisions?.[l.key]?.status || "")).length;
  const edgeCount = cs.reduce((n, c) => n + c.deps.length, 0);

  return (
    <>
      <header className="ph">
        <h1>Dependencies</h1>
        <p className="lede">
          {edgeCount} recorded prerequisites across {cs.length} components. They form {model.sccs.length} tangles
          {model.sccs.length > 0 && <> of {model.sccs.map(s => s.length).join(", ")} components</>}, holding {model.loops.length} separate
          loops to decide. Nothing on this page changes a dependency on its own.
        </p>
      </header>

      <ViewSwitch views={VIEWS} value={view} onChange={setView} label="How to read the dependencies" />

      <ViewPane
        view={view}
        order={["list", "graph", "plan", "decisions"]}
        render={v =>
          v === "list" ? <DepList model={model} onFocus={id => { setFocus(id); setView("graph"); }} />
            : v === "graph" ? <GraphView model={model} focus={focus} setFocus={setFocus} />
              : v === "plan" ? <PlanView model={model} />
                : <DecisionsView model={model} decided={decided} />} />
    </>
  );
}

/* ───────────────────────── List ───────────────────────── */

type EdgeFilter = "unsatisfied" | "loop" | "all";

function DepList({ model, onFocus }: { model: ReturnType<typeof analyse>; onFocus: (id: string) => void }) {
  const { state, component } = useStore();
  const [f, setF] = useState<EdgeFilter>("unsatisfied");
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(30);

  const edges = useMemo(() => {
    const out: { c: Component; d: Component; satisfied: boolean; loop: boolean }[] = [];
    for (const c of state.components) for (const id of c.deps) {
      const d = component(id); if (!d) continue;
      out.push({ c, d, satisfied: isDone(d), loop: model.loopEdges.has(`${c.id}>${d.id}`) });
    }
    return out;
  }, [state.components, component, model]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return edges.filter(e =>
      (f === "all" || (f === "loop" ? e.loop : !e.satisfied))
      && (!needle || (e.c.name + e.c.id + e.d.name + e.d.id).toLowerCase().includes(needle)))
      .sort((a, b) => Number(b.loop) - Number(a.loop) || a.c.id.localeCompare(b.c.id));
  }, [edges, f, q]);

  const unsat = edges.filter(e => !e.satisfied).length;

  return (
    <>
      <p className="dl-lede">
        Each line is one recorded prerequisite: the component on the left cannot be finished until the component on the right is.
        {" "}{edges.length - unsat} of the {edges.length} are already satisfied because the prerequisite is complete.
      </p>

      <div className="fbar fbar-tight">
        <div className="fbar-row">
          <div className="dl-segs" role="group" aria-label="Which prerequisites to show">
            {([["unsatisfied", `Not satisfied yet (${unsat})`], ["loop", `In a loop (${edges.filter(e => e.loop).length})`], ["all", `All (${edges.length})`]] as [EdgeFilter, string][]).map(([id, label]) => (
              <button key={id} className={cx("fchip", f === id && "on")} onClick={() => setF(id)} aria-pressed={f === id}>{label}</button>
            ))}
          </div>
          <label className="fsearch">
            <Icon name="search" size={14} />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search either end" aria-label="Search dependencies" />
            {q && <button onClick={() => setQ("")} aria-label="Clear search"><Icon name="x" size={12} /></button>}
          </label>
        </div>
      </div>

      {rows.length === 0 ? <Empty icon="graph" title="No prerequisite matches that" /> : (
        <div className="dl">
          {rows.slice(0, shown).map(({ c, d, satisfied, loop }) => {
            const ob = openBlockers(state, d.id);
            return (
              <div key={c.id + ">" + d.id} className={cx("dl-i", loop && "loop", satisfied && "ok")}>
                <div className="dl-pair">
                  <a href={"#c-" + c.id} className="dl-end">
                    <code className="cid">{c.id}</code><b>{c.name}</b>
                    <span>{STATUS_LABEL[c.status]}</span>
                  </a>
                  <span className="dl-rel" aria-label="needs"><Icon name="arrowRight" size={13} /><em>needs</em></span>
                  <a href={"#c-" + d.id} className="dl-end">
                    <code className="cid">{d.id}</code><b>{d.name}</b>
                    <span>{STATUS_LABEL[d.status]}</span>
                  </a>
                </div>
                <div className="dl-state">
                  {satisfied
                    ? <span className="dl-tag t-ok"><Icon name="check" size={11} />Satisfied</span>
                    : <span className="dl-tag t-wait">Not satisfied. {d.name} is {STATUS_LABEL[d.status].toLowerCase()}.</span>}
                  {loop && <span className="dl-tag t-loop"><Icon name="alert" size={11} />{d.name} also needs {c.name}, so neither can go first</span>}
                  {ob.length > 0 && <span className="dl-tag t-blk"><Icon name="alert" size={11} />{d.name} is blocked: {ob[0].title}</span>}
                  <button className="dl-see" onClick={() => onFocus(c.id)}>See this on the graph</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {shown < rows.length && (
        <div className="rlist-more">
          <button className="btn btn-secondary btn-sm" onClick={() => setShown(n => n + 30)}>Show more ({rows.length - shown} left)</button>
        </div>
      )}
    </>
  );
}

/* ───────────────────────── Graph ───────────────────────── */

function GraphView({ model, focus, setFocus }: { model: ReturnType<typeof analyse>; focus: string; setFocus: (id: string) => void }) {
  const { state, component } = useStore();
  const [q, setQ] = useState("");
  const matches = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return [];
    return state.components.filter(c => c.name.toLowerCase().includes(n) || c.id.toLowerCase().includes(n)).slice(0, 7);
  }, [q, state.components]);

  const top = useMemo(() => state.components
    .map(c => ({ c, n: (model.neededBy.get(c.id) || []).length }))
    .filter(x => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 6), [state.components, model]);

  const c = component(focus);

  return (
    <>
      <div className="gv-pick">
        <label className="fsearch">
          <Icon name="search" size={14} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a component to put in the middle" aria-label="Find a component" />
          {q && <button onClick={() => setQ("")} aria-label="Clear"><Icon name="x" size={12} /></button>}
        </label>
        {matches.length > 0 && (
          <div className="gv-matches">
            {matches.map(m => <button key={m.id} onClick={() => { setFocus(m.id); setQ(""); }}><code className="cid">{m.id}</code>{m.name}</button>)}
          </div>
        )}
        <div className="gv-top">
          <span>Most depended on:</span>
          {top.map(({ c: t, n }) => (
            <button key={t.id} className={cx("gv-chip", focus === t.id && "on")} onClick={() => setFocus(t.id)}>
              {t.name}<b>{n}</b>
            </button>
          ))}
        </div>
      </div>

      <DepGraph model={model} focus={focus} onFocus={setFocus} />

      {c && (
        <p className="gv-sit">
          <b>{c.name}</b>. {situation(state, c)}{" "}
          <a href={"#c-" + c.id}>Open the component</a>
        </p>
      )}
    </>
  );
}

/* ───────────────────────── Plan ───────────────────────── */

function PlanView({ model }: { model: ReturnType<typeof analyse> }) {
  const { state } = useStore();
  const loops = model.loops.length;
  const cs = state.components;
  const sch = useMemo(() => cs.filter(isScheduled).sort((a, b) => dayOf(a.start) - dayOf(b.start)), [cs]);
  const un = useMemo(() => cs.filter(c => !isScheduled(c)), [cs]);
  const chain = useMemo(() => longestChain(state), [state]);
  const chainSet = useMemo(() => new Set(chain.map(c => c.id)), [chain]);
  const { steps, stuck } = useMemo(() => proposedOrder(cs), [cs]);

  return (
    <>
      <p className="pl-warn">
        <Icon name="alert" size={14} />
        <span>
          <b>There is no approved schedule.</b> The platform holds no record of an agreed plan, so nothing below is one.
          The timeline shows the dates recorded on each component. The build order underneath is derived from the dependency
          records by this page, and is a proposal for review, not an engineering commitment.
        </span>
      </p>

      <Timeline
        rows={sch} unscheduled={un} showDeps chain={chainSet}
        note={
          <p className="tl-note">
            <Icon name="info" size={14} />
            <span>
              {sch.length} of {cs.length} components carry both a start and a due date. The rest are named under the chart.
              The lime edge marks the longest chain of dated prerequisites, set out below.
            </span>
          </p>
        } />

      <section className="pl-chain">
        <h3>Longest chain that can be calculated</h3>
        <p>
          A critical path cannot be worked out for the library as a whole: most components carry no dates, and {loops} groups
          depend on each other in a loop. This is the longest run of dated prerequisites that genuinely can be,
          {" "}{chain.length} components end to end. It is highlighted on the timeline above.
        </p>
        <ol className="pl-chain-l">
          {chain.map(c => (
            <li key={c.id}><a href={"#c-" + c.id}><code className="cid">{c.id}</code>{c.name}</a><span>{fmtDate(c.start)} to {fmtDate(c.due)}</span></li>
          ))}
        </ol>
      </section>

      <section className="pl-order">
        <h3>Proposed build order</h3>
        <p>
          Step 1 is everything with no outstanding prerequisite. Each step after it is everything whose prerequisites are all in an
          earlier step. This is arithmetic on the dependency records, not a decision anyone has taken.
        </p>
        {steps.length === 0 && (
          <div className="pl-stuck">
            <h4><Icon name="alert" size={14} />There is no step 1</h4>
            <p>
              Every one of the {state.components.length} components names at least one prerequisite, and none of those prerequisites is
              complete, so no component qualifies for the first step and the order never starts. This is not a gap in the data: the records
              describe a library in which nothing can be built first. It resolves when the {model.sccs.length} tangles are decided under{" "}
              <b>Decisions</b>, or when a component is recorded as having no prerequisite.
            </p>
          </div>
        )}
        <div className="pl-steps">
          {steps.map((step, i) => (
            <div key={i} className="pl-step">
              <h4>Step {i + 1}<b>{step.length}</b></h4>
              <div className="pl-step-l">
                {step.slice(0, 12).map(c => (
                  <a key={c.id} href={"#c-" + c.id}><code className="cid">{c.id}</code>{c.name}<WaveTag wave={c.lib?.wave} /></a>
                ))}
                {step.length > 12 && <span className="pl-more">and {step.length - 12} more</span>}
              </div>
            </div>
          ))}
        </div>
        {stuck.length > 0 && steps.length > 0 && (
          <div className="pl-stuck">
            <h4><Icon name="alert" size={14} />{stuck.length} components have no step</h4>
            <p>
              The order stops here. These components are in a loop, directly or through another component, so no step can ever
              contain them: each one is waiting for something that is waiting for it. They stay out of the build order until the
              loops are decided under <b>Decisions</b>.
            </p>
          </div>
        )}
      </section>
    </>
  );
}

/* ───────────────────────── Decisions ───────────────────────── */

function DecisionsView({ model, decided }: { model: ReturnType<typeof analyse>; decided: number }) {
  const { state, component } = useStore();
  const [shown, setShown] = useState(8);
  const first = model.loops[0];
  const a = first && component(first.ids[0]);
  const b = first && component(first.ids[1] || first.ids[0]);

  return (
    <>
      {a && b && (
        <div className="dr-example">
          <h2>What a loop is</h2>
          <p>
            <b>{a.name}</b> cannot be finished until <b>{b.name}</b> is done.
            But <b>{b.name}</b> cannot be finished until <b>{a.name}</b> is done.
            So neither can go first, and no amount of scheduling fixes it. A person has to decide which of the two needs the other less.
          </p>
        </div>
      )}

      <section className="dr-scc">
        <h3>{model.sccs.length} tangles, {model.loops.length} decisions</h3>
        <p>
          A tangle is a set of components that can all reach each other through their prerequisites, so none of them can be sequenced
          against the rest. Inside a tangle there are many separate loops, and each loop is one decision somebody can take. Breaking
          enough loops in a tangle is what releases the components in it.
        </p>
        <div className="dr-scc-l">
          {model.sccs.map((s, i) => {
            const mine = model.loops.filter(l => l.ids.every(id => model.sccOf.get(id) === i));
            const done = mine.filter(l => ["decided", "deferred"].includes(state.cycleDecisions?.[l.key]?.status || "")).length;
            return (
              <div key={i} className={cx("dr-scc-i", i === 0 && "lead")}>
                <b>{s.length} components</b>
                <span>{mine.length} loop{mine.length === 1 ? "" : "s"} inside</span>
                <small>{done} of {mine.length} decided</small>
              </div>
            );
          })}
        </div>
      </section>

      <div className="dr-head">
        <h2>Decisions needed</h2>
        <span>{decided} of {model.loops.length} decided · shortest loops first, they are usually the easiest to resolve</span>
      </div>

      <div className="cyclist dr-list">
        {model.loops.length === 0 && <Empty icon="check" title="No circular dependencies" />}
        {model.loops.slice(0, shown).map(l => <CycleCard key={l.key} loop={l} />)}
      </div>
      {shown < model.loops.length && (
        <div className="rlist-more">
          <button className="btn btn-secondary btn-sm" onClick={() => setShown(s => s + 12)}>Show more ({model.loops.length - shown} left)</button>
        </div>
      )}
    </>
  );
}
