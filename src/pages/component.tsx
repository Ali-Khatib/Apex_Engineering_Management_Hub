import React, { useEffect, useMemo, useRef, useState } from "react";
import { useStore, useNav, useToast } from "../store";
import { Icon } from "../icons";
import {
  Button, Pill, PersonChip, StatusPill, PriorityPill, RiskPill, DueText, Tabs, Section, Markdown, MarkdownEditor, Modal, Field,
  ConfirmButton, Menu, MenuItem, Avatar, cx, Empty, KV, CopyText, CHECK_TONE, QA_TONE, DEPLOY_TONE, label, StagePill, useCan, OwnerState } from "../ui";
import { risk, deployBlockers, isDone, openBlockers, fmtDate, fmtDateTime, ago, daysUntil, personName, STATUS_LABEL, stage, relDays } from "../logic";
import { GateDots } from "../ui";
import { LayerOfTag, WaveTag, SpChip, SOURCE_LABEL } from "./lib";
import { LifecyclePill } from "../ui";
import { WAVES } from "../seed";
import { Fact, Missing, Contract, ArchitectureMap, DependencyCard, NextActionBar, BlockerAlarm, YourPart } from "./componentSpec";
import { EditComponentModal, AssignModal } from "./componentForms";
import { GovernanceTab } from "./hq";
import { BlockerModal, BlockerRow, HandoffCard } from "./blockers";
import { HistoryLine } from "./activity";
import type { Component, Criterion, Evidence, LinkKind, Status } from "../types";

const LINK_META: Record<LinkKind, { icon: string; label: string; role: string }> = {
  github: { icon: "github", label: "GitHub", role: "Source code, pull requests, CI" },
  erpnext: { icon: "erpnext", label: "ERPNext", role: "Project & task record" },
  slack: { icon: "slack", label: "Slack", role: "Discussion & decisions" },
  drive: { icon: "drive", label: "Google Drive", role: "Specs & documents" },
  sheets: { icon: "sheets", label: "Google Sheets", role: "Planning & allocation data" },
};

export function ComponentPage({ id }: { id: string }) {
  const { state, component, person, me, isAdmin, apiMode, loadComponentDetail, deleteComponent, updateComponent, submitForReview } = useStore();
  const { go } = useNav();
  const { toast } = useToast();
  const can = useCan();
  const c = component(id);
  useEffect(() => {
    if (c) void loadComponentDetail(id);
  }, [id, c?.id, loadComponentDetail]);
  const [tab, setTab] = useState(() => { try { return sessionStorage.getItem("apex-tab-" + id) || "overview"; } catch { return "overview"; } });
  useEffect(() => { try { sessionStorage.setItem("apex-tab-" + id, tab); } catch { } }, [tab, id]);
  const [modal, setModal] = useState<"" | "edit" | "assign" | "blocker">("");
  if (!c) return <Section><Empty icon="components" title={`Component ${id} doesn't exist`} action={<Button onClick={() => go("components")}>Back to components</Button>}>It may have been deleted. Deleted components stay in the activity history.</Empty></Section>;

  const project = state.projects.find(p => p.id === c.projectId);
  const r = risk(state, c);
  const ob = openBlockers(state, c.id);
  const acc = c.criteria.filter(k => k.status === "accepted").length;
  const isOwner = c.ownerId === me?.id;
  const canStatus = isAdmin || isOwner;
  const transitions: [Status, string][] = ([["not_started", "Not started"], ["in_progress", "In progress"], ["blocked", "Blocked"], ["under_review", "Submit for review"], ["completed", "Completed"]] as [Status, string][])
    .filter(([s]) => s !== c.status && (isAdmin || s !== "completed"));

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "architecture", label: "Design diagrams", count: c.lib?.diagrams.length || undefined },
    { id: "onboarding", label: "Getting started" },
    { id: "acceptance", label: "Readiness" },
    { id: "governance", label: "Spec & contract" },
    { id: "github", label: "GitHub" },
    { id: "comments", label: "Discussion", count: c.comments.length || undefined },
  ];
  const cur = tabs.some(t => t.id === tab) ? tab : "overview";

  return (
    <>
      <div className="comp-hero">
        <div className="row-between" style={{ alignItems: "flex-start" }}>
          <div style={{ minWidth: 0, flex: "1 1 480px" }}>
            <div className="ctags"><code className="cid cid-lg">{c.id}</code><StatusPill s={c.status} /><LayerOfTag c={c} />{c.lib && <span className="srctag">{SOURCE_LABEL[c.projectId]}</span>}</div>
            <h1>{c.name}</h1>
            <p className="lead">{c.summary}</p>
          </div>
          <div className="page-actions">
            {canStatus && (
              <Menu trigger={(o, t) => <Button icon="flag" iconRight="chevronDown" onClick={t} aria-expanded={o}>Status</Button>}>
                {close => <>{transitions.map(([s, l]) => <MenuItem key={s} onClick={() => {
                  close();
                  void (async () => {
                    const saved = s === "under_review"
                      ? await submitForReview(c.id)
                      : await updateComponent(c.id, { status: s });
                    if (saved) toast(s === "under_review" ? "Submitted for review" : `Status: ${STATUS_LABEL[s]}`);
                  })();
                }}>{l}</MenuItem>)}</>}
              </Menu>
            )}
            {isAdmin && <Button variant="primary" icon="edit" onClick={() => setModal("edit")}>Edit</Button>}
            <Menu trigger={(o, t) => <Button icon="more" onClick={t} aria-label="More actions" aria-expanded={o} />}>
              {close => <>
                <MenuItem icon="blockers" onClick={() => { close(); setModal("blocker"); }}>Add blocker</MenuItem>
                {isAdmin && <MenuItem icon="team" onClick={() => { close(); setModal("assign"); }}>Assign people</MenuItem>}
                {isAdmin && <><div className="menu-sep" /><div style={{ padding: 4 }}><ConfirmButton label="Delete component" confirmText="Delete" onConfirm={() => {
                  close();
                  void (async () => {
                    if (await deleteComponent(c.id)) { toast(`${c.id} deleted`); go("components"); }
                  })();
                }} /></div></>}
              </>}
            </Menu>
          </div>
        </div>

        <dl className="summary summary-5">
          <div><dt>Lifecycle <i className="dt-q" title="How far the work has actually got. Derived from owner, dependencies and status.">?</i></dt><dd><LifecyclePill c={c} help /></dd></div>
          <div><dt>Planning wave <i className="dt-q" title="The source sheet's planning classification, from the component map of 20 October 2026. Independent of lifecycle.">?</i></dt><dd><WaveTag wave={c.lib?.wave} /> <span className="muted" style={{ fontSize: 12 }}>{WAVES.find(w => w.id === c.lib?.wave)?.hint}</span></dd></div>
          <div><dt>Owner</dt><dd><PersonChip id={c.ownerId} /></dd></div>
          <div><dt>Builds on</dt><dd className="spwrap">{c.lib?.sps.length ? c.lib.sps.map(s => <SpChip key={s} id={s} />) : <span className="muted">No SP module yet</span>}</dd></div>
          <div><dt>Ready to ship?</dt><dd><GateDots c={c} showLabel /></dd></div>
        </dl>
        {r.reasons.length > 0 && !isDone(c) && (
          <div className="row" style={{ gap: 8, fontSize: 13, color: r.level === "blocked" ? "var(--crit)" : "var(--warn)", marginTop: -6 }}>
            <Icon name="alert" size={15} /><span>{r.reasons.join(" · ")}</span>
          </div>
        )}
        <Tabs tabs={tabs} value={cur} onChange={setTab} />
      </div>

      {cur === "overview" && <OverviewTab c={c} onTab={setTab} onBlocker={() => setModal("blocker")} />}
      {cur === "onboarding" && (c.lib ? <StartTab c={c} /> : <OnboardingTab c={c} />)}
      {cur === "acceptance" && <AcceptanceTab c={c} />}
      {cur === "governance" && <GovernanceTab c={c} />}
      {cur === "github" && <GithubTab c={c} />}
      {cur === "architecture" && (c.lib ? <DesignsTab c={c} /> : <ArchitectureTab c={c} />)}
      {cur === "comments" && <div className="stack-v"><CommentsTab c={c} /><Section title="History" sub="Platform and GitHub events, newest first"><div className="panel-body"><div className="feed">{state.history.filter(h => h.entityId === c.id).slice(0, 25).map(h => <HistoryLine key={h.id} h={h} />)}</div></div></Section></div>}

      {modal === "edit" && <EditComponentModal c={c} onClose={() => setModal("")} />}
      {modal === "assign" && <AssignModal c={c} onClose={() => setModal("")} />}
      {modal === "blocker" && <BlockerModal componentId={c.id} onClose={() => setModal("")} />}
    </>
  );
}

