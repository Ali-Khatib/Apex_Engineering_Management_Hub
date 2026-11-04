import React, { useMemo, useState } from "react";
import { useStore, useNav } from "../store";
import { Icon } from "../icons";
import { Avatar, Empty, LifecyclePill, PriorityPill, cx } from "../ui";
import { WaveTag } from "./lib";
import { WAVES } from "../seed";
import { ViewSwitch, ViewPane, useView, type ViewDef } from "../views";
import { Timeline } from "./timeline";
import {
  ATTENTION, attentionCounts, matchesAttention, byUrgency, isScheduled, lifecycle,
  LIFECYCLE, nextAction, openBlockers, personName, situation, fmtDate, daysUntil,
  isDone, dayOf, type Attention,
} from "../logic";
import type { Component } from "../types";

/**
 * The portfolio. One set of filters, three ways of reading the same set:
 *
 *   List     — what is being worked on, who owns it, what happens next.
 *   Board    — how the work is distributed across the lifecycle.
 *   Timeline — when it is meant to happen, and where the dates disagree.
 *
 * Planning wave and lifecycle stay separate everywhere. The wave is the source
 * sheet's classification and is never rewritten here; the lifecycle is derived
 * from the records at read time. Neither decides the other.
 */

type RV = "list" | "board" | "timeline";
const VIEWS: ViewDef<RV>[] = [
  { id: "list", label: "List", icon: "components", answers: "What is being worked on, who owns it, and what has to happen next." },
  { id: "board", label: "Board", icon: "layers", answers: "How the whole library is spread across the seven lifecycle stages." },
  { id: "timeline", label: "Timeline", icon: "calendar", answers: "When the recorded dates say work happens, and where those dates contradict each other." },
];

type Sort = "urgent" | "due" | "name" | "owner";
const SORTS: { id: Sort; label: string }[] = [
  { id: "urgent", label: "Most urgent first" },
  { id: "due", label: "Earliest due date" },
  { id: "name", label: "Name" },
  { id: "owner", label: "Owner" },
];

