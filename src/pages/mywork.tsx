import React from "react";
import { useStore, useNav } from "../store";
import { Icon } from "../icons";
import { Button, PageHeader, Section, Pill, PersonChip, StatusPill, PriorityPill, RiskPill, DueText, GateDots, Markdown, Empty, CopyText, KV, cx } from "../ui";
import { isDone, risk, daysUntil, fmtDate, personName, PRIORITY_ORDER, openBlockers, OPEN_BLOCKER, relDays } from "../logic";
import { HandoffCard, BlockerRow } from "./blockers";
import { HistoryLine } from "./activity";

export function MyWork() {
  const { state, me, person } = useStore();
  const { go, openComponents } = useNav();
  if (!me) return null;
  const owned = state.components.filter(c => c.ownerId === me.id && !isDone(c)).sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || a.due.localeCompare(b.due));
  const primary = owned[0];
  const others = owned.slice(1);
  const reviews = state.components.filter(c => !isDone(c) && ((c.reviewerId === me.id && (c.review === "in_review" || c.criteria.some(k => k.status === "submitted"))) || (c.qaId === me.id && ["awaiting", "in_progress"].includes(c.gates.qa.state))));
  const myBlockers = state.blockers.filter(b => OPEN_BLOCKER(b) && b.responsibleId === me.id);
  const handoffs = state.handoffs.filter(h => h.toId === me.id && h.status === "awaiting_ack");
  const feedback = owned.flatMap(c => c.criteria.flatMap(k => k.evidence.filter(e => e.decision && e.decision !== "approved").map(e => ({ c, k, e }))));
  const done = state.components.filter(c => c.ownerId === me.id && isDone(c));
  const repo = primary && state.repos.find(r => r.id === primary.repoId);
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const unassigned = state.components.filter(c => !c.ownerId && !isDone(c));
  return (
    <>
      <PageHeader title={`${greet}, ${me.first}`} sub={owned.length ? `You own ${owned.length} active component${owned.length > 1 ? "s" : ""}${reviews.length ? ` and ${reviews.length} review${reviews.length > 1 ? "s are" : " is"} waiting on you` : ""}.` : "You don't own any active components yet."} />

      {handoffs.map(h => <HandoffCard key={h.id} h={h} />)}

      {primary ? (
        <div className="mw-primary">
          <div className="mw-primary-head">
            <div className="row-between">
              <span className="eyebrow" style={{ margin: 0 }}>Your primary component <code className="cid">{primary.id}</code></span>
              <span className="row"><StatusPill s={primary.status} /><PriorityPill p={primary.priority} /><RiskPill c={primary} /></span>
            </div>
            <h2><a href={"#c-" + primary.id} style={{ color: "inherit" }}>{primary.name}</a></h2>
            <p style={{ color: "var(--fg-2)", maxWidth: "80ch" }}>{primary.purpose}</p>
            <div className="row"><a href={"#c-" + primary.id} className="btn btn-primary btn-md">Open component</a>{repo && <a className="btn btn-secondary btn-md" href={repo.url} target="_blank" rel="noopener"><Icon name="github" />Repository</a>}</div>
          </div>
          <div className="pack">
            <div className="pack-sec"><h4>Deliverable</h4><p style={{ color: "var(--fg)" }}>{primary.deliverable}</p></div>
            <div className="pack-sec"><h4>Dates</h4><dl><KV k="Due"><DueText c={primary} /></KV><KV k="ETA">{fmtDate(primary.eta)}</KV></dl></div>
            <div className="pack-sec"><h4>Start here</h4>{repo ? <dl><KV k="Repository"><CopyText text={repo.url}>{repo.name}</CopyText></KV><KV k="Branch"><CopyText text={primary.onboarding.branch} /></KV><KV k="Setup"><a href={"#c-" + primary.id} onClick={() => { try { sessionStorage.setItem("apex-tab-" + primary.id, "onboarding"); } catch { } }}>Full onboarding pack →</a></KV></dl> : <span className="muted">No repository yet. See the onboarding pack.</span>}</div>
            <div className="pack-sec"><h4>People</h4><dl><KV k="Reviewer"><PersonChip id={primary.reviewerId} /></KV><KV k="QA"><PersonChip id={primary.qaId} empty="No QA contact" /></KV></dl></div>
            <div className="pack-sec"><h4>Dependencies</h4>{primary.deps.length ? <div className="deps">{primary.deps.map(d => { const x = state.components.find(z => z.id === d)!; return <a key={d} href={"#c-" + d} className="dep"><span className="dep-name"><span>{x.name}</span><small>{personName(person(x.ownerId))} · due {fmtDate(x.due)}</small></span><StatusPill s={x.status} /></a>; })}</div> : <span className="muted">None</span>}</div>
            <div className="pack-sec"><h4>Acceptance</h4>
              <div style={{ display: "grid", gap: 8 }}>
                <div className="row" style={{ gap: 10 }}><div className="progress" style={{ flex: 1 }}><i style={{ width: `${primary.criteria.length ? primary.criteria.filter(k => k.status === "accepted").length / primary.criteria.length * 100 : 0}%` }} /></div><span className="muted tnum" style={{ fontSize: 13 }}>{primary.criteria.filter(k => k.status === "accepted").length}/{primary.criteria.length}</span></div>
                <GateDots c={primary} showLabel />
                {openBlockers(state, primary.id).length > 0 && <span style={{ color: "var(--crit)", fontSize: 13 }}><Icon name="blockers" size={13} /> {openBlockers(state, primary.id).length} open blocker(s)</span>}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <Section title="Nothing assigned to you yet">
          <div className="panel-body" style={{ display: "grid", gap: 16 }}>
            <div className="mw-how">
              <p>Work reaches you by assignment. An admin ({state.people.filter(p => p.role === "admin").map(p => p.first).join(", ")}) gives you a component; from that moment it is yours to build, and this page becomes your starting point — deliverable, repository, branch, dependencies, reviewer, acceptance criteria and deadline, all in one place.</p>
              <p>Until then there is nothing for you to do here. Nothing below is yours.</p>
            </div>
            <div>
              <h4 className="mw-sub">Waiting for an owner <span>{unassigned.length} components</span></h4>
              <p className="muted" style={{ fontSize: 13, margin: "0 0 10px" }}>Not assigned to you — shown so you can see what is open and ask for one by name.</p>
              <div className="deps">{unassigned.slice(0, 5).map(c => <a key={c.id} href={"#c-" + c.id} className="dep"><span className="dep-name"><span>{c.name}</span><small>{c.id} · {c.category}</small></span><PriorityPill p={c.priority} /></a>)}</div>
              {unassigned.length > 5 && <a href="#library" className="btn btn-secondary btn-sm" style={{ marginTop: 10 }}>See all {unassigned.length} unassigned components</a>}
            </div>
          </div>
        </Section>
      )}

      <div className="grid-2">
        <Section title="Waiting on you" sub="Reviews, QA and evidence decisions">
          <div className="list-plain">
            {reviews.length === 0 && <Empty icon="check" title="No reviews waiting" />}
            {reviews.map(c => (
              <a key={c.id} href={"#c-" + c.id} className="li" onClick={() => { try { sessionStorage.setItem("apex-tab-" + c.id, "acceptance"); } catch { } }}>
                <span style={{ minWidth: 0 }}><b>{c.name}</b><small>{c.qaId === me.id && ["awaiting", "in_progress"].includes(c.gates.qa.state) ? "QA decision" : c.review === "in_review" ? "Code review" : "Evidence to review"} · owner {personName(person(c.ownerId))}</small></span>
                <DueText c={c} />
              </a>
            ))}
          </div>
        </Section>
        <Section title="Other components you own">
          <div className="list-plain">
            {others.length === 0 && <Empty icon="components" title={primary ? "Just your primary component" : "None"}>{primary ? "One primary component at a time keeps focus." : undefined}</Empty>}
            {others.map(c => <a key={c.id} href={"#c-" + c.id} className="li"><span style={{ minWidth: 0 }}><b>{c.name}</b><small>{c.id} · <StatusPill s={c.status} /></small></span><DueText c={c} /></a>)}
            {done.length > 0 && <span className="muted" style={{ fontSize: 12.5 }}>{done.length} completed: {done.map(c => c.name).join(", ")}</span>}
          </div>
        </Section>
      </div>

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
        <Section title="Blockers you're responsible for" sub="Others are waiting on these">
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