// ───────────── Overview ─────────────
function OverviewTab({ c, onTab, onBlocker }: { c: Component; onTab: (t: string) => void; onBlocker: () => void }) {
  const { state, isAdmin, apiMode, person, updateComponent, removeLink } = useStore();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.details);
  const [savingDetails, setSavingDetails] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const can = useCan();
  const repo = state.repos.find(r => r.id === c.repoId);
  const deps = c.deps.map(d => state.components.find(x => x.id === d)!).filter(Boolean);
  const dependents = state.components.filter(x => x.deps.includes(c.id));
  const acc = c.criteria.filter(k => k.status === "accepted").length;
  const depRow = (d: Component) => (
    <a key={d.id} href={"#c-" + d.id} className="dep">
      <span className="dep-name"><span>{d.name}</span><small>{d.id} · {d.ownerId ? (d.ownerId === state.me ? "You" : personName(person(d.ownerId))) : "Unassigned"}{d.lib ? ` · ${d.lib.wave}` : ""}</small></span>
      <StatusPill s={d.status} />
    </a>
  );
  const lib = c.lib;
  return (
    <div className="split">
      <div className="stack-v">
        <NextActionBar c={c} />
        {apiMode
          ? <p className="muted" style={{ fontSize: 13 }}>Open blockers for this component are listed on the Blockers page.</p>
          : <BlockerAlarm c={c} onAdd={onBlocker} />}

        {/* Purpose, contract and architecture describe the same component from
            three angles, so they are one surface divided by rules, not three
            bordered panels stacked on each other. */}
        <section className="spec">
          <header className="spec-head"><h2>What this is</h2><span>Its purpose, what it does, and where it sits</span></header>
          <div className="spec-body">
            <p className="spec-lede">{c.purpose || c.summary}</p>
            <dl className="facts">
              <Fact label="Who uses it">{lib?.users || <Missing what="users" />}</Fact>
              <Fact label="When to build it">{lib?.trigger || <Missing what="trigger" />}</Fact>
              <Fact label="Expected deliverable" wide>{c.deliverable || <Missing what="deliverable" />}</Fact>
              {lib?.mapping && <Fact label="Reuse before building" wide>{lib.mapping}</Fact>}
            </dl>
          </div>

          {lib && (
            <div className="spec-part">
              <h3 className="spec-sub">What it does</h3>
              <Contract c={c} />
            </div>
          )}

          <div className="spec-part">
            <h3 className="spec-sub">Where it sits <span>select a node to open it</span></h3>
            <ArchitectureMap c={c} />
          </div>
        </section>

        <section className="spec">
          <header className="spec-head">
            <h2>Acceptance criteria</h2>
            <span>{c.criteria.filter(k => k.status === "accepted").length} of {c.criteria.length} accepted · each needs its own evidence</span>
          </header>
          <div className="spec-body">
            {c.criteria.length === 0 ? <Missing what="acceptance criteria" /> : (
              <ol className="acl">
                {c.criteria.map(k => (
                  <li key={k.id} className={cx("acl-item", "s-" + k.status)}>
                    <div className="acl-t"><b>{k.text}</b><CritStatusPill k={k} /></div>
                    <dl className="facts facts-tight">
                      <Fact label="Verified by">{k.verification}</Fact>
                      <Fact label="Evidence">{k.evidenceType}</Fact>
                    </dl>
                  </li>
                ))}
              </ol>
            )}
            <button className="spec-link" onClick={() => onTab("acceptance")}>Open readiness and evidence <Icon name="arrowRight" size={13} /></button>
          </div>
        </section>

        {(lib?.constraints || lib?.overlap || lib?.metric || lib?.test) && (
          <section className="spec">
            <header className="spec-head"><h2>Open questions &amp; measurement</h2><span>Recorded in the component map, not yet resolved</span></header>
            <div className="spec-body spec-body-flush">
              {lib?.constraints && <div className="note note-warn"><h3>Constraints and open questions</h3><p>{lib.constraints}</p></div>}
              {lib?.overlap && <div className="note note-info"><h3>Overlap review</h3><p>{lib.overlap}</p></div>}
              {(lib?.metric || lib?.test) && (
                <dl className="facts facts-pad">
                  {lib?.metric && <Fact label="Measured by" wide>{lib.metric}</Fact>}
                  {lib?.test && <Fact label="Failure-case test" wide>{lib.test}</Fact>}
                </dl>
              )}
            </div>
          </section>
        )}

        {/* The generated document is kept, folded away, and still editable. */}
        <details className="spec-raw">
          <summary><Icon name="chevronRight" size={13} />Full written specification<em>updated {ago(c.updatedAt)}</em></summary>
          <div className="spec-raw-body">
            {editing ? (
              <div style={{ display: "grid", gap: 12 }}>
                <MarkdownEditor value={draft} onChange={setDraft} rows={18} />
                <div className="row" style={{ justifyContent: "flex-end" }}><Button variant="ghost" disabled={savingDetails} onClick={() => setEditing(false)}>Cancel</Button><Button variant="primary" icon="check" disabled={savingDetails} onClick={() => {
                  void (async () => {
                    setSavingDetails(true);
                    try {
                      if (await updateComponent(c.id, { details: draft })) { setEditing(false); toast("Details saved"); }
                    } finally { setSavingDetails(false); }
                  })();
                }}>{savingDetails ? "Saving…" : "Save details"}</Button></div>
              </div>
            ) : (
              <>
                {isAdmin && <div className="row" style={{ justifyContent: "flex-end" }}><Button size="sm" icon="edit" onClick={() => { setDraft(c.details); setEditing(true); }}>Edit details</Button></div>}
                <Markdown src={c.details} />
              </>
            )}
          </div>
        </details>
      </div>
      <div className="stack-v">
        <YourPart c={c} />
        <Section title="Needs these first" sub={deps.length ? "Nothing here can be skipped: each must finish before this ships" : undefined}>
          <div className="panel-body" style={{ display: "grid", gap: 10 }}>
            {deps.length ? deps.map(d => <DependencyCard key={d.id} d={d} direction="needs" />) : <span className="muted" style={{ fontSize: 13 }}>No dependencies recorded.</span>}
          </div>
        </Section>
        {dependents.length > 0 && (
          <Section title="Waiting on this" sub={`${dependents.length} component${dependents.length > 1 ? "s" : ""} cannot finish until this one does`}>
            <div className="panel-body" style={{ display: "grid", gap: 10 }}>
              {dependents.slice(0, 6).map(d => <DependencyCard key={d.id} d={d} direction="feeds" />)}
              {dependents.length > 6 && <a href="#map" style={{ fontSize: 13 }}>See all {dependents.length} in build order →</a>}
            </div>
          </Section>
        )}
        <Section title="Linked systems" sub="Each system keeps its own records" actions={(apiMode ? isAdmin : can.ownerOrAdmin(c)) && <Button size="sm" icon="plus" variant="ghost" onClick={() => setLinkOpen(true)}>Link</Button>}>
          <div className="panel-body"><div className="links">
            {c.links.length === 0 && <span className="muted" style={{ fontSize: 13 }}>No linked records.</span>}
            {c.links.map(l => (
              <div key={l.id} className="row" style={{ flexWrap: "nowrap", gap: 4 }}>
                <a href={l.url} target="_blank" rel="noopener" className="xlink" style={{ flex: 1, minWidth: 0 }}>
                  <span className="xlink-ic"><Icon name={LINK_META[l.kind].icon} size={15} /></span>
                  <span style={{ minWidth: 0 }}><b>{l.label}</b><small>{LINK_META[l.kind].label} · {LINK_META[l.kind].role}</small></span>
                  <Icon name="external" size={13} className="muted" />
                </a>
                {(apiMode ? isAdmin : can.ownerOrAdmin(c)) && <Button size="sm" variant="ghost" icon="x" aria-label={`Remove ${l.label}`} onClick={() => {
                  void (async () => { if (await removeLink(c.id, l.id)) toast("Link removed"); })();
                }} />}
              </div>
            ))}
          </div></div>
        </Section>
      </div>
      {linkOpen && <LinkModal c={c} onClose={() => setLinkOpen(false)} />}
    </div>
  );
}