export function Roadmap() {
  const { state, person } = useStore();
  const [view, setView] = useView<RV>("roadmap", "list");

  // One filter set, shared by all three views and kept when you switch.
  const [att, setAtt] = useState<Attention>("all");
  const [wave, setWave] = useState("");
  const [owner, setOwner] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("urgent");
  const [more, setMore] = useState(false);
  const narrowed = [wave, owner].filter(Boolean).length;

  const all = state.components;
  const counts = useMemo(() => attentionCounts(state, all), [state, all]);
  const waveCounts = useMemo(() => Object.fromEntries(WAVES.map(w => [w.id, all.filter(c => c.lib?.wave === w.id).length])), [all]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = all.filter(c =>
      matchesAttention(state, c, att)
      && (!wave || c.lib?.wave === wave)
      && (!owner || (owner === "none" ? !c.ownerId : c.ownerId === owner))
      && (!needle || c.id.toLowerCase().includes(needle) || c.name.toLowerCase().includes(needle) || (c.summary || "").toLowerCase().includes(needle)));
    const u = byUrgency(state);
    return out.sort(
      sort === "urgent" ? u
        : sort === "due" ? (a, b) => (a.due || "9999").localeCompare(b.due || "9999") || a.id.localeCompare(b.id)
          : sort === "name" ? (a, b) => a.name.localeCompare(b.name)
            : (a, b) => personName(person(a.ownerId)).localeCompare(personName(person(b.ownerId))) || u(a, b));
  }, [all, state, att, wave, owner, q, sort, person]);

  const dirty = att !== "all" || !!wave || !!owner || !!q;

  return (
    <>
      <header className="ph">
        <h1>Roadmap</h1>
        <p className="lede">Every component in the library, with its owner, its stage and what has to happen next. The filters below stay put when you change the view.</p>
      </header>

      <ViewSwitch views={VIEWS} value={view} onChange={setView} label="How to read the roadmap" />

      {/* Attention first, because it is the question people arrive with. */}
      <div className="fbar">
        <div className="fbar-att" role="group" aria-label="What needs attention">
          {ATTENTION.map(a => (
            <button key={a.id} className={cx("fchip", "a-" + a.tone, att === a.id && "on")} onClick={() => setAtt(a.id)} aria-pressed={att === a.id} title={a.help}>
              {a.label}<b>{counts[a.id]}</b>
            </button>
          ))}
        </div>
        {/* Same behaviour as the Components page: search stays out, the
            narrowing controls fold away on a phone. */}
        <div className="fbar-row fbar-find">
          <label className="fsearch">
            <Icon name="search" size={14} />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name or ID" aria-label="Search components" />
            {q && <button onClick={() => setQ("")} aria-label="Clear search"><Icon name="x" size={12} /></button>}
          </label>
          <button className="fbar-more-btn" onClick={() => setMore(v => !v)} aria-expanded={more}>
            <Icon name="filter" size={13} />
            {more ? "Hide filters" : "More filters"}{narrowed > 0 && <b>{narrowed}</b>}
          </button>
        </div>

        <div className={cx("fbar-more", more && "open")}>
        <div className="fbar-row">
          <label className="fsel"><span>Planning wave</span>
            <select value={wave} onChange={e => setWave(e.target.value)}>
              <option value="">Any wave</option>
              {WAVES.filter(w => waveCounts[w.id]).map(w => <option key={w.id} value={w.id}>{w.label} ({waveCounts[w.id]}): {w.hint}</option>)}
            </select>
          </label>
          <label className="fsel"><span>Owner</span>
            <select value={owner} onChange={e => setOwner(e.target.value)}>
              <option value="">Anyone</option>
              <option value="none">Nobody</option>
              {state.people.filter(p => p.active).map(p => <option key={p.id} value={p.id}>{personName(p)}</option>)}
            </select>
          </label>
          {view === "list" && (
            <label className="fsel"><span>Sort</span>
              <select value={sort} onChange={e => setSort(e.target.value as Sort)}>
                {SORTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </label>
          )}
          {dirty && <button className="fclear" onClick={() => { setAtt("all"); setWave(""); setOwner(""); setQ(""); }}>Clear filters</button>}
        </div>
        </div>
        <p className="fbar-sum">
          <b>{list.length}</b> of {all.length} components{att !== "all" && <> · {ATTENTION.find(a => a.id === att)!.help}</>}
        </p>
      </div>

      <ViewPane
        view={view}
        order={["list", "board", "timeline"]}
        render={v =>
          list.length === 0
            ? <Empty icon="plan" title="Nothing matches these filters">Try clearing one of them. Some combinations simply do not exist in the library.</Empty>
            : v === "list" ? <ListView rows={list} />
              : v === "board" ? <BoardView rows={list} />
                : <TimelineView rows={list} />}
      />
    </>
  );
}

/* ───────────────────────── List ───────────────────────── */

