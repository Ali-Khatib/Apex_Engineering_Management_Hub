import React, { useMemo, useState } from "react";
import { useStore, useNav, useToast } from "../store";
import { Icon } from "../icons";
import { Button, Section, Pill, PersonChip, Empty, cx, useCan } from "../ui";
import { personName, fmtDate, ago, isDone, CHECK_LABEL } from "../logic";
import type { Component } from "../types";

/**
 * The QA workspace. Farouk should be able to open one page and see every
 * decision waiting on him, without opening 127 components to find out.
 *
 * The three gates stay independent throughout: passing checks never moves a
 * component into QA accepted, and QA acceptance never approves deployment.
 */
type QueueId = "to_submit" | "awaiting" | "in_progress" | "changes" | "rejected" | "accepted" | "deploy";

const QUEUES: { id: QueueId; label: string; help: string; tone: string }[] = [
  { id: "awaiting", label: "Waiting for QA", help: "Submitted and nobody has started reviewing yet. This is the queue that should stay short.", tone: "warn" },
  { id: "in_progress", label: "QA in progress", help: "You have started reviewing these.", tone: "info" },
  { id: "changes", label: "Changes requested", help: "Sent back to the engineer. Waiting on them, not on you.", tone: "crit" },
  { id: "rejected", label: "Rejected", help: "Did not meet acceptance. Still on record.", tone: "crit" },
  { id: "accepted", label: "QA accepted", help: "You have accepted the exact build. Deployment is a separate decision.", tone: "ok" },
  { id: "deploy", label: "Awaiting deployment decision", help: "QA is done. Someone with deployment authority has to approve. Not a QA decision.", tone: "review" },
  { id: "to_submit", label: "Not submitted yet", help: "Being built. Nothing for QA to do until the owner submits.", tone: "neutral" },
];

function queueOf(c: Component): QueueId {
  const { qa, deploy } = c.gates;
  if (deploy.state === "deployed") return "accepted";
  if (qa.state === "accepted") return deploy.state === "ready" || deploy.state === "scheduled" ? "accepted" : "deploy";
  if (qa.state === "rejected") return "rejected";
  if (qa.state === "changes_requested") return "changes";
  if (qa.state === "in_progress") return "in_progress";
  if (qa.state === "awaiting") return "awaiting";
  return "to_submit";
}

/** What QA has to look at, straight from the record. */
function evidenceState(c: Component) {
  const total = c.criteria.length;
  const accepted = c.criteria.filter(k => k.status === "accepted").length;
  const submitted = c.criteria.filter(k => k.status === "submitted").length;
  const none = c.criteria.filter(k => k.evidence.length === 0).length;
  return { total, accepted, submitted, none };
}

function QaCard({ c }: { c: Component }) {
  const { state, person } = useStore();
  const { go } = useNav();
  const can = useCan();
  const q = queueOf(c);
  const ev = evidenceState(c);
  const checks = c.gates.checks.state;
  const mine = can.qaDecide(c);
  const open = (tab: string) => { try { sessionStorage.setItem("apex-tab-" + c.id, tab); } catch { } go("c-" + c.id); };

  // Stated, not inferred: the next thing that has to happen on this component.
  const next = q === "awaiting" ? (checks === "failed" ? "Checks are failing. Ask the owner to fix them before QA time is spent." : "Start the review")
    : q === "in_progress" ? (ev.none ? `${ev.none} criteria still have no evidence` : "Accept, request changes, or reject")
      : q === "changes" ? "Waiting on the engineer to resubmit"
        : q === "rejected" ? "Waiting on the engineer"
          : q === "deploy" ? "Waiting on a deployment approval. Not yours to give."
            : q === "accepted" ? "Nothing outstanding"
              : "Waiting on the owner to submit";

  return (
    <div className={cx("qac", mine && (q === "awaiting" || q === "in_progress") && "is-mine")}>
      <div className="qac-top">
        <code className="cid">{c.id}</code>
        <button className="qac-name" onClick={() => open("acceptance")}>{c.name}</button>
        {!mine && <span className="qac-not" title={`QA contact is ${personName(person(c.qaId))}`}>QA: {personName(person(c.qaId)) || "nobody"}</span>}
      </div>
      <div className="qac-meta">
        <span>Engineer <b>{personName(person(c.ownerId)) || "unassigned"}</b></span>
        <span>Reviewer <b>{personName(person(c.reviewerId)) || "none"}</b></span>
        {c.gates.qa.at && <span>Submitted <b>{ago(c.gates.qa.at)}</b></span>}
        <span>Due <b>{fmtDate(c.due) || "no date"}</b></span>
      </div>

      {/* The three gates, side by side, never merged into one verdict. */}
      <div className="qac-gates">
        <span className={cx("qag", "g-" + checks)}><i />Checks: {CHECK_LABEL[checks] || checks}</span>
        <span className={cx("qag", "g-qa-" + c.gates.qa.state)}><i />QA: {c.gates.qa.state.replace(/_/g, " ")}</span>
        <span className={cx("qag", "g-dep-" + c.gates.deploy.state)}><i />Deploy: {c.gates.deploy.state.replace(/_/g, " ")}</span>
      </div>

      <div className="qac-ev">
        <span className="qac-evbar" aria-hidden>
          <i style={{ width: `${ev.total ? (ev.accepted / ev.total) * 100 : 0}%` }} />
        </span>
        <span>{ev.accepted}/{ev.total} criteria accepted{ev.submitted ? ` · ${ev.submitted} awaiting your decision` : ""}{ev.none ? ` · ${ev.none} with no evidence` : ""}</span>
      </div>

      <div className="qac-next"><span>Next</span>{next}</div>

      <div className="qac-act">
        <Button size="sm" onClick={() => open("acceptance")}>Open evidence</Button>
        {!mine && <span className="qac-locked"><Icon name="key" size={12} />Only the named QA contact can decide</span>}
      </div>
    </div>
  );
}