function LinkModal({ c, onClose, kind = "erpnext" }: { c: Component; onClose: () => void; kind?: LinkKind }) {
  const { addLink, apiMode } = useStore();
  const { toast } = useToast();
  const [f, setF] = useState({ kind, label: "", url: "", ref: "" });
  const [err, setErr] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (saving) return;
    const e: Record<string, string> = {};
    if (!apiMode && !f.label.trim()) e.label = "Give the link a label people will recognise.";
    if (!/^https:\/\/\S+$/.test(f.url.trim())) e.url = "Use a full https:// link.";
    setErr(e); if (Object.keys(e).length) return;
    setSaving(true);
    try {
      if (await addLink(c.id, { ...f, label: f.label.trim() || LINK_META[f.kind].label, url: f.url.trim(), ref: f.ref.trim() || f.label.trim() })) {
        toast("Linked"); onClose();
      }
    } finally { setSaving(false); }
  };
  return (
    <Modal title="Link an external record" sub="The record stays in its own system; this adds a reference." onClose={onClose} footer={<><Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button><Button variant="primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Add link"}</Button></>}>
      <Field label="System"><select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value as LinkKind })}>{(Object.keys(LINK_META) as LinkKind[]).map(k => <option key={k} value={k}>{LINK_META[k].label} — {LINK_META[k].role}</option>)}</select></Field>
      {!apiMode && <Field label="Label" error={err.label}><input type="text" value={f.label} onChange={e => setF({ ...f, label: e.target.value })} placeholder="e.g. Task PROJ-0042-T-140" /></Field>}
      <Field label="URL" error={err.url}><input type="url" value={f.url} onChange={e => setF({ ...f, url: e.target.value })} placeholder="https://" /></Field>
      {!apiMode && <Field label="External record ID" hint="Optional"><input type="text" value={f.ref} onChange={e => setF({ ...f, ref: e.target.value })} /></Field>}
      {apiMode && <p className="muted" style={{ fontSize: 13 }}>The backend stores one URL per system; labels and external record IDs are not stored.</p>}
    </Modal>
  );
}

// ───────────── Onboarding pack ─────────────
function OnboardingTab({ c }: { c: Component }) {
  const { state, person } = useStore();
  const repo = state.repos.find(r => r.id === c.repoId);
  const owner = person(c.ownerId);
  const deps = c.deps.map(d => state.components.find(x => x.id === d)!).filter(Boolean);
  return (
    <section className="panel">
      <div className="panel-head" style={{ paddingBottom: 16 }}>
        <div><h2>Onboarding pack{owner ? ` for ${owner.first}` : ""}</h2><p>Everything needed to start, build and deliver {c.name} without hunting through Slack.</p></div>
        <div className="panel-actions">{repo && <a className="btn btn-secondary btn-md" href={repo.url} target="_blank" rel="noopener"><Icon name="github" />Open repository</a>}</div>
      </div>
      <div className="pack">
        <div className="pack-sec"><h4><span className="k">A</span>Component</h4>
          <dl>
            <KV k="Purpose">{c.purpose}</KV>
            <KV k="Project">{state.projects.find(p => p.id === c.projectId)?.name}</KV>
            <KV k="Category">{c.category}</KV>
            {c.skills.length > 0 && <KV k="Skills"><span className="row" style={{ gap: 4 }}>{c.skills.map(s => <Pill key={s} tone="neutral">{s}</Pill>)}</span></KV>}
          </dl>
        </div>
        <div className="pack-sec"><h4><span className="k">B</span>Repository</h4>
          {repo ? <dl>
            <KV k="Repository"><CopyText text={repo.url}>{repo.org}/{repo.name}</CopyText></KV>
            <KV k="Default branch"><code>{repo.defaultBranch}</code></KV>
            <KV k="Your branch"><CopyText text={c.onboarding.branch} /></KV>
            <KV k="Focus folders"><span className="row" style={{ gap: 4 }}>{c.onboarding.folders.map(f => <code key={f} className="cid">{f}</code>)}</span></KV>
            <KV k="Access"><Pill tone={repo.access === "connected" ? "ok" : "warn"}>{repo.access === "connected" ? "Verified" : label(repo.access)}</Pill></KV>
          </dl> : <Empty icon="repo" title="No repository linked">{c.onboarding.setup.split("\n")[0]}</Empty>}
        </div>
        <div className="pack-sec pack-wide"><h4><span className="k">C</span>Getting started</h4>
          <div className="grid-2" style={{ gap: 20 }}>
            <Markdown src={c.onboarding.setup} />
            <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
              {c.onboarding.tools.length > 0 && <div><span className="muted" style={{ fontSize: 12 }}>Required tools</span><div className="row" style={{ gap: 4, marginTop: 6 }}>{c.onboarding.tools.map(t => <Pill key={t} tone="faint">{t}</Pill>)}</div></div>}
              {c.onboarding.env.length > 0 && <div><span className="muted" style={{ fontSize: 12 }}>Environment variables · names and purpose only, values live in Vault</span>
                <table className="envs" style={{ marginTop: 6 }}><tbody>{c.onboarding.env.map(e => <tr key={e.name}><td><code>{e.name}</code></td><td className="muted">{e.purpose}</td></tr>)}</tbody></table></div>}
            </div>
          </div>
        </div>
        <div className="pack-sec"><h4><span className="k">D</span>Dependencies</h4>
          {deps.length ? <div className="deps">{deps.map(d => <a key={d.id} href={"#c-" + d.id} className="dep"><span className="dep-name"><span>{d.name}</span><small>Owner {personName(person(d.ownerId))}</small></span><StatusPill s={d.status} /></a>)}</div> : <span className="muted">None. You can start immediately.</span>}
          {repo && repo.frameworks.length > 0 && <div style={{ marginTop: 12 }}><span className="muted" style={{ fontSize: 12 }}>Libraries & frameworks</span><div className="row" style={{ gap: 4, marginTop: 6 }}>{repo.frameworks.map(f => <Pill key={f} tone="neutral">{f}</Pill>)}</div></div>}
        </div>
        <div className="pack-sec"><h4><span className="k">E</span>Responsibilities</h4>
          <dl>
            <KV k="Engineer"><PersonChip id={c.ownerId} /></KV>
            <KV k="Reviewer"><PersonChip id={c.reviewerId} empty="No reviewer" /></KV>
            <KV k="QA"><PersonChip id={c.qaId} empty="No QA contact" /></KV>
            <KV k="Project manager"><PersonChip id={repo?.pmId} /></KV>
          </dl>
        </div>
        <div className="pack-sec"><h4><span className="k">F</span>Expected deliverable</h4><p style={{ fontSize: 14, color: "var(--fg)" }}>{c.deliverable}</p></div>
        <div className="pack-sec"><h4><span className="k">G</span>Dates</h4>
          <dl>
            <KV k="Start">{fmtDate(c.start)}</KV>
            <KV k="Target">{fmtDate(c.due)} <span className="muted">· {relDays(c.due)}</span></KV>
            <KV k="ETA">{fmtDate(c.eta)}</KV>
            <KV k="Review by">{fmtDate(new Date(new Date(c.due + "T00:00:00").getTime() - 3 * 86400000).toISOString().slice(0, 10))}</KV>
          </dl>
        </div>
        <div className="pack-sec pack-wide"><h4><span className="k">H</span>Acceptance criteria, and what “done” means</h4>
          {c.criteria.length ? <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 6 }}>{c.criteria.map(k => <li key={k.id}>{k.text} <span className="muted">· evidence: {k.evidenceType.toLowerCase()}</span></li>)}</ol> : <span className="muted">Not defined yet. Ask the reviewer before starting.</span>}
        </div>
      </div>
    </section>
  );
}

