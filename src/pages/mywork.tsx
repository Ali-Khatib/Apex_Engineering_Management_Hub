import React, { useMemo, useState } from "react";
import { useStore, useNav } from "../store";
import { Icon } from "../icons";
import { Section, Pill, PersonChip, StatusPill, PriorityPill, DueText, GateDots, Empty, CopyText, Segmented, cx } from "../ui";
import { isDone, risk, nextAction, byUrgency, fmtDate, personName, openBlockers, OPEN_BLOCKER } from "../logic";
import { HandoffCard, BlockerRow } from "./blockers";
import { HistoryLine } from "./activity";
import type { Component } from "../types";

/**
 * One row per assigned component. The primary carries a marker, not a stage.
 * Expanding a row reveals the working detail: deliverable, repository, branch,
 * dependencies and acceptance, so nothing from the old card view is lost.
 */
function WorkRow({ c, primary, open, onToggle }: { c: Component; primary: boolean; open: boolean; onToggle: () => void }) {
  const { state, person } = useStore();
  const na = nextAction(state, c);
  const r = risk(state, c);
  const repo = state.repos.find(x => x.id === c.repoId);
  const blockers = openBlockers(state, c.id);
  return (
    <div className={cx("wrow", primary && "is-primary", open && "is-open", r.level === "blocked" && "is-blocked")}>
      <div className="wrow-main">
        <button className="wrow-toggle" onClick={onToggle} aria-expanded={open} aria-label={open ? `Hide details for ${c.name}` : `Show details for ${c.name}`}>
          <Icon name="chevronRight" size={14} />
        </button>
        <a className="wrow-id" href={"#c-" + c.id}><code className="cid">{c.id}</code></a>
        <a className="wrow-name" href={"#c-" + c.id}>
          <b>{c.name}</b>
          {primary && <em title="Sorted first: blocked, then at risk, then by priority and due date.">Most urgent</em>}
        </a>
        <span className="wrow-pri"><PriorityPill p={c.priority} /></span>
        <span className="wrow-status"><StatusPill s={c.status} /></span>
        <span className="wrow-due"><DueText c={c} /></span>
        <span className={cx("wrow-next", na.urgent && "urgent")} title={na.text}>
          {na.urgent && <i className="wrow-bang" aria-hidden />}
          <span>{na.text}</span>
          {na.who && <small>{personName(person(na.who))}</small>}
        </span>
      </div>

      {open && (
        <div className="wrow-detail">
          <div className="wdet">
            <h5>Deliverable</h5>
            <p>{c.deliverable || <span className="muted">Not recorded.</span>}</p>
          </div>
          <div className="wdet">
            <h5>People</h5>
            <dl className="wdl">
              <div><dt>Reviewer</dt><dd><PersonChip id={c.reviewerId} empty="Not assigned" /></dd></div>
              <div><dt>QA</dt><dd><PersonChip id={c.qaId} empty="Not assigned" /></dd></div>
            </dl>
          </div>
          <div className="wdet">
            <h5>Start here</h5>
            {repo ? (
              <dl className="wdl">
                <div><dt>Repository</dt><dd><CopyText text={repo.url}>{repo.name}</CopyText></dd></div>
                <div><dt>Branch</dt><dd><CopyText text={c.onboarding.branch || "not set"} /></dd></div>
                <div><dt>Setup</dt><dd><a href={"#c-" + c.id} onClick={() => { try { sessionStorage.setItem("apex-tab-" + c.id, "onboarding"); } catch { } }}>Onboarding pack</a></dd></div>
              </dl>
            ) : <p className="muted">No repository linked yet.</p>}
          </div>
          <div className="wdet">
            <h5>Dependencies</h5>
            {c.deps.length ? (
              <ul className="wdeps">
                {c.deps.map(d => {
                  const x = state.components.find(z => z.id === d);
                  if (!x) return null;
                  return <li key={d}><a href={"#c-" + d}>{x.name}</a><StatusPill s={x.status} /></li>;
                })}
              </ul>
            ) : <p className="muted">None.</p>}
          </div>
          <div className="wdet">
            <h5>Readiness</h5>
            <GateDots c={c} showLabel />
            <p className="wdet-accept">{c.criteria.filter(k => k.status === "accepted").length} of {c.criteria.length} acceptance criteria accepted</p>
          </div>
          {blockers.length > 0 && (
            <div className="wdet wdet-wide">
              <h5>Blocked</h5>
              <ul className="wblk">{blockers.map(b => <li key={b.id}><b>{b.title}</b><span>Next: {b.nextAction} ({personName(person(b.responsibleId))})</span></li>)}</ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function MyWork() {
  const { state, me, person } = useStore();
  const { go } = useNav();
  const [view, setView] = useState<"compact" | "detailed">("compact");
  const [openIds, setOpenIds] = useState<string[]>([]);
  const [showDone, setShowDone] = useState(false);
  if (!me) return null;

  const active = useMemo(() => state.components.filter(c => c.ownerId === me.id && !isDone(c)).sort(byUrgency(state)), [state, me.id]);
  const done = state.components.filter(c => c.ownerId === me.id && isDone(c));
  const reviews = state.components.filter(c => !isDone(c) && ((c.reviewerId === me.id && (c.review === "in_review" || c.criteria.some(k => k.status === "submitted"))) || (c.qaId === me.id && ["awaiting", "in_progress"].includes(c.gates.qa.state))));
  const myBlockers = state.blockers.filter(b => OPEN_BLOCKER(b) && b.responsibleId === me.id);
  const handoffs = state.handoffs.filter(h => h.toId === me.id && h.status === "awaiting_ack");
  const feedback = active.flatMap(c => c.criteria.flatMap(k => k.evidence.filter(e => e.decision && e.decision !== "approved").map(e => ({ c, k, e }))));
  const unassigned = state.components.filter(c => !c.ownerId && !isDone(c));

  const blocked = active.filter(c => risk(state, c).level === "blocked").length;
  const inReview = active.filter(c => c.review === "in_review" || ["awaiting", "in_progress"].includes(c.gates.qa.state)).length;

  const isOpen = (id: string) => view === "detailed" || openIds.includes(id);
  const toggle = (id: string) => setOpenIds(x => x.includes(id) ? x.filter(i => i !== id) : [...x, id]);

  const stat = (label: string, n: number, tone?: string) => (
    <div className={cx("wstat", tone)}><strong>{n}</strong><span>{label}</span></div>
  );

  return (
    <>
      <header className="ph ph-row">
        <div>
          <h1>My work</h1>
          <p className="lede">
            {active.length
              ? `${active.length} active component${active.length > 1 ? "s" : ""} assigned to you.`
              : "Nothing is assigned to you right now."}
          </p>
        </div>
        {active.length > 0 && (
          <Segmented
            options={[{ id: "compact", label: "Compact" }, { id: "detailed", label: "Detailed" }]}
            value={view}
            onChange={v => { setView(v as any); setOpenIds([]); }} />
        )}
      </header>

      {handoffs.map(h => <HandoffCard key={h.id} h={h} />)}

      {active.length > 0 ? (
        <>
          <div className="wstats">
            {stat("Active", active.length)}
            {stat("Blocked", blocked, blocked ? "t-crit" : undefined)}
            {stat("Awaiting review", inReview)}
            {stat("Completed", done.length, done.length ? "t-ok" : undefined)}
          </div>

          <div className="wlist">
            <div className="wlist-head">
              <span /><span>ID</span><span>Component</span><span>Priority</span><span>Status</span><span>Due</span><span>Next action</span>
            </div>
            {active.map((c, i) => (
              <WorkRow key={c.id} c={c} primary={i === 0} open={isOpen(c.id)} onToggle={() => toggle(c.id)} />
            ))}
          </div>

          {done.length > 0 && (
            <div className="wdone">
              <button className="wdone-head" onClick={() => setShowDone(v => !v)} aria-expanded={showDone}>
                <Icon name="chevronRight" size={14} />
                <b>Completed</b><span>{done.length}</span>
              </button>
              {showDone && (
                <div className="wdone-list">
                  {done.map(c => (
                    <a key={c.id} href={"#c-" + c.id} className="wdone-row">
                      <code className="cid">{c.id}</code>
                      <b>{c.name}</b>
                      <Pill tone="ok">Delivered</Pill>
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <Section title="Nothing assigned to you yet">
          <div className="panel-body" style={{ display: "grid", gap: 16 }}>
            <div className="mw-how">
              <p>Components appear here when an administrator or authorised manager assigns them to you. From that moment the component is yours to build, and this page becomes your starting point: deliverable, repository, branch, dependencies, reviewer, acceptance criteria and deadline.</p>
              <p>Unassigned components are managed separately. They are not your responsibility until someone assigns one to you.</p>
            </div>
            <div>
              <h4 className="mw-sub">Waiting for an owner <span>{unassigned.length} components</span></h4>
              <p className="muted" style={{ fontSize: 13, margin: "0 0 10px" }}>Not assigned to you. Listed so you can see what is open and ask for one by name.</p>
              <div className="deps">{unassigned.slice(0, 5).map(c => <a key={c.id} href={"#c-" + c.id} className="dep"><span className="dep-name"><span>{c.name}</span><small>{c.id} · {c.category}</small></span><PriorityPill p={c.priority} /></a>)}</div>
              {unassigned.length > 5 && <button className="btn btn-secondary btn-sm" style={{ marginTop: 10 }} onClick={() => go("library")}>See all {unassigned.length} unassigned components</button>}
            </div>
          </div>
        </Section>
      )}

      {reviews.length > 0 && (
        <Section title="Waiting on you" sub="Other people's components that need your review or QA decision">
          <div className="list-plain">
            {reviews.map(c => (
              <a key={c.id} href={"#c-" + c.id} className="li" onClick={() => { try { sessionStorage.setItem("apex-tab-" + c.id, "acceptance"); } catch { } }}>
                <span style={{ minWidth: 0 }}><b>{c.name}</b><small>{c.qaId === me.id && ["awaiting", "in_progress"].includes(c.gates.qa.state) ? "QA decision" : c.review === "in_review" ? "Code review" : "Evidence to review"} · owner {personName(person(c.ownerId))}</small></span>
                <DueText c={c} />
              </a>
            ))}
          </div>
        </Section>
      )}

      {feedback.length > 0 && (
        <Section title="Feedback to act on" sub="Evidence that came back with changes requested">
          <div className="list-plain">{feedback.map(({ c, k, e }) => (
            <a key={e.id} href={"#c-" + c.id} className="li" onClick={() => { try { sessionStorage.setItem("apex-tab-" + c.id, "acceptance"); } catch { } }}>
              <span style={{ minWidth: 0 }}><b>{k.text}</b><small>{personName(person(e.reviewerId))}: {e.note}</small></span><Pill tone="warn">Changes requested</Pill>
            </a>
          ))}</div>
        </Section>
      )}

      {myBlockers.length > 0 && (
        <Section title="Blockers you are responsible for" sub="Other people are waiting on these">
          <div className="table-wrap"><table className="tbl"><thead><tr><th>Blocker</th><th>Component</th><th>Severity</th><th>Responsible</th><th>Next action</th><th>Target</th><th>Status</th></tr></thead><tbody>{myBlockers.map(b => <BlockerRow key={b.id} b={b} />)}</tbody></table></div>
        </Section>
      )}

      <Section title="Recent activity on your work">
        <div className="panel-body" style={{ paddingTop: 4 }}><div className="feed">
          {state.history.filter(h => state.components.some(c => c.id === h.entityId && (c.ownerId === me.id || c.reviewerId === me.id))).slice(0, 8).map(h => <HistoryLine key={h.id} h={h} showComponent />)}
        </div></div>
      </Section>
    </>
  );
}