export function QA() {
  const { state, me } = useStore();
  const [onlyMine, setOnlyMine] = useState(true);
  const [queue, setQueue] = useState<QueueId | "">("");

  const pool = useMemo(() => state.components.filter(c => c.qaId || c.gates.qa.state !== "not_submitted"), [state.components]);
  const scoped = useMemo(() => onlyMine && me ? pool.filter(c => c.qaId === me.id) : pool, [pool, onlyMine, me]);
  const counts = useMemo(() => {
    const n = Object.fromEntries(QUEUES.map(q => [q.id, 0])) as Record<QueueId, number>;
    for (const c of scoped) n[queueOf(c)]++;
    return n;
  }, [scoped]);

  const list = useMemo(() => scoped.filter(c => !queue || queueOf(c) === queue), [scoped, queue]);
  const waiting = counts.awaiting + counts.in_progress;

  return (
    <>
      <header className="ph ph-row">
        <div>
          <h1>QA reviews</h1>
          <p className="lede">Every component that has reached QA, grouped by what has to happen to it next. Accepting QA and approving deployment are separate decisions and stay that way.</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className={cx("axis-chip", onlyMine && "on")} onClick={() => setOnlyMine(v => !v)} aria-pressed={onlyMine}>
            {onlyMine ? "Only mine" : "Everyone's"}
          </button>
        </div>
      </header>

      <div className={cx("qa-head", waiting > 0 && "has-work")}>
        <Icon name={waiting ? "alert" : "check"} size={16} />
        <span>{waiting > 0
          ? <><b>{waiting} component{waiting === 1 ? "" : "s"} need a QA decision</b> from {onlyMine ? "you" : "the QA contacts"}.</>
          : <><b>Nothing is waiting on QA</b>{onlyMine ? " from you" : ""} right now.</>}
        </span>
      </div>

      <div className="axis-row" role="group" aria-label="QA queue" style={{ marginBottom: 18 }}>
        <button className={cx("axis-chip", !queue && "on")} onClick={() => setQueue("")}>All<b>{scoped.length}</b></button>
        {QUEUES.map(q => (
          <button key={q.id} className={cx("axis-chip", "lc-" + q.tone, queue === q.id && "on")} onClick={() => setQueue(queue === q.id ? "" : q.id)} title={q.help} aria-pressed={queue === q.id}>
            <i aria-hidden />{q.label}<b>{counts[q.id]}</b>
          </button>
        ))}
      </div>

      {queue && <p className="axis-note" style={{ marginTop: -6 }}><Icon name="info" size={14} /><span>{QUEUES.find(q => q.id === queue)!.help}</span></p>}

      {list.length === 0 ? (
        <Empty icon="check" title={queue ? "Nothing in this queue" : onlyMine ? "Nothing is assigned to you for QA" : "Nothing has reached QA yet"}>
          {onlyMine && !queue ? "Switch to everyone's to see what other QA contacts are holding." : "Components appear here once their owner submits them for review."}
        </Empty>
      ) : (
        <div className="qa-grid">{list.map(c => <QaCard key={c.id} c={c} />)}</div>
      )}

      <Section title="How a component gets accepted" sub="Three independent approvals, in this order, each recorded with who decided and when">
        <ol className="qa-steps">
          <li><b>Automated checks</b><span>Build, tests, analysis. Run by the pipeline. Passing them proves the code compiles and the tests pass. It is not a quality decision and it never grants QA acceptance.</span></li>
          <li><b>QA acceptance</b><span>The named QA contact reviews the acceptance criteria against the evidence submitted for the exact build, then accepts, requests changes, or rejects. Only that person can decide.</span></li>
          <li><b>Deployment approval</b><span>A separate authority confirms dependencies, configuration and environment, then approves. QA acceptance does not approve deployment.</span></li>
        </ol>
      </Section>
    </>
  );
}