// ───────────── Acceptance & gates ─────────────
function CritCheck({ k }: { k: Criterion }) {
  const cls = { accepted: "acc", submitted: "sub", changes_requested: "chg", rejected: "rej", in_progress: "", not_started: "" }[k.status];
  const ic = { accepted: "check", submitted: "clock", changes_requested: "refresh", rejected: "x", in_progress: "", not_started: "" }[k.status];
  return <span className={cx("crit-check", cls)} aria-hidden>{ic && <Icon name={ic} size={13} />}</span>;
}
function CritStatusPill({ k }: { k: Criterion }) {
  const tone = { accepted: "ok", submitted: "review", changes_requested: "warn", rejected: "crit", in_progress: "info", not_started: "faint" }[k.status];
  const l = { accepted: "Accepted", submitted: "Evidence submitted", changes_requested: "Changes requested", rejected: "Rejected", in_progress: "In progress", not_started: "Not started" }[k.status];
  return <Pill tone={tone}>{l}</Pill>;
}

function NoteModal({ title, sub, cta, tone = "primary", required, onSave, onClose }: { title: string; sub?: string; cta: string; tone?: "primary" | "danger"; required?: boolean; onSave: (n: string) => void | boolean | Promise<void | boolean>; onClose: () => void }) {
  const [n, setN] = useState(""); const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (saving) return;
    if (required && !n.trim()) { setErr("Add a note so the owner knows what to do next."); return; }
    setSaving(true);
    try {
      if (await onSave(n.trim()) !== false) onClose();
    } finally { setSaving(false); }
  };
  return (
    <Modal title={title} sub={sub} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button><Button variant={tone} onClick={save} disabled={saving}>{saving ? "Saving…" : cta}</Button></>}>
      <Field label={required ? "Note" : "Note (optional)"} error={err}><textarea rows={4} value={n} onChange={e => setN(e.target.value)} /></Field>
    </Modal>
  );
}

