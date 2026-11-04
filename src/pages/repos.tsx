import React, { useMemo, useState } from "react";
import { useStore, useToast } from "../store";
import { Icon } from "../icons";
import { Button, PageHeader, Section, Pill, PersonChip, Drawer, KV, Field, PersonSelect, CHECK_TONE, label, cx, Empty, CopyText, CompLink, StagePill, StatusPill } from "../ui";
import { ago, personName, fmtDate, stage, STAGE_LABEL, isDone } from "../logic";
import type { Repo } from "../types";

const ACCESS_TONE: Record<Repo["access"], string> = { connected: "ok", pending_install: "warn", no_access: "crit", error: "crit" };
const ACCESS_LABEL: Record<Repo["access"], string> = { connected: "Connected", pending_install: "App install pending", no_access: "No access", error: "Sync error" };

export function Repos() {
  const { state, person } = useStore();
  const [q, setQ] = useState(""); const [proj, setProj] = useState(""); const [acc, setAcc] = useState(""); const [ci, setCi] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const comps = (r: Repo) => state.components.filter(c => c.repoId === r.id);
  const list = state.repos.filter(r => (!q || (r.name + r.description + r.languages.join(" ")).toLowerCase().includes(q.toLowerCase()))
    && (!proj || comps(r).some(c => c.projectId === proj)) && (!acc || r.access === acc) && (!ci || r.ci === ci));
  const sel = state.repos.find(r => r.id === open);
  return (
    <>
      <PageHeader title="Repositories" sub="Every repository, its owner, and whether the platform can reach it." />
      <div className="toolbar">
        <div className="input-ic grow"><Icon name="search" size={15} /><input type="search" placeholder="Search repositories or languages" value={q} onChange={e => setQ(e.target.value)} aria-label="Search repositories" /></div>
        <select value={proj} onChange={e => setProj(e.target.value)} aria-label="Project"><option value="">All projects</option>{state.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <select value={acc} onChange={e => setAcc(e.target.value)} aria-label="Access"><option value="">Any access</option>{Object.entries(ACCESS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select value={ci} onChange={e => setCi(e.target.value)} aria-label="CI status"><option value="">Any CI status</option>{["passed", "failed", "running", "pending", "unknown"].map(s => <option key={s} value={s}>{label(s)}</option>)}</select>
      </div>
      <section className="panel" style={{ overflow: "hidden" }}>
        {list.length === 0 ? (
          <div className="panel-body" style={{ display: "grid", gap: 14, padding: "20px 18px" }}>
            <div>
              <b style={{ fontSize: 14, fontWeight: 500 }}>
                {state.repos.length === 0 ? "No repositories have been linked yet" : "No repositories match those filters"}
              </b>
              <p className="muted" style={{ fontSize: 13, marginTop: 4, maxWidth: "64ch", lineHeight: 1.55 }}>
                {state.repos.length === 0
                  ? "This registry fills itself as work starts. When someone begins building a component, they link its repository from the component's GitHub tab, and it appears here with its owner, access level and check status."
                  : "Clear a filter to see the rest of the registry."}
              </p>
            </div>
            {state.repos.length === 0 && (
              <div style={{ display: "grid", gap: 10, fontSize: 13, color: "var(--fg-2)" }}>
                <div><b style={{ fontWeight: 500, color: "var(--fg)" }}>Why it is here.</b> One place to answer “where does this component's code live, and can the platform reach it?” without asking in Slack.</div>
                <div><b style={{ fontWeight: 500, color: "var(--fg)" }}>What it will not do.</b> Code review stays in GitHub. This registry records the link, the owner and whether checks are passing.</div>
                <div><a className="btn btn-secondary btn-sm" href="#library">Open the component list</a></div>
              </div>
            )}
          </div>
        ) :
          <div className="table-wrap"><table className="tbl">
            <thead><tr><th>Repository</th><th>Components</th><th>Owner</th><th>Access</th><th>CI</th><th>Last commit</th></tr></thead>
            <tbody>{list.map(r => (
              <tr key={r.id} className="clickable" onClick={() => setOpen(r.id)}>
                <td><div className="name-cell" style={{ minWidth: 200 }}><span className="row" style={{ gap: 6, flexWrap: "nowrap" }}><Icon name="repo" size={14} className="muted" /><b className="mono" style={{ fontWeight: 600 }}>{r.name}</b></span><small>{r.description}</small></div></td>
                <td>{comps(r).length ? <span className="row" style={{ gap: 4 }}>{comps(r).map(c => <code key={c.id} className="cid" title={c.name}>{c.id}</code>)}</span> : <span className="muted">—</span>}</td>
                <td><PersonChip id={r.ownerId} /></td>
                <td><Pill tone={ACCESS_TONE[r.access]} dot>{ACCESS_LABEL[r.access]}</Pill></td>
                <td><Pill tone={CHECK_TONE[r.ci]}>{label(r.ci)}</Pill></td>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>{r.github.commits[0] ? ago(r.github.commits[0].at) : "—"}</td>
              </tr>))}
            </tbody></table></div>}
        <div className="sync-note" style={{ borderRadius: 0 }}><Icon name="refresh" size={14} /><span><b>Sample data.</b> In production, names, branches, commits and checks sync from GitHub; access status comes from the GitHub App installation.</span></div>
      </section>
      {sel && <RepoDrawer r={sel} onClose={() => setOpen(null)} />}
    </>
  );
}

export function RepoDrawer({ r, onClose }: { r: Repo; onClose: () => void }) {
  const { state, isAdmin, updateRepo } = useStore();
  const { toast } = useToast();
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ ownerId: r.ownerId, reviewerId: r.reviewerId, dev: r.env.dev, staging: r.env.staging, prod: r.env.prod });
  const comps = state.components.filter(c => c.repoId === r.id);
  return (
    <Drawer title={<span className="mono">{r.name}</span>} sub={r.description} onClose={onClose}
      footer={isAdmin ? (edit ? <><Button variant="ghost" onClick={() => setEdit(false)}>Cancel</Button><Button variant="primary" onClick={() => { updateRepo(r.id, { ownerId: f.ownerId, reviewerId: f.reviewerId, env: { dev: f.dev, staging: f.staging, prod: f.prod } }); setEdit(false); toast("Repository details saved"); }}>Save</Button></> : <Button icon="edit" onClick={() => setEdit(true)}>Edit ownership & environments</Button>) : undefined}>
      <div className="row"><Pill tone={ACCESS_TONE[r.access]} dot>{ACCESS_LABEL[r.access]}</Pill><Pill tone={CHECK_TONE[r.ci]}>CI {r.ci}</Pill><Pill tone="faint">{r.visibility}</Pill></div>
      <dl>
        <KV k="URL"><CopyText text={r.url} /></KV>
        <KV k="Default branch"><code>{r.defaultBranch}</code></KV>
        <KV k="Access check">{r.accessNote}</KV>
        <KV k="Workflow"><code style={{ fontSize: 12 }}>{r.workflow}</code></KV>
        <KV k="Build · test"><code>{r.build}</code> · <code>{r.test}</code></KV>
        <KV k="Languages">{r.languages.join(", ")}</KV>
        <KV k="Frameworks">{r.frameworks.join(", ")}</KV>
      </dl>
      {edit ? (
        <div style={{ display: "grid", gap: 14 }}>
          <Field label="Owner"><PersonSelect value={f.ownerId} onChange={v => setF({ ...f, ownerId: v })} /></Field>
          <Field label="Technical reviewer"><PersonSelect value={f.reviewerId} onChange={v => setF({ ...f, reviewerId: v })} /></Field>
          <Field label="Development environment"><textarea rows={2} value={f.dev} onChange={e => setF({ ...f, dev: e.target.value })} /></Field>
          <Field label="Staging environment"><textarea rows={2} value={f.staging} onChange={e => setF({ ...f, staging: e.target.value })} /></Field>
          <Field label="Production environment" hint="Never record secret values here."><textarea rows={2} value={f.prod} onChange={e => setF({ ...f, prod: e.target.value })} /></Field>
        </div>
      ) : (
        <>
          <dl>
            <KV k="Owner"><PersonChip id={r.ownerId} /></KV>
            <KV k="Reviewer"><PersonChip id={r.reviewerId} /></KV>
            <KV k="Project manager"><PersonChip id={r.pmId} /></KV>
          </dl>
          <div><h4 style={{ fontSize: 13, marginBottom: 8 }}>Environments</h4><dl>
            <KV k="Development">{r.env.dev}</KV><KV k="Staging">{r.env.staging}</KV><KV k="Production">{r.env.prod}</KV>
          </dl></div>
        </>
      )}
      <div><h4 style={{ fontSize: 13, marginBottom: 8 }}>Components in this repository</h4>
        <div className="deps">{comps.length ? comps.map(c => <a key={c.id} href={"#c-" + c.id} className="dep"><span className="dep-name"><span>{c.name}</span><small>{c.id}</small></span><StatusPill s={c.status} /></a>) : <span className="muted">None linked.</span>}</div>
      </div>
      <div><h4 style={{ fontSize: 13, marginBottom: 8 }}>Used by</h4><div className="row" style={{ gap: 6 }}>{r.products.map(p => <Pill key={p} tone="brand">{p}</Pill>)}{r.services.map(s => <Pill key={s} tone="neutral">{s}</Pill>)}</div></div>
      <a className="btn btn-secondary btn-md" href={r.url} target="_blank" rel="noopener"><Icon name="github" />Open on GitHub</a>
    </Drawer>
  );
}

// ───────────── Readiness board ─────────────
export function Readiness() {
  const { state, person } = useStore();
  const [proj, setProj] = useState("");
  const cs = state.components.filter(c => !proj || c.projectId === proj);
  const lanes: { id: string; title: string; color: string; stages: string[]; hint: string }[] = [
    { id: "checks", title: "Awaiting checks", color: "var(--fg-4)", stages: ["checks_pending", "no_checks"], hint: "CI not yet green or no repository" },
    { id: "failed", title: "Checks failed", color: "var(--crit)", stages: ["checks_failed"], hint: "Required workflows failing" },
    { id: "qa", title: "Awaiting QA", color: "var(--review)", stages: ["awaiting_qa"], hint: "Checks passed, QA not decided" },
    { id: "qachg", title: "QA changes / rejected", color: "var(--warn)", stages: ["qa_changes"], hint: "Back with the owner" },
    { id: "deploy", title: "Awaiting deploy approval", color: "var(--info)", stages: ["awaiting_deploy"], hint: "QA accepted" },
    { id: "ready", title: "Ready & deployed", color: "var(--ok)", stages: ["ready", "deployed"], hint: "Approved for or in production" },
  ];
  const g = (k: keyof typeof cs[0]["gates"], s: string) => cs.filter(c => c.gates[k].state === s).length;
  return (
    <>
      <PageHeader title="Readiness gates" sub="Three gates tracked independently: automated checks from GitHub, QA acceptance by an authorised reviewer, and deployment approval by an admin. Passing CI never moves QA."
        actions={<select value={proj} onChange={e => setProj(e.target.value)} style={{ width: "auto" }} aria-label="Project"><option value="">All projects</option>{state.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>} />
      <div className="gate-cards">
        <div className="gate-card"><h4><span className="gate-num">1</span>Checks passed</h4><div className="row" style={{ gap: 18 }}>{(["passed", "failed", "running", "pending"] as const).map(s => <div key={s}><div className="kpi-value" style={{ fontSize: 26, color: s === "failed" && g("checks", s) ? "var(--crit)" : undefined }}>{g("checks", s)}</div><span className="meta">{label(s)}</span></div>)}</div></div>
        <div className="gate-card"><h4><span className="gate-num">2</span>QA accepted</h4><div className="row" style={{ gap: 18 }}>{(["accepted", "in_progress", "awaiting", "changes_requested"] as const).map(s => <div key={s}><div className="kpi-value" style={{ fontSize: 26 }}>{g("qa", s)}</div><span className="meta">{label(s)}</span></div>)}</div></div>
        <div className="gate-card"><h4><span className="gate-num">3</span>Ready for deployment</h4><div className="row" style={{ gap: 18 }}>{(["deployed", "ready", "not_ready"] as const).map(s => <div key={s}><div className="kpi-value" style={{ fontSize: 26 }}>{g("deploy", s)}</div><span className="meta">{label(s)}</span></div>)}</div></div>
      </div>
      <div className="board">
        {lanes.map(l => {
          const items = cs.filter(c => l.stages.includes(stage(c)) && !(l.id === "checks" && c.status === "not_started" && !c.ownerId && false));
          return (
            <div className="lane" key={l.id}>
              <div className="lane-head"><i className="lane-dot" style={{ background: l.color }} />{l.title}<span className="n">{items.length}</span></div>
              <span className="muted" style={{ fontSize: 12, padding: "0 4px" }}>{l.hint}</span>
              {items.map(c => (
                <a key={c.id} href={"#c-" + c.id} className="card-mini">
                  <span className="row-between"><code className="cid">{c.id}</code><StatusPill s={c.status} /></span>
                  <b>{c.name}</b>
                  <span className="row-between" style={{ fontSize: 12 }}><PersonChip id={c.ownerId} size={18} /><span className="muted">{c.criteria.filter(k => k.status === "accepted").length}/{c.criteria.length} AC</span></span>
                </a>
              ))}
              {items.length === 0 && <span className="muted" style={{ fontSize: 12.5, padding: "8px 4px" }}>Nothing here</span>}
            </div>
          );
        })}
      </div>
    </>
  );
}
