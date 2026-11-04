import { Primer } from "./primer";
import React, { useMemo } from "react";
import { useStore, useNav } from "../store";
import { Icon } from "../icons";
import { Empty, PageHeader, Button, cx, PriorityPill, PersonChip } from "../ui";
import { isDone, OPEN_BLOCKER, kpis, risk, stage, PRIORITY_ORDER, ownershipCounts, OWNERSHIP, OWNERSHIP_ORDER, nextAction, fmtDate, personName } from "../logic";
import { LAYERS, LAYER_ORDER } from "../seed";
import { LayerOfTag, WaveTag, BarChart } from "./lib";

function Kpi({ label, value, foot, tone, lead, onClick }: { label: string; value: number; foot: string; tone?: string; lead?: boolean; onClick: () => void }) {
  return (
    <button className={cx("kpi", tone, lead && "kpi-lead")} onClick={onClick}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value num">{value}</span>
      <span className="kpi-foot">{foot}</span>
    </button>
  );
}

export function Home() {
  const { state, person } = useStore();
  const { openComponents, go } = useNav();
  const cs = state.components;
  const k = kpis(state);
  const now = cs.filter(c => c.lib?.wave === "Now" || c.lib?.wave === "P0");
  const nowNoOwner = now.filter(c => !c.ownerId);
  const blockers = state.blockers.filter(OPEN_BLOCKER);
  const inQa = cs.filter(c => { const s = stage(c); return s === "awaiting_qa" || s === "qa_changes"; }).length;
  const deciding = cs.filter(c => c.lib?.wave === "Architecture decision").length;

  const attention = useMemo(() => cs.map(c => ({ c, r: risk(state, c) }))
    .filter(x => x.r.level === "blocked" || x.r.level === "at_risk")
    .sort((a, b) => (a.r.level === "blocked" ? 0 : 1) - (b.r.level === "blocked" ? 0 : 1) || PRIORITY_ORDER[a.c.priority] - PRIORITY_ORDER[b.c.priority]), [state]);

  const atRisk = attention.length > 0;
  /**
   * Nothing is at risk yet because nothing has started. The useful fallback is not an
   * empty card but the work the most other components are waiting on — the honest answer
   * to "where do we start?" in a library where every component names a prerequisite.
   */
  const startable = useMemo(() => {
    const neededBy = new Map<string, number>();
    cs.forEach(c => c.deps.forEach(d => neededBy.set(d, (neededBy.get(d) || 0) + 1)));
    return cs.filter(c => (neededBy.get(c.id) || 0) > 0 && !isDone(c))
      .map(c => ({ c, n: neededBy.get(c.id)! }))
      .sort((a, b) => b.n - a.n);
  }, [state]);

  const reuse = useMemo(() => state.modules
    .map(m => ({ m, n: cs.filter(c => c.lib?.sps.includes(m.id)).length }))
    .sort((a, b) => b.n - a.n), [state]);

  const byLayer = LAYER_ORDER
    .map(key => ({ key, label: LAYERS[key].name, value: cs.filter(c => c.lib?.layer === key).length }))
    .filter(r => r.value)
    .sort((a, b) => b.value - a.value);

  /** Where the selected round stands. Checks, QA and deploy are separate gates. */
  const BUCKETS = [
    { key: "not", label: "Not started" },
    { key: "building", label: "Being built" },
    { key: "qa", label: "With QA" },
    { key: "ready", label: "Approved to ship" },
    { key: "shipped", label: "Shipped" },
  ];
  const bucket = (c: typeof cs[number]) => {
    const s = stage(c);
    if (s === "deployed") return "shipped";
    if (s === "ready" || s === "awaiting_deploy") return "ready";
    if (s === "awaiting_qa" || s === "qa_changes") return "qa";
    if (c.status === "in_progress" || c.status === "under_review") return "building";
    return "not";
  };
  const counts = BUCKETS.map(b => ({ ...b, n: now.filter(c => bucket(c) === b.key).length }));
  const maxBucket = Math.max(1, ...counts.map(c => c.n));

  // The one finding: what most needs saying today.
  const D0 = new Date().toISOString().slice(0, 10);
  const own = useMemo(() => ownershipCounts(cs, state.me), [cs, state.me]);

  const finding = nowNoOwner.length === now.length && now.length > 0
    ? `All ${now.length} components selected for this round are still unassigned. Nothing can start until someone owns them.`
    : nowNoOwner.length > 0
      ? `${nowNoOwner.length} of the ${now.length} components selected for this round have no owner yet.`
      : `All ${now.length} components in this round have an owner.`;

  return (
    <>
      <PageHeader
        title="Overview"
        sub={finding}
        actions={nowNoOwner.length > 0
          ? <Button variant="primary" onClick={() => openComponents({ owner: "__none", wave: "Now" })}>Assign owners</Button>
          : <Button variant="secondary" onClick={() => go("roadmap")}>Open the roadmap</Button>} />

      <Primer />

      <section className="ownstrip" aria-label="Who owns the work">
        <div className="ownstrip-head">
          <h2>Who owns the work <span>across all {cs.length}</span></h2>
          <p>Every one of the {cs.length} components is in exactly one of these. Responsibility and progress are different questions — a component can be half-built and still have nobody's name on it.</p>
        </div>
        <div className="ownstrip-row">
          {OWNERSHIP_ORDER.map(o => (
            <button key={o} className={cx("ownbox", "o-" + o)} onClick={() => openComponents({ quick: o })}>
              <span className="ownbox-top"><i className={cx("seg-mark", "m-" + o)} aria-hidden /><span>{OWNERSHIP[o].label}</span></span>
              <strong>{own[o]}</strong>
              <small>{OWNERSHIP[o].help}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="pipe">
        <div className="ownstrip-head">
          <h2>Delivery pipeline</h2>
          <p>Three approvals, each independent. A component can hold a pass on one and nothing on the next. These never roll up into a single figure.</p>
        </div>
        <div className="pipe-row">
          {([
            ["Checks passed", cs.filter(x => x.gates.checks.state === "passed").length, "the pipeline ran and succeeded", "ok"],
            ["Checks failing", cs.filter(x => x.gates.checks.state === "failed").length, "needs the owner, not QA", "crit"],
            ["Awaiting QA", cs.filter(x => ["awaiting", "in_progress"].includes(x.gates.qa.state)).length, "a QA decision is outstanding", "warn"],
            ["QA accepted", cs.filter(x => x.gates.qa.state === "accepted").length, "accepted on the exact build", "ok"],
            ["Awaiting deployment", cs.filter(x => x.gates.qa.state === "accepted" && !["ready", "scheduled", "deployed"].includes(x.gates.deploy.state)).length, "QA done, approval outstanding", "review"],
            ["Deployed", cs.filter(x => x.gates.deploy.state === "deployed").length, "shipped", "ok"],
          ] as [string, number, string, string][]).map(([label, n, foot, tone]) => (
            <button key={label} className={cx("pipebox", "p-" + tone)} onClick={() => go("qa")}>
              <strong>{n}</strong><span>{label}</span><small>{foot}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="pipe">
        <div className="ownstrip-head">
          <h2>Workload</h2>
          <p>What each engineer actually owns. No component carries an effort estimate, so capacity cannot be calculated and nothing here claims to.</p>
        </div>
        <div className="wkload">
          {state.people.map(pp => {
            const owned = cs.filter(x => x.ownerId === pp.id);
            if (!owned.length) return null;
            const active = owned.filter(x => !isDone(x));
            const blocked = active.filter(x => risk(state, x).level === "blocked").length;
            const over = active.filter(x => x.due && x.due < D0 && !isDone(x)).length;
            const nextDue = active.map(x => x.due).filter(Boolean).sort()[0];
            return (
              <button key={pp.id} className="wkrow" onClick={() => openComponents({ owner: pp.id })}>
                <PersonChip id={pp.id} size={26} />
                <span className="wkn">{active.length}<small>active</small></span>
                <span className={cx("wkn", blocked && "t-crit-text")}>{blocked}<small>blocked</small></span>
                <span className={cx("wkn", over && "t-warn-text")}>{over}<small>overdue</small></span>
                <span className="wkn">{owned.length - active.length}<small>done</small></span>
                <span className="wknext">{nextDue ? <>next due {fmtDate(nextDue)}</> : "no dated work"}</span>
              </button>
            );
          })}
        </div>
      </section>

      <div className="split">
        <section className="card">
          <div className="card-head">
            <h2>{atRisk ? "Needs attention" : "Start with these"}</h2>
            <button className="card-link" onClick={() => atRisk ? openComponents({ quick: "at_risk" }) : go("map")}>
              {atRisk ? `See all ${attention.length}` : "See the build order"}
            </button>
          </div>
          <p className="rd-note" style={{ margin: "0 18px 6px" }}>
            {atRisk
              ? "Blocked, overdue, or waiting on something that has stalled."
              : "Nothing is at risk, because nothing has started. These are the components the most other work is waiting on."}
          </p>
          <div className="list">
            {atRisk
              ? attention.slice(0, 6).map(({ c, r }) => {
                const na = nextAction(state, c);
                return (
                  <a key={c.id} href={"#c-" + c.id} className={cx("atrow", r.level === "blocked" && "is-blocked")}>
                    <span className="atrow-top">
                      <code className="cid">{c.id}</code>
                      <b>{c.name}</b>
                      <PriorityPill p={c.priority} />
                      <span className="atrow-due">{c.due ? fmtDate(c.due) : "no date"}</span>
                    </span>
                    <span className={cx("atrow-why", r.level === "blocked" ? "t-crit-text" : "t-warn-text")}>{r.reasons[0]}</span>
                    <span className="atrow-next">
                      <span>Next</span>{na.text}
                      <em>{na.who ? personName(person(na.who)) : c.ownerId ? personName(person(c.ownerId)) : "nobody assigned"}</em>
                    </span>
                  </a>
                );
              })
              : startable.slice(0, 6).map(({ c, n }) => (
                <a key={c.id} href={"#c-" + c.id} className="li3">
                  <code className="cid">{c.id}</code>
                  <span className="li3-main"><b>{c.name}</b><small>{n} {n === 1 ? "component is" : "components are"} waiting on this</small></span>
                  <LayerOfTag c={c} short />
                </a>
              ))}
            {!atRisk && startable.length === 0 && <Empty icon="check" title="Nothing is waiting on anything else" />}
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Where this round stands</h2>
            <span>{now.length} components</span>
          </div>
          <div className="hbars">
            {counts.map(b => (
              <button key={b.key} className="hbar" disabled>
                <span className="hbar-label">{b.label}</span>
                <span className="hbar-track"><i className={cx(b.key === "shipped" && b.n > 0 && "lead")} style={{ width: `${b.n / maxBucket * 100}%` }} /></span>
                <span className="hbar-v num">{b.n}</span>
              </button>
            ))}
          </div>
          <p className="rd-note" style={{ margin: "4px 18px 16px" }}>
            A component passes three separate approvals: automated checks, then QA, then deployment.
            Passing the checks never accepts QA on its own.
          </p>
        </section>
      </div>

      <div className="two">
        <section className="card">
          <div className="card-head">
            <h2>Components by platform layer</h2>
            <span>Pick a layer to open it</span>
          </div>
          <BarChart rows={byLayer} onPick={key => openComponents({ category: LAYERS[key].name })} />
        </section>
        <section className="card">
          <div className="card-head">
            <h2>Modules the most components build on</h2>
            <span>Where reuse concentrates</span>
          </div>
          <BarChart
            rows={reuse.slice(0, 9).map(({ m, n }) => ({ key: m.id, label: <><b className="mono">{m.id}</b> {m.name}</>, value: n }))}
            onPick={key => go("m-" + key)} />
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Selected for this round, still unassigned</h2>
          <button className="card-link" onClick={() => openComponents({ owner: "__none", wave: "Now" })}>See all {nowNoOwner.length}</button>
        </div>
        <div className="list">
          {nowNoOwner.length === 0 && <Empty icon="check" title="Every selected component has an owner" />}
          {nowNoOwner.slice(0, 6).map(c => (
            <a key={c.id} href={"#c-" + c.id} className="li3">
              <code className="cid">{c.id}</code>
              <span className="li3-main"><b>{c.name}</b><small>{c.summary}</small></span>
              <LayerOfTag c={c} short />
              <WaveTag wave={c.lib?.wave} />
            </a>
          ))}
        </div>
      </section>
    </>
  );
}