function AcceptanceTab({ c }: { c: Component }) {
  const { state, me, isAdmin, apiMode, person, setQA, setDeploy, setReview, submitForReview, addCriterion, removeCriterion } = useStore();
  const { toast } = useToast();
  const can = useCan();
  const [open, setOpen] = useState<string | null>(c.criteria.find(k => k.status !== "accepted")?.id || null);
  const [note, setNote] = useState<null | { title: string; sub?: string; cta: string; tone?: "primary" | "danger"; required?: boolean; run: (n: string) => void | boolean | Promise<void | boolean> }>(null);
  const [evFor, setEvFor] = useState<Criterion | null>(null);
  const [critOpen, setCritOpen] = useState(false);
  const repo = state.repos.find(r => r.id === c.repoId);
  const unmet = deployBlockers(state, c);
  const g = c.gates;
  const isQA = apiMode
    ? (isAdmin || (c.qaId ? c.qaId === me?.id : c.ownerId !== me?.id))
    : can.qaDecide(c);
  const canDeploy = can.deployApprove();
  const isReviewer = isAdmin || c.reviewerId === me?.id;
  const acc = c.criteria.filter(k => k.status === "accepted").length;

  return (
    <div className="stack-v">
      <div className="gate-cards">
        <div className={cx("gate-card", g.checks.state === "passed" && "on", g.checks.state === "failed" && "bad")}>
          <h4><span className="gate-num">1</span>Checks passed<Pill tone={CHECK_TONE[g.checks.state]} className="" >{label(g.checks.state)}</Pill></h4>
          <span className="meta">From GitHub Actions{g.checks.commit ? <> on <code className="sha">{g.checks.commit.slice(0, 7)}</code></> : ""}{g.checks.at ? ` · ${ago(g.checks.at)}` : ""}</span>
          {repo?.github.runs.length ? <div style={{ display: "grid", gap: 4 }}>{repo.github.runs.map(run => <div key={run.name} className="row-between" style={{ fontSize: 12 }}><span className="row" style={{ gap: 6 }}><i className="pill-dot" style={{ color: `var(--${CHECK_TONE[run.state] === "ok" ? "ok" : CHECK_TONE[run.state] === "crit" ? "crit" : "fg-4"})` }} />{run.name}{run.required && <span className="muted">required</span>}</span><span className="muted">{label(run.state)}</span></div>)}</div> : <span className="meta">{!repo ? "Link a repository to track checks." : repo.githubActivityLoaded === false ? "GitHub runs have not been loaded from the API." : "No runs recorded."}</span>}
          <span className="meta" style={{ borderTop: "1px solid var(--line)", paddingTop: 8 }}><Icon name="lock" size={12} /> Read-only. Never changes QA status.</span>
        </div>
        <div className={cx("gate-card", g.qa.state === "accepted" && "on", ["rejected", "changes_requested"].includes(g.qa.state) && "bad")}>
          <h4><span className="gate-num">2</span>QA accepted<Pill tone={QA_TONE[g.qa.state]}>{label(g.qa.state)}</Pill></h4>
          <span className="meta">{g.qa.by ? <>{personName(person(g.qa.by))} · {fmtDateTime(g.qa.at)}</> : `QA contact: ${personName(person(c.qaId))}`}</span>
          {g.qa.note && <p className="ev-note">{g.qa.note}</p>}
          <span className="meta">{apiMode ? "QA is recorded as one component-level decision." : `${acc} of ${c.criteria.length} criteria accepted`}</span>
          {isQA ? <div className="row" style={{ gap: 6 }}>
            {!apiMode && (g.qa.state === "awaiting" || g.qa.state === "not_submitted" || g.qa.state === "changes_requested") && <Button size="sm" onClick={() => { void setQA(c.id, "in_progress").then(saved => { if (saved) toast("QA started"); }); }} disabled={g.qa.state === "not_submitted" && c.status !== "under_review"} title={g.qa.state === "not_submitted" ? "Owner must submit for review first" : undefined}>Start QA</Button>}
            {(g.qa.state === "in_progress" || (apiMode && g.qa.state === "awaiting")) && <>
              <Button size="sm" variant="primary" icon="check" disabled={g.checks.state === "failed"} title={g.checks.state === "failed" ? "Required checks are failing" : undefined} onClick={() => setNote({ title: "Accept QA", sub: "Records your acceptance. Deployment still needs its own approval.", cta: "Accept", run: async n => { const saved = await setQA(c.id, "accepted", n || "Accepted."); if (saved) toast("QA accepted"); return saved; } })}>Accept</Button>
              <Button size="sm" onClick={() => setNote({ title: "Request changes", cta: "Request changes", required: true, run: async n => { const saved = await setQA(c.id, "changes_requested", n); if (saved) toast("Changes requested"); return saved; } })}>Request changes</Button>
              <Button size="sm" variant="ghost" onClick={() => setNote({ title: "Reject", cta: "Reject", tone: "danger", required: true, run: async n => { const saved = await setQA(c.id, "rejected", n); if (saved) toast("QA rejected", "warn"); return saved; } })}>Reject</Button>
            </>}
            {!apiMode && g.qa.state === "accepted" && isAdmin && <Button size="sm" variant="ghost" onClick={() => setNote({ title: "Reopen QA", cta: "Reopen", required: true, run: n => setQA(c.id, "in_progress", n) })}>Reopen</Button>}
          </div> : <span className="meta"><Icon name="lock" size={12} /> {apiMode ? "Component owners cannot accept their own QA." : "Only the QA contact or an admin can record QA decisions."}</span>}
        </div>
        <div className={cx("gate-card", ["ready", "deployed"].includes(g.deploy.state) && "on")}>
          <h4><span className="gate-num">3</span>Ready for deployment<Pill tone={DEPLOY_TONE[g.deploy.state]}>{label(g.deploy.state)}</Pill></h4>
          {g.deploy.by && <span className="meta">{personName(person(g.deploy.by))} · {fmtDateTime(g.deploy.at)}</span>}
          {g.deploy.note && <p className="ev-note">{g.deploy.note}</p>}
          {g.deploy.state !== "deployed" && g.deploy.state !== "ready" && (unmet.length ? <><span className="meta">Still needed:</span><ul>{unmet.map(u => <li key={u}>{u}</li>)}</ul></> : <span className="meta" style={{ color: "var(--ok)" }}>All requirements met. Ready for approval.</span>)}
          {isAdmin ? <div className="row" style={{ gap: 6 }}>
            {!["ready", "deployed", "scheduled"].includes(g.deploy.state) && canDeploy && <Button size="sm" variant="primary" icon="rocket" disabled={unmet.length > 0} onClick={() => setNote({ title: "Approve for deployment", sub: "Confirms configuration and environment have been reviewed.", cta: "Approve", run: async n => { const saved = await setDeploy(c.id, "ready", n); if (saved) toast("Approved for deployment"); return saved; } })}>Approve</Button>}
            {g.deploy.state === "ready" && canDeploy && <Button size="sm" variant="primary" icon="rocket" onClick={() => setNote({ title: "Record deployment", cta: "Mark deployed", run: async n => { const saved = await setDeploy(c.id, "deployed", n); if (saved) toast("Deployment recorded"); return saved; } })}>Mark deployed</Button>}
            {g.deploy.state === "ready" && canDeploy && <Button size="sm" variant="ghost" onClick={() => setNote({ title: "Withdraw approval", cta: "Withdraw", required: true, run: async n => { const saved = await setDeploy(c.id, "not_ready", n); return saved; } })}>Withdraw</Button>}
            {!apiMode && g.deploy.state === "deployed" && <Button size="sm" variant="ghost" onClick={() => setNote({ title: "Record rollback", cta: "Rolled back", tone: "danger", required: true, run: n => setDeploy(c.id, "rolled_back", n) })}>Record rollback</Button>}
          </div> : <span className="meta"><Icon name="lock" size={12} /> Only admins approve deployments.</span>}
        </div>
      </div>

      <Section title="Code review" sub={apiMode ? "The backend records review requests and QA decisions, but not separate code-review decisions or reviewer assignments." : `Reviewer: ${personName(person(c.reviewerId))}`} actions={apiMode
        ? (c.ownerId === me?.id || isAdmin) && ["in_progress", "blocked"].includes(c.status) && <Button size="sm" variant="primary" onClick={() => { void submitForReview(c.id).then(saved => { if (saved) toast("Submitted for review."); }); }}>Submit for review</Button>
        : <>
        <Pill tone={{ none: "faint", ready: "review", in_review: "review", changes_requested: "warn", accepted: "ok" }[c.review]}>{{ none: "Not submitted", ready: "Ready for review", in_review: "In review", changes_requested: "Changes requested", accepted: "Accepted" }[c.review]}</Pill>
        {(c.ownerId === me?.id || isAdmin) && ["in_progress", "blocked"].includes(c.status) && <Button size="sm" variant="primary" onClick={() => { void submitForReview(c.id).then(saved => { if (saved) toast("Submitted for review."); }); }}>Submit for review</Button>}
        {isReviewer && c.review === "in_review" && <><Button size="sm" icon="check" onClick={() => setNote({ title: "Accept code review", cta: "Accept", run: n => { setReview(c.id, "accepted", n); toast("Review accepted"); } })}>Accept review</Button><Button size="sm" variant="ghost" onClick={() => setNote({ title: "Request changes", cta: "Request changes", required: true, run: n => { setReview(c.id, "changes_requested", n); toast("Changes requested"); } })}>Request changes</Button></>}
      </>}><div style={{ height: 14 }} /></Section>

      <Section title="Acceptance criteria & evidence" sub={apiMode ? "The backend stores the expected-deliverable text and a QA decision with evidence, but not per-criterion evidence." : "Evidence is attached to each criterion and reviewed individually. History is kept for every version."} actions={!apiMode && can.ownerOrAdmin(c) && <Button size="sm" icon="plus" onClick={() => setCritOpen(true)}>Add criterion</Button>}>
        <div className="panel-body">
          {apiMode && <p>{c.deliverable || "No acceptance criteria are recorded for this component."}</p>}
          {!apiMode && <div className="row" style={{ gap: 12, marginBottom: 14 }}><div className="progress" style={{ flex: 1 }}><i style={{ width: `${c.criteria.length ? acc / c.criteria.length * 100 : 0}%` }} /></div><span className="muted tnum" style={{ fontSize: 13 }}>{acc}/{c.criteria.length} accepted</span></div>}
          {!apiMode && c.criteria.length === 0 && <Empty icon="readiness" title="No criteria yet">Add measurable criteria so everyone agrees what “done” means.</Empty>}
          {c.criteria.map(k => (
            <div className="crit" key={k.id}>
              <button className="crit-head" onClick={() => setOpen(open === k.id ? null : k.id)} aria-expanded={open === k.id}>
                <CritCheck k={k} />
                <span className="crit-text"><b>{k.text}</b><small>{k.verification} · evidence: {k.evidenceType}{k.evidence.length ? ` · ${k.evidence.length} submission${k.evidence.length > 1 ? "s" : ""}` : ""}</small></span>
                <span className="row" style={{ gap: 8 }}><CritStatusPill k={k} /><Icon name={open === k.id ? "chevronUp" : "chevronDown"} size={14} /></span>
              </button>
              {open === k.id && (
                <div className="crit-body">
                  {k.evidence.length === 0 && <span className="muted" style={{ fontSize: 13 }}>No evidence submitted yet.</span>}
                  {[...k.evidence].reverse().map(e => <EvidenceItem key={e.id} c={c} k={k} e={e} canReview={can.reviewOrAdmin(c) && e.by !== me?.id} />)}
                  <div className="row" style={{ gap: 6 }}>
                    {!apiMode && (c.ownerId === me?.id || isAdmin) && k.status !== "accepted" && <Button size="sm" variant="primary" icon="upload" onClick={() => setEvFor(k)}>Attach evidence</Button>}
                    {!apiMode && isAdmin && <ConfirmButton label="Remove criterion" confirmText="Remove" onConfirm={() => { removeCriterion(c.id, k.id); toast("Criterion removed"); }} />}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </Section>
      {note && <NoteModal {...note} onSave={note.run} onClose={() => setNote(null)} />}
      {!apiMode && evFor && <EvidenceModal c={c} k={evFor} onClose={() => setEvFor(null)} />}
      {!apiMode && critOpen && <CriterionModal c={c} onClose={() => setCritOpen(false)} />}
    </div>
  );
}

function EvidenceItem({ c, k, e, canReview }: { c: Component; k: Criterion; e: Evidence; canReview: boolean }) {
  const { person, reviewEvidence } = useStore();
  const { toast } = useToast();
  const [mode, setMode] = useState<"" | "approved" | "changes" | "rejected">("");
  const [n, setN] = useState("");
  const icon = { link: "link", file: "file", pr: "pr", commit: "commit", test: "readiness", screenshot: "image", recording: "play" }[e.kind];
  return (
    <div className="ev">
      <div className="ev-head">
        <Icon name={icon} size={15} /><b style={{ fontWeight: 500 }}>{e.label}</b><Pill tone="faint">v{e.version}</Pill>
        {e.decision && <Pill tone={e.decision === "approved" ? "ok" : e.decision === "rejected" ? "crit" : "warn"}>{e.decision === "approved" ? "Approved" : e.decision === "rejected" ? "Rejected" : "Changes requested"}</Pill>}
      </div>
      <span className="muted" style={{ fontSize: 12 }}>
        {/^https?:/.test(e.ref) ? <a href={e.ref} target="_blank" rel="noopener">{e.ref}</a> : <code>{e.ref}</code>} · submitted by {personName(person(e.by))} {ago(e.at)}
      </span>
      {e.decision && <p className="ev-note"><b>{personName(person(e.reviewerId))}</b> · {fmtDateTime(e.reviewedAt)}{e.note ? ` — ${e.note}` : ""}</p>}
      {canReview && !e.decision && (mode ? (
        <div style={{ display: "grid", gap: 8 }}>
          <textarea rows={2} value={n} onChange={ev => setN(ev.target.value)} placeholder={mode === "approved" ? "Optional note" : "What needs to change?"} aria-label="Review note" />
          <div className="row" style={{ gap: 6 }}>
            <Button size="sm" variant={mode === "rejected" ? "danger" : "primary"} onClick={() => { if (mode !== "approved" && !n.trim()) { toast("Add a note explaining the decision", "warn"); return; } reviewEvidence(c.id, k.id, e.id, mode, n.trim()); toast(mode === "approved" ? "Evidence approved" : "Decision recorded"); }}>Confirm {mode === "approved" ? "approval" : mode === "changes" ? "request" : "rejection"}</Button>
            <Button size="sm" variant="ghost" onClick={() => setMode("")}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="row" style={{ gap: 6 }}>
          <Button size="sm" icon="check" onClick={() => setMode("approved")}>Approve</Button>
          <Button size="sm" variant="ghost" onClick={() => setMode("changes")}>Request more</Button>
          <Button size="sm" variant="ghost" onClick={() => setMode("rejected")}>Reject</Button>
        </div>
      ))}
    </div>
  );
}

function EvidenceModal({ c, k, onClose }: { c: Component; k: Criterion; onClose: () => void }) {
  const { addEvidence } = useStore();
  const { toast } = useToast();
  const [f, setF] = useState({ kind: (k.evidenceType === "Documentation link" ? "link" : k.evidenceType === "Screen recording" ? "recording" : "test") as Evidence["kind"], label: "", ref: "" });
  const [err, setErr] = useState<Record<string, string>>({});
  const save = () => {
    const e: Record<string, string> = {};
    if (!f.label.trim()) e.label = "Describe what this evidence shows.";
    if (!f.ref.trim()) e.ref = "Add a link, PR/commit reference or file.";
    setErr(e); if (Object.keys(e).length) return;
    addEvidence(c.id, k.id, { kind: f.kind, label: f.label.trim(), ref: f.ref.trim() }); toast("Evidence submitted. Reviewer notified."); onClose();
  };
  return (
    <Modal title="Attach evidence" sub={k.text} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} icon="upload">Submit evidence</Button></>}>
      <Field label="Type"><select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value as Evidence["kind"] })}>
        {[["test", "Test results or report"], ["link", "Documentation link"], ["pr", "Pull request"], ["commit", "Commit"], ["screenshot", "Screenshot"], ["recording", "Screen recording"], ["file", "Logs or other file"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select></Field>
      <Field label="What it shows" error={err.label}><input type="text" value={f.label} onChange={e => setF({ ...f, label: e.target.value })} placeholder="e.g. k6 run at 500 rps, p95 62 ms" /></Field>
      <Field label="Link or reference" error={err.ref} hint="URL, PR number, commit SHA, or choose a file below"><input type="text" value={f.ref} onChange={e => setF({ ...f, ref: e.target.value })} placeholder="https://… or #142 or a1b2c3d" /></Field>
      <Field label="Or attach a file" hint="Prototype keeps the file name only; production stores files in the evidence store."><input type="file" onChange={e => { const file = e.target.files?.[0]; if (file) setF(x => ({ ...x, ref: file.name, label: x.label || file.name })); }} /></Field>
    </Modal>
  );
}

function CriterionModal({ c, onClose }: { c: Component; onClose: () => void }) {
  const { addCriterion } = useStore();
  const { toast } = useToast();
  const [f, setF] = useState({ text: "", verification: "Manual QA", evidenceType: "Test report" });
  const [err, setErr] = useState("");
  return (
    <Modal title="Add acceptance criterion" sub="Make it measurable: a threshold, a behaviour, or a document that must exist." onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => { if (f.text.trim().length < 8) { setErr("Describe the criterion in a full sentence."); return; } addCriterion(c.id, { ...f, text: f.text.trim() }); toast("Criterion added"); onClose(); }}>Add criterion</Button></>}>
      <Field label="Criterion" error={err}><textarea rows={2} value={f.text} onChange={e => setF({ ...f, text: e.target.value })} placeholder="e.g. p95 latency under 100 ms at 300 rps" /></Field>
      <div className="form-grid">
        <Field label="Verification method"><select value={f.verification} onChange={e => setF({ ...f, verification: e.target.value })}>{["Automated test", "Manual QA", "Load test", "Review", "Benchmark run"].map(x => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Required evidence"><select value={f.evidenceType} onChange={e => setF({ ...f, evidenceType: e.target.value })}>{["Test report", "Documentation link", "Screen recording", "Log export", "Screenshot"].map(x => <option key={x}>{x}</option>)}</select></Field>
      </div>
    </Modal>
  );
}

// ───────────── GitHub ─────────────
function GithubTab({ c }: { c: Component }) {
  const { state, person } = useStore();
  const [sub, setSub] = useState("readme");
  const repo = state.repos.find(r => r.id === c.repoId);
  if (!repo) return <NoRepo c={c} />;
  const gh = repo.github;
  const name = (id: string) => person(id)?.first || id;
  const stateIcon = (s: string) => s === "merged" ? "pr" : s === "closed" ? "x" : "pr";
  return (
    <section className="panel" style={{ overflow: "hidden" }}>
      <div className="gh-head">
        <Icon name="github" size={20} />
        <a className="repo-name" href={repo.url} target="_blank" rel="noopener">{repo.org}/{repo.name}</a>
        <Pill tone="faint">{repo.visibility}</Pill>
        <span className="muted" style={{ fontSize: 13 }}>{repo.description}</span>
        <span style={{ marginLeft: "auto" }} className="row"><Pill tone={CHECK_TONE[repo.ci]} dot>CI {repo.ci}</Pill><span className="muted" style={{ fontSize: 12 }}>{repo.githubActivityLoaded === false ? "GitHub metadata not loaded" : `${gh.branches.length} branches · ${gh.contributors.length} contributors`}</span></span>
      </div>
      {repo.githubActivityLoaded === false ? (
        <div className="panel-body"><p className="muted">GitHub activity is not included in the repository records loaded from the API.</p></div>
      ) : <>
      <div style={{ padding: "0 12px" }}><Tabs size="sm" value={sub} onChange={setSub} tabs={[{ id: "readme", label: "README.md", icon: "file" }, { id: "commits", label: "Commits", count: gh.commits.length }, { id: "prs", label: "Pull requests", count: gh.prs.filter(p => p.state === "open").length }, { id: "issues", label: "Issues", count: gh.issues.filter(i => i.state === "open").length }, { id: "checks", label: "Checks", count: gh.runs.length }]} /></div>
      {sub === "readme" && <div className="panel-body"><Markdown src={gh.readme} /></div>}
      {sub === "commits" && <div className="gh-list">{gh.commits.length === 0 && <Empty icon="commit" title="No commits yet" />}{gh.commits.map(x => (
        <div key={x.sha} className="gh-item"><Icon name="commit" size={16} className="muted" /><div><span className="t">{x.message}</span><small><span className="sha">{x.sha.slice(0, 7)}</span> · {name(x.author)} · {x.branch} · {ago(x.at)}</small></div><a href={`${repo.url}/commit/${x.sha}`} target="_blank" rel="noopener" className="btn btn-ghost btn-sm">View</a></div>
      ))}</div>}
      {sub === "prs" && <div className="gh-list">{gh.prs.length === 0 && <Empty icon="pr" title="No pull requests" />}{gh.prs.map(p => (
        <div key={p.number} className="gh-item"><Icon name={stateIcon(p.state)} size={16} style={{ color: p.state === "merged" ? "var(--review)" : p.state === "open" ? "var(--ok)" : "var(--fg-4)" }} /><div><span className="t">{p.title}</span><small>#{p.number} · {p.state} · by {name(p.author)} · {ago(p.at)} · reviewer {p.reviewers.map(name).join(", ")}</small></div><Pill tone={CHECK_TONE[p.checks]}>{p.checks}</Pill></div>
      ))}</div>}
      {sub === "issues" && <div className="gh-list">{gh.issues.length === 0 && <Empty icon="issue" title="No issues" />}{gh.issues.map(i => (
        <div key={i.number} className="gh-item"><Icon name="issue" size={16} style={{ color: i.state === "open" ? "var(--ok)" : "var(--fg-4)" }} /><div><span className="t">{i.title}</span><small>#{i.number} · {i.state} · opened by {name(i.author)} {ago(i.at)}</small></div><span className="row" style={{ gap: 4 }}>{i.labels.map(l => <Pill key={l} tone="neutral">{l}</Pill>)}</span></div>
      ))}</div>}
      {sub === "checks" && <div className="gh-list">{gh.runs.length === 0 && <Empty icon="readiness" title="No workflow runs" />}{gh.runs.map(r => (
        <div key={r.name} className="gh-item"><Icon name={r.state === "passed" ? "check" : r.state === "failed" ? "x" : "clock"} size={16} style={{ color: r.state === "passed" ? "var(--ok)" : r.state === "failed" ? "var(--crit)" : "var(--fg-4)" }} /><div><span className="t">{r.name}{r.required && <span className="muted" style={{ fontWeight: 400 }}> · required</span>}</span><small>{r.detail ? <span style={{ color: "var(--crit)" }}>{r.detail} · </span> : null}<span className="sha">{r.commit.slice(0, 7)}</span> · {r.duration} · {ago(r.at)}</small></div><Pill tone={CHECK_TONE[r.state]}>{r.state}</Pill></div>
      ))}</div>}
      <div className="sync-note"><Icon name="refresh" size={14} /><span><b>Sample data.</b> In production this tab is read live from GitHub through the Apex GitHub App; GitHub stays the source of truth for code, PRs and checks.</span></div>
      </>}
    </section>
  );
}

// ───────────── Architecture (view only) ─────────────
function ArchitectureTab({ c }: { c: Component }) {
  const { me, isAdmin, apiMode, person, addArch, removeArch } = useStore();
  const { toast } = useToast();
  const [sel, setSel] = useState(c.architecture[0]?.id || null);
  const file = c.architecture.find(a => a.id === sel) || c.architecture[0];
  const input = useRef<HTMLInputElement>(null);
  const upload = (f: File) => {
    if (!/^image\/(png|jpe?g|webp|svg\+xml)$/.test(f.type)) { toast("Upload a PNG, JPG, WebP or SVG diagram", "warn"); return; }
    if (f.size > 3 * 1024 * 1024) { toast("Keep diagrams under 3 MB in the prototype", "warn"); return; }
    const r = new FileReader();
    r.onload = () => { addArch(c.id, { name: f.name, kind: "image", content: String(r.result), note: "Uploaded diagram" }); toast("Diagram uploaded"); };
    r.onerror = () => toast("Couldn't read that file", "crit");
    r.readAsDataURL(f);
  };
  useEffect(() => { if (!c.architecture.some(a => a.id === sel)) setSel(c.architecture[0]?.id || null); }, [c.architecture]);
  return (
    <section className="panel" style={{ overflow: "hidden" }}>
      <div className="panel-head" style={{ paddingBottom: 16, borderBottom: "1px solid var(--line)" }}>
        <div><h2>Architecture</h2><p>{apiMode ? "Architecture file upload is not connected to the backend." : "View-only. Files can't be downloaded or copied from here; every view is watermarked with the viewer's email."}</p></div>
        {!apiMode && isAdmin && <div className="panel-actions"><input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} /><Button icon="upload" onClick={() => input.current?.click()}>Upload diagram</Button></div>}
      </div>
      {c.architecture.length === 0 ? <Empty icon="image" title="No architecture files yet">{isAdmin ? "Upload a diagram (PNG, JPG, WebP or SVG)." : "An admin can upload diagrams for this component."}</Empty> : (
        <div className="arch">
          <div className="arch-files">
            {c.architecture.map(a => (
              <button key={a.id} className={cx("arch-file", a.id === file?.id && "on")} onClick={() => setSel(a.id)}>
                <Icon name="image" size={16} /><span><b>{a.name}</b><small>v{a.version} · {personName(person(a.by))} · {ago(a.at)}</small>{a.note && <small style={{ display: "block" }}>{a.note}</small>}</span>
              </button>
            ))}
            {!apiMode && isAdmin && file && <div style={{ paddingTop: 8 }}><ConfirmButton label="Remove selected file" confirmText="Remove" onConfirm={() => { removeArch(c.id, file.id); toast("File removed"); }} /></div>}
          </div>
          {file && <ProtectedViewer src={file.kind === "svg" ? "data:image/svg+xml;charset=utf-8," + encodeURIComponent(file.content) : file.content} mark={`${me?.email} · ${new Date().toLocaleDateString("en-GB")}`} />}
        </div>
      )}
    </section>
  );
}

function ProtectedViewer({ src, mark }: { src: string; mark: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [nat, setNat] = useState({ w: 1120, h: 640 });
  const [view, setView] = useState({ z: 0, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const fit = () => { const el = box.current; if (!el) return; const z = Math.min(el.clientWidth / nat.w, el.clientHeight / nat.h) * 0.94; setView({ z, x: 0, y: 0 }); };
  useEffect(() => { const img = new Image(); img.onload = () => setNat({ w: img.naturalWidth || 1120, h: img.naturalHeight || 640 }); img.src = src; }, [src]);
  useEffect(() => { fit(); }, [nat]);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const wheel = (e: WheelEvent) => { e.preventDefault(); setView(v => ({ ...v, z: Math.min(4, Math.max(0.1, v.z * (e.deltaY < 0 ? 1.1 : 0.9))) })); };
    el.addEventListener("wheel", wheel, { passive: false }); return () => el.removeEventListener("wheel", wheel);
  }, []);
  const block = (e: React.SyntheticEvent) => e.preventDefault();
  return (
    <div className="viewer" ref={box} onContextMenu={block} onDragStart={block} onCopy={block}>
      <div className="viewer-canvas" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z}) translate(${-nat.w / 2}px, ${-nat.h / 2}px)` }}>
        <img src={src} width={nat.w} height={nat.h} alt="Architecture diagram" draggable={false} />
      </div>
      <div className="viewer-mark" aria-hidden>{Array.from({ length: 18 }, (_, i) => <span key={i}>{mark}</span>)}</div>
      <div className="viewer-shield" onPointerDown={e => { (e.target as HTMLElement).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; }}
        onPointerMove={e => { const d = drag.current; if (d) setView(v => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y })); }}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} />
      <div className="viewer-tools">
        <button onClick={() => setView(v => ({ ...v, z: Math.max(0.1, v.z / 1.25) }))} aria-label="Zoom out"><Icon name="zoomOut" size={16} /></button>
        <span>{Math.round(view.z * 100)}%</span>
        <button onClick={() => setView(v => ({ ...v, z: Math.min(4, v.z * 1.25) }))} aria-label="Zoom in"><Icon name="zoomIn" size={16} /></button>
        <button onClick={fit} aria-label="Fit to view"><Icon name="maximize" size={16} /></button>
      </div>
      <span className="viewer-badge"><Icon name="lock" size={12} />View only · download disabled</span>
    </div>
  );
}

// ───────────── Blockers tab ─────────────
function BlockersTab({ c, onAdd, onAssign }: { c: Component; onAdd: () => void; onAssign: () => void }) {
  const { state, isAdmin } = useStore();
  const bl = state.blockers.filter(b => b.componentId === c.id);
  const open = bl.filter(b => !["resolved", "closed"].includes(b.status));
  const done = bl.filter(b => ["resolved", "closed"].includes(b.status));
  const hos = state.handoffs.filter(h => h.componentId === c.id);
  const owners = state.history.filter(h => h.entityId === c.id && h.field === "owner").reverse();
  return (
    <div className="split">
      <div className="stack-v">
        <Section title="Blockers" sub="Structured records: what's blocking, who unblocks it, the next action and when." actions={<Button size="sm" variant="primary" icon="plus" onClick={onAdd}>Add blocker</Button>}>
          {open.length === 0 ? <Empty icon="check" title="No open blockers" /> : <div className="blklist">{open.map(b => <BlockerRow key={b.id} b={b} hideComponent />)}</div>}
          {done.length > 0 && <div className="panel-body muted" style={{ fontSize: 13 }}>{done.length} resolved: {done.map(b => b.title).join(" · ")}</div>}
        </Section>
        <Section title="Handoffs" actions={isAdmin && <Button size="sm" icon="handoff" onClick={onAssign}>Reassign owner</Button>}>
          <div className="panel-body" style={{ display: "grid", gap: 12 }}>{hos.length === 0 ? <span className="muted">No handoffs for this component.</span> : hos.map(h => <HandoffCard key={h.id} h={h} />)}</div>
        </Section>
      </div>
      <Section title="Ownership history" sub="Previous owners stay on record">
        <div className="panel-body" style={{ paddingTop: 6 }}><div className="feed">{owners.length === 0 ? <span className="muted">No ownership changes.</span> : owners.map(h => <HistoryLine key={h.id} h={h} />)}</div></div>
      </Section>
    </div>
  );
}

// ───────────── Comments ─────────────
function CommentsTab({ c }: { c: Component }) {
  const { me, isAdmin, apiMode, person, addComment, editComment, deleteComment } = useStore();
  const { toast } = useToast();
  const [body, setBody] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const send = async () => {
    if (!body.trim() || sending) return;
    setSending(true);
    try {
      if (await addComment(c.id, body.trim())) { setBody(""); toast("Comment posted"); }
    } finally { setSending(false); }
  };
  return (
    <Section title="Discussion" sub={apiMode ? "Comments are saved to the backend. Editing and deleting comments are not supported." : "Everyone can comment. Mention someone with @FirstName to notify them."}>
      <div className="panel-body">
        <div className="comments">
          {c.comments.length === 0 && <Empty icon="message" title="No comments yet">Start the discussion about this component.</Empty>}
          {c.comments.map(m => (
            <div className="cmt" key={m.id}>
              <Avatar p={person(m.by)} size={32} />
              <div style={{ minWidth: 0 }}>
                <div className="cmt-head"><b>{personName(person(m.by))}</b><small>{fmtDateTime(m.at)}{m.edited && " · edited"}</small>
                  {!apiMode && (m.by === me?.id || isAdmin) && editing !== m.id && <span className="cmt-actions">{m.by === me?.id && <Button size="sm" variant="ghost" icon="edit" aria-label="Edit comment" onClick={() => { setEditing(m.id); setDraft(m.body); }} />}<ConfirmButton label="" onConfirm={() => { deleteComment(c.id, m.id); toast("Comment deleted"); }} /></span>}
                </div>
                {editing === m.id ? (
                  <div style={{ display: "grid", gap: 8, marginTop: 6 }}><textarea rows={3} value={draft} onChange={e => setDraft(e.target.value)} aria-label="Edit comment" /><div className="row" style={{ gap: 6 }}><Button size="sm" variant="primary" onClick={() => { if (draft.trim()) { editComment(c.id, m.id, draft.trim()); setEditing(null); } }}>Save</Button><Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button></div></div>
                ) : <Markdown src={m.body.replace(/@(\w+)/g, "**@$1**")} className="cmt-body" />}
              </div>
            </div>
          ))}
        </div>
        <div className="composer">
          <Avatar p={me} size={32} />
          <div className="composer-box">
            <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Write a comment…" aria-label="Write a comment" onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send(); }} disabled={sending} />
            <div className="composer-foot"><span>Markdown supported · Ctrl/⌘ + Enter to post</span><Button size="sm" variant="primary" onClick={() => void send()} disabled={!body.trim() || sending}>{sending ? "Posting…" : "Comment"}</Button></div>
          </div>
        </div>
      </div>
    </Section>
  );
}


// ───────────── Real design library tabs ─────────────
let DESIGNS: Promise<Record<string, string>> | null = null;
const loadDesigns = () => (DESIGNS ||= fetch("designs.json").then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); }).catch(e => { DESIGNS = null; throw e; }));

function DesignsTab({ c }: { c: Component }) {
  const { me } = useStore();
  const [svgs, setSvgs] = useState<Record<string, string> | null>(null);
  const [err, setErr] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { let on = true; loadDesigns().then(d => on && setSvgs(d)).catch(() => on && setErr(true)); return () => { on = false; }; }, []);
  const ds = c.lib!.diagrams;
  const src = (n: string) => svgs?.[`${c.id}/${n}`] ? "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgs[`${c.id}/${n}`]) : "";
  const cur = ds.find(d => d.n === open);
  return (
    <div className="stack-v">
      <p className="muted" style={{ fontSize: 14 }}>Eight views from the design pack <code>{c.lib!.folder}</code>. These are first-draft proposals: contracts, deployment boundaries and dependencies still need architecture review. View only.</p>
      {err && <Empty icon="image" title="Diagrams couldn't load">Check your connection and reopen this tab.</Empty>}
      <div className="dgrid" onContextMenu={e => e.preventDefault()}>
        {ds.map(d => (
          <button key={d.n} className="dcard" onClick={() => setOpen(d.n)} disabled={!svgs}>
            <span className="dcard-img">{svgs ? <img src={src(d.n)} alt={`${d.title} diagram`} draggable={false} /> : <span className="skel" />}</span>
            <span className="dcard-text"><b><span className="dnum">{d.n}</span>{d.title}</b><small>{d.caption}</small></span>
          </button>
        ))}
      </div>
      {cur && (
        <Modal title={`${cur.n} · ${cur.title}`} sub={`${c.id} ${c.name}`} onClose={() => setOpen(null)} wide>
          <ProtectedViewer src={src(cur.n)} mark={`${me?.email} · ${new Date().toLocaleDateString("en-GB")}`} />
          <p className="muted" style={{ fontSize: 13 }}>{cur.caption}</p>
        </Modal>
      )}
    </div>
  );
}

function StartTab({ c }: { c: Component }) {
  const L = c.lib!;
  return (
    <div className="split">
      <div className="stack-v">
        <Section title="Start here" sub="Implementation sequence from the design pack"><div className="panel-body"><Markdown src={c.onboarding.setup || "_No sequence in the design pack._"} /></div></Section>
        <Section title="Done means" sub="Acceptance from the component map">
          <div className="panel-body"><ol className="olist">{c.criteria.map(k => <li key={k.id}>{k.text}</li>)}</ol></div>
        </Section>
      </div>
      <div className="stack-v">
        <Section title="Contract (draft)">
          <div className="panel-body contract">
            <div><span className="mono-label">Operation</span><b>{L.op}</b></div>
            <div><span className="mono-label">Takes in</span><div className="chips-sm">{L.inputs.map(i => <code key={i}>{i}</code>)}</div></div>
            <div><span className="mono-label">Gives back</span><div className="chips-sm">{L.outputs.map(i => <code key={i}>{i}</code>)}</div></div>
            <div><span className="mono-label">Records</span><div className="chips-sm">{L.entities.map(i => <code key={i}>{i}</code>)}</div></div>
          </div>
        </Section>
        <Section title="People">
          <div className="panel-body" style={{ paddingTop: 8 }}><dl>
            <KV k="Owner"><OwnerState c={c} /></KV>
            <KV k="Reviewer"><PersonChip id={c.reviewerId} empty="Not assigned" /></KV>
            <KV k="Architecture">Marjan coordinates scope and reuse</KV>
          </dl></div>
        </Section>
      </div>
    </div>
  );
}

function NoRepo({ c }: { c: Component }) {
  const { isAdmin, apiMode, me } = useStore();
  const [open, setOpen] = useState(false);
  const gh = c.links.find(l => l.kind === "github");
  return (
    <Section>
      <Empty icon="github" title={gh ? "Repository linked" : "No GitHub repository yet"} action={<>{gh && <a className="btn btn-secondary btn-md" href={gh.url} target="_blank" rel="noopener"><Icon name="github" />{gh.label}</a>}{!gh && (isAdmin || (!apiMode && c.ownerId === me?.id)) && <Button variant="primary" icon="link" onClick={() => setOpen(true)}>Link a repository</Button>}</>}>
        {gh ? "Commits, pull requests and checks will appear here once the Apex GitHub App is connected." : "When work starts, link the repository here. Commits, pull requests and checks will then show on this page."}
      </Empty>
      {open && <LinkModal c={c} kind="github" onClose={() => setOpen(false)} />}
    </Section>
  );
}