function ListView({ rows }: { rows: Component[] }) {
  const { state, person } = useStore();
  const [shown, setShown] = useState(25);
  return (
    <>
      <div className="rlist">
        {rows.slice(0, shown).map(c => {
          const na = nextAction(state, c);
          const ob = openBlockers(state, c.id);
          const d = c.due ? daysUntil(c.due) : null;
          const over = !isDone(c) && d !== null && d < 0;
          return (
            <a key={c.id} href={"#c-" + c.id} className={cx("ritem", !c.ownerId && !isDone(c) && "no-owner", ob.length && "has-blk")}>
              <span className="ritem-head">
                <code className="cid">{c.id}</code>
                <b>{c.name}</b>
                <LifecyclePill c={c} />
                <WaveTag wave={c.lib?.wave} />
                {(c.priority === "critical" || c.priority === "high") && <PriorityPill p={c.priority} />}
                <span className="ritem-right">
                  {c.ownerId
                    ? <span className="ritem-own"><Avatar p={person(c.ownerId)} size={20} />{personName(person(c.ownerId))}</span>
                    : <span className="ritem-own none">No owner</span>}
                  <span className={cx("ritem-due", over && "over", !over && d !== null && d >= 0 && d <= 7 && "soon")}>
                    {c.due ? fmtDate(c.due) : "No date"}
                  </span>
                </span>
              </span>
              <span className="ritem-sit">{situation(state, c)}</span>
              <span className="ritem-foot">
                {ob.length > 0 && <span className="ritem-blk"><Icon name="alert" size={12} />{ob.length === 1 ? ob[0].title : `${ob.length} open blockers`}</span>}
                <span className={cx("ritem-na", na.urgent && "urgent")}>
                  <Icon name="arrowRight" size={12} />
                  {na.text}{na.who && <em>{personName(person(na.who))}</em>}
                </span>
              </span>
            </a>
          );
        })}
      </div>
      {shown < rows.length && (
        <div className="rlist-more">
          <button className="btn btn-secondary btn-sm" onClick={() => setShown(n => n + 25)}>Show more ({rows.length - shown} left)</button>
        </div>
      )}
    </>
  );
}

/* ───────────────────────── Board ───────────────────────── */

function BoardView({ rows }: { rows: Component[] }) {
  const { state, person } = useStore();
  const cols = useMemo(() => LIFECYCLE.map(l => ({ ...l, items: rows.filter(c => lifecycle(state, c) === l.id) })), [rows, state]);
  return (
    <>
      <p className="bd-note">
        <Icon name="info" size={14} />
        <span>The columns are the lifecycle, which is derived from each record. The chip on every card is the planning wave from the source sheet. They are separate questions, so a card can be late in the lifecycle and still sit in a wave that was never scheduled. Moving work between stages happens on the component page, where the change is recorded against a person.</span>
      </p>
      <div className="bd">
        {cols.map(col => (
          <section key={col.id} className={cx("bd-col", "lc-" + col.tone)}>
            <header className="bd-col-head">
              <h3>{col.label}<b>{col.items.length}</b></h3>
              <p>{col.help}</p>
            </header>
            <div className="bd-col-body">
              {col.items.length === 0 && <p className="bd-empty">None</p>}
              {col.items.slice(0, 40).map(c => {
                const ob = openBlockers(state, c.id);
                return (
                  <a key={c.id} href={"#c-" + c.id} className={cx("bd-card", ob.length && "blk")}>
                    <span className="bd-card-top"><code className="cid">{c.id}</code><WaveTag wave={c.lib?.wave} /></span>
                    <b>{c.name}</b>
                    <span className="bd-card-foot">
                      {c.ownerId ? <Avatar p={person(c.ownerId)} size={18} /> : <span className="bd-noown">No owner</span>}
                      {c.due && <span className={cx("bd-due", !isDone(c) && daysUntil(c.due) < 0 && "over")}>{fmtDate(c.due)}</span>}
                      {ob.length > 0 && <span className="bd-blk" title={ob[0].title}><Icon name="alert" size={11} />{ob.length}</span>}
                    </span>
                  </a>
                );
              })}
              {col.items.length > 40 && <p className="bd-empty">and {col.items.length - 40} more</p>}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

/* ───────────────────────── Timeline ───────────────────────── */

function TimelineView({ rows }: { rows: Component[] }) {
  const sch = useMemo(() => rows.filter(isScheduled).sort((a, b) => dayOf(a.start) - dayOf(b.start)), [rows]);
  const un = useMemo(() => rows.filter(c => !isScheduled(c)), [rows]);
  return (
    <Timeline
      rows={sch}
      unscheduled={un}
      note={
        <p className="tl-note">
          <Icon name="info" size={14} />
          <span>
            {sch.length} of these {rows.length} components have both a start and a due date on the record. Those are the bars below.
            The other {un.length} have no dates at all and are named underneath instead of being placed on the chart.
          </span>
        </p>
      } />
  );
}
