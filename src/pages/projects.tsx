import React, { useMemo, useRef, useState } from "react";
import { useStore, useNav } from "../store";
import { Icon } from "../icons";
import { Button, StatusPill, PersonChip, DueText, Empty, Pill, cx, CHECK_TONE, label } from "../ui";
import { isDone, daysUntil, fmtDate, personName, ago, OPEN_BLOCKER, STATUS_LABEL, stage, risk } from "../logic";
import { STATUS_COLOR } from "./overview";
import { ProjectCard } from "./home";
import { RepoDrawer } from "./repos";
import type { Component, Project, Status } from "../types";

const DAY = 86400000;
const T = (s: string) => new Date(s.length === 10 ? s + "T00:00:00" : s).getTime();
const ORDER: Status[] = ["completed", "under_review", "in_progress", "blocked", "not_started"];

/** Segmented bar of component statuses with a legend of real counts. */
export function StatusBar({ cs, thin }: { cs: Component[]; thin?: boolean }) {
  const n = cs.length || 1;
  return (
    <span className={cx("sbar", thin && "sbar-thin")}>
      <span className="sbar-track" role="img" aria-label={ORDER.map(s => `${STATUS_LABEL[s]} ${cs.filter(c => c.status === s).length}`).join(", ")}>
        {ORDER.map(s => { const v = cs.filter(c => c.status === s).length; return v ? <i key={s} style={{ width: `${v / n * 100}%`, background: STATUS_COLOR[s] }} title={`${STATUS_LABEL[s]}: ${v}`} /> : null; })}
      </span>
      {!thin && <span className="sbar-legend">{ORDER.map(s => { const v = cs.filter(c => c.status === s).length; return v ? <span key={s}><i style={{ background: STATUS_COLOR[s] }} />{STATUS_LABEL[s]} <b>{v}</b></span> : null; })}</span>}
    </span>
  );
}

// ───────────── Architecture diagram (built from real dependencies) ─────────────
function Architecture({ p, cs }: { p: Project; cs: Component[] }) {
  const { state, person } = useStore();
  const { go } = useNav();
  const [hover, setHover] = useState<string | null>(null);
  const W = 196, H = 58, GX = 52, GY = 14, HEAD = 34;
  const ids = new Set(cs.map(c => c.id));
  const platform = [...new Set(cs.flatMap(c => c.deps).filter(d => !ids.has(d)))].map(id => state.components.find(c => c.id === id)!).filter(Boolean);
  const level = new Map<string, number>();
  const lv = (c: Component, seen = new Set<string>()): number => {
    if (level.has(c.id)) return level.get(c.id)!;
    if (seen.has(c.id)) return 1; seen.add(c.id);
    const inner = c.deps.filter(d => ids.has(d)).map(d => cs.find(x => x.id === d)!);
    const l = inner.length ? Math.max(...inner.map(d => lv(d, seen))) + 1 : 1;
    level.set(c.id, l); return l;
  };
  cs.forEach(c => lv(c));
  const L = Math.max(1, ...level.values());
  const cols: { kind: "input" | "comp" | "users"; items: any[]; title: string }[] = [
    { kind: "input", title: "Inputs & shared platform", items: [...p.external.map(e => ({ ext: e })), ...platform] },
    ...Array.from({ length: L }, (_, i) => ({ kind: "comp" as const, title: L === 1 ? "Project components" : `Build step ${i + 1}`, items: cs.filter(c => level.get(c.id) === i + 1) })),
    { kind: "users", title: "Used by", items: [{ users: p.users }] },
  ];
  const tallest = Math.max(...cols.map(c => c.items.length));
  const totalH = HEAD + tallest * (H + GY) - GY + 16;
  const pos = new Map<string, { x: number; y: number }>();
  cols.forEach((col, ci) => {
    const off = (tallest - col.items.length) * (H + GY) / 2;
    col.items.forEach((it, i) => { const key = it.id || it.ext || "users"; pos.set(key, { x: ci * (W + GX), y: HEAD + off + i * (H + GY) }); });
  });
  const totalW = cols.length * (W + GX) - GX;
  const edges: { from: string; to: string; dashed?: boolean }[] = [];
  cs.forEach(c => c.deps.forEach(d => pos.has(d) && edges.push({ from: d, to: c.id })));
  const leaves = cs.filter(c => !cs.some(x => x.deps.includes(c.id)));
  leaves.forEach(c => edges.push({ from: c.id, to: "users", dashed: true }));
  const firsts = cs.filter(c => level.get(c.id) === 1);
  p.external.forEach((e, i) => { const t = firsts[Math.min(i, firsts.length - 1)]; if (t) edges.push({ from: e, to: t.id, dashed: true }); });
  const hot = (e: { from: string; to: string }) => hover && (e.from === hover || e.to === hover);
  const trunc = (s: string, n: number) => s.length > n ? s.slice(0, n - 1) + "…" : s;
  return (
    <div className="arch-scroll">
      <svg viewBox={`-2 0 ${totalW + 4} ${totalH}`} width="100%" style={{ minWidth: Math.min(totalW, 720), maxWidth: totalW + 4 }} className="archsvg" role="img" aria-label={`Architecture of ${p.name}`}>
        <defs><marker id="pa" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" className="a-head" /></marker></defs>
        {cols.map((col, ci) => <text key={ci} x={ci * (W + GX)} y={14} className="a-col">{col.title.toUpperCase()}</text>)}
        {edges.map((e, i) => {
          const a = pos.get(e.from)!, b = pos.get(e.to)!; if (!a || !b) return null;
          const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x - 2, y2 = b.y + H / 2, mx = (x1 + x2) / 2;
          return <path key={i} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} className={cx("a-edge", e.dashed && "dashed", hot(e) && "hot", hover && !hot(e) && "dim")} markerEnd="url(#pa)" />;
        })}
        {cols.map(col => col.items.map((it: any) => {
          const key = it.id || it.ext || "users"; const q = pos.get(key)!;
          if (it.ext) return <g key={key} transform={`translate(${q.x},${q.y})`} className="a-node ext"><rect width={W} height={H} rx="8" /><text x="14" y="25" className="a-t2">CLIENT SYSTEM</text><text x="14" y="43" className="a-t1">{trunc(it.ext, 28)}</text></g>;
          if (it.users) return <g key={key} transform={`translate(${q.x},${q.y})`} className="a-node users"><rect width={W} height={H} rx="8" /><text x="14" y="25" className="a-t2">PEOPLE</text><text x="14" y="43" className="a-t1">{trunc(it.users, 28)}</text></g>;
          const c = it as Component; const plat = !ids.has(c.id); const o = person(c.ownerId);
          return (
            <g key={key} transform={`translate(${q.x},${q.y})`} className={cx("a-node", plat ? "plat" : "comp", hover === c.id && "on")} onClick={() => go("c-" + c.id)} onMouseEnter={() => setHover(c.id)} onMouseLeave={() => setHover(null)} role="link" tabIndex={0} onKeyDown={e => e.key === "Enter" && go("c-" + c.id)}>
              <rect width={W} height={H} rx="8" />
              <circle cx="15" cy="20" r="4" style={{ fill: STATUS_COLOR[c.status] }} />
              <text x="25" y="24" className="a-t2">{plat ? "SHARED · " : ""}{c.id}</text>
              <text x="14" y="44" className="a-t1">{trunc(c.name, 26)}</text>
              <title>{`${c.name}. ${STATUS_LABEL[c.status]}. ${o ? personName(o) : "Unassigned"}`}</title>
            </g>
          );
        }))}
      </svg>
    </div>
  );
}

// ───────────── Schedule chart ─────────────
function Schedule({ cs, milestones }: { cs: Component[]; milestones: { name: string; date: string }[] }) {
  const t0 = Math.min(...cs.map(c => T(c.start)), Date.now()) - 4 * DAY;
  const t1 = Math.max(...cs.map(c => Math.max(T(c.due), T(c.eta))), ...milestones.map(m => T(m.date)), Date.now()) + 6 * DAY;
  const pct = (t: number) => `${(t - t0) / (t1 - t0) * 100}%`;
  const months: number[] = []; { const d = new Date(t0); d.setDate(1); d.setMonth(d.getMonth() + 1); while (d.getTime() < t1) { months.push(d.getTime()); d.setMonth(d.getMonth() + 1); } }
  const rows = [...cs].sort((a, b) => a.start.localeCompare(b.start));
  return (
    <div className="sched">
      <div className="sched-row sched-axis"><span /><span className="sched-track">{months.map(m => <span key={m} className="sched-tick" style={{ left: pct(m) }}>{new Date(m).toLocaleDateString("en-GB", { month: "short" })}</span>)}</span></div>
      <div className="sched-body">
        <span className="sched-today" style={{ left: `calc(var(--lab) + (100% - var(--lab)) * ${(Date.now() - t0) / (t1 - t0)})` }}><i>Today</i></span>
        {milestones.map(m => <span key={m.name} className="sched-ms" style={{ left: `calc(var(--lab) + (100% - var(--lab)) * ${(T(m.date) - t0) / (t1 - t0)})` }} title={`${m.name} · ${fmtDate(m.date)}`}><i /></span>)}
        {rows.map(c => {
          const l = (T(c.start) - t0) / (t1 - t0), r = (T(c.due) + DAY - t0) / (t1 - t0), e = (T(c.eta) + DAY - t0) / (t1 - t0);
          return (
            <a key={c.id} href={"#c-" + c.id} className="sched-row">
              <span className="sched-label">{c.name}</span>
              <span className="sched-track">
                <i className="sched-bar" style={{ left: `${l * 100}%`, width: `${Math.max(r - l, .01) * 100}%`, background: STATUS_COLOR[c.status] }} title={`${fmtDate(c.start)} → ${fmtDate(c.due)}`} />
                {e > r && <i className="sched-late" style={{ left: `${r * 100}%`, width: `${(e - r) * 100}%` }} title={`ETA ${fmtDate(c.eta)}`} />}
              </span>
            </a>
          );
        })}
      </div>
      {milestones.length > 0 && <div className="sched-mslist">{milestones.map(m => <span key={m.name}><i />{m.name} · {fmtDate(m.date)}</span>)}</div>}
    </div>
  );
}

function Meter({ label: l, v, n, hint }: { label: string; v: number; n: number; hint?: string }) {
  return (
    <div className="meter">
      <div className="row-between"><span>{l}</span><span className="tnum"><b>{v}</b> of {n}</span></div>
      <span className="meter-track"><i style={{ width: `${n ? v / n * 100 : 0}%` }} /></span>
      {hint && <small className="muted">{hint}</small>}
    </div>
  );
}

// ───────────── GitHub activity ─────────────
function CommitChart({ dates }: { dates: string[] }) {
  const days = 28; const end = new Date(); end.setHours(0, 0, 0, 0);
  const buckets = Array.from({ length: days }, (_, i) => { const d0 = end.getTime() - (days - 1 - i) * DAY; return { d0, v: dates.filter(s => { const t = new Date(s).getTime(); return t >= d0 && t < d0 + DAY; }).length }; });
  const max = Math.max(1, ...buckets.map(b => b.v));
  return (
    <div className="cchart" role="img" aria-label={`Commits per day, last ${days} days: ${dates.length} total`}>
      <div className="cchart-bars">{buckets.map((b, i) => <span key={i} title={`${new Date(b.d0).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}: ${b.v} commit${b.v === 1 ? "" : "s"}`}><i style={{ height: `${b.v / max * 100}%` }} className={b.v ? "" : "zero"} /></span>)}</div>
      <div className="cchart-axis"><span>{new Date(buckets[0].d0).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span><span>Today</span></div>
    </div>
  );
}

const SECTIONS = [["overview", "Overview"], ["how", "How it works"], ["architecture", "Architecture"], ["delivery", "Delivery"], ["github", "GitHub"], ["components", "Components"]];

export function ProjectPage({ id }: { id: string }) {
  const { state, person } = useStore();
  const [repo, setRepo] = useState<string | null>(null);
  const refs = useRef<Record<string, HTMLElement | null>>({});
  const p = state.projects.find(x => x.id === id);
  if (!p) return <Empty icon="layers" title="Project not found" action={<a className="btn btn-secondary btn-md" href="#projects">All projects</a>} />;
  const cs = state.components.filter(c => c.projectId === p.id);
  const done = cs.filter(isDone).length;
  const crit = cs.flatMap(c => c.criteria); const acc = crit.filter(k => k.status === "accepted").length;
  const blockers = state.blockers.filter(b => OPEN_BLOCKER(b) && cs.some(c => c.id === b.componentId));
  const ms = state.milestones.filter(m => m.componentIds.some(x => cs.some(c => c.id === x))).sort((a, b) => a.date.localeCompare(b.date));
  const next = ms.find(m => daysUntil(m.date) >= 0);
  const repos = state.repos.filter(r => cs.some(c => c.repoId === r.id));
  const commits = repos.flatMap(r => r.github.commits.map(c => ({ ...c, repo: r.name }))).sort((a, b) => b.at.localeCompare(a.at));
  const withRepo = cs.filter(c => c.repoId);
  const scroll = (k: string) => refs.current[k]?.scrollIntoView({ behavior: "smooth", block: "start" });
  const sec = (k: string) => (el: HTMLElement | null) => { refs.current[k] = el; };
  return (
    <>
      <nav className="crumb"><a href="#projects">Projects</a><Icon name="chevronRight" size={12} /><span>{p.code}</span></nav>
      <header className="p-hero" ref={sec("overview")}>
        <div className="p-hero-main">
          <span className="mono-label">{p.sector} · {p.client}</span>
          <h1>{p.name}</h1>
          <p className="lede">{p.summary}</p>
        </div>
        <dl className="p-facts">
          <div><dt>Used by</dt><dd>{p.users}</dd></div>
          <div><dt>Lead</dt><dd><PersonChip id={p.leadId} size={20} /></dd></div>
          <div><dt>Next milestone</dt><dd>{next ? <>{next.name}<small>{fmtDate(next.date)} · {daysUntil(next.date) === 0 ? "today" : `in ${daysUntil(next.date)} days`}</small></> : "—"}</dd></div>
          <div><dt>Stack</dt><dd className="stack-tags">{p.stack.map(s => <span key={s}>{s}</span>)}</dd></div>
        </dl>
      </header>

      <div className="secnav" role="navigation" aria-label="On this page">{SECTIONS.map(([k, l]) => <button key={k} onClick={() => scroll(k)}>{l}</button>)}</div>

      <div className="figures">
        <div><span className="mono-label">Components</span><b>{cs.length}</b><small>{done} done</small></div>
        <div><span className="mono-label">Progress</span><b>{cs.length ? Math.round(done / cs.length * 100) : 0}%</b><small>components completed</small></div>
        <div><span className="mono-label">Acceptance</span><b>{acc}<span className="of">/{crit.length}</span></b><small>criteria accepted</small></div>
        <div><span className="mono-label">Open blockers</span><b className={blockers.length ? "t-crit-text" : ""}>{blockers.length}</b><small>{blockers.length ? "need action" : "nothing blocked"}</small></div>
      </div>

      <section className="sec">
        <div className="pb">
          <div><span className="mono-label">The problem</span><p>{p.problem}</p></div>
          <div><span className="mono-label">What we deliver</span><p>{p.outcome}</p></div>
        </div>
      </section>

      <section className="sec" ref={sec("how")}>
        <div className="sec-head"><h2>How it works</h2></div>
        <ol className="flow">{p.how.map((s, i) => <li key={i}><span className="flow-n">{String(i + 1).padStart(2, "0")}</span><b>{s.title}</b><p>{s.text}</p></li>)}</ol>
      </section>

      <section className="sec" ref={sec("architecture")}>
        <div className="sec-head"><h2>Architecture</h2><span className="sec-note">Generated from the live dependency data. Click a component to open it.</span></div>
        <Architecture p={p} cs={cs} />
      </section>

      <section className="sec" ref={sec("delivery")}>
        <div className="sec-head"><h2>Delivery</h2></div>
        <div className="delivery">
          <div className="delivery-main">
            <span className="mono-label">Schedule</span>
            <Schedule cs={cs} milestones={ms} />
          </div>
          <div className="delivery-side">
            <div><span className="mono-label">Status</span><StatusBar cs={cs} /></div>
            <div className="meters">
              <span className="mono-label">Readiness gates</span>
              <Meter label="Checks passed" v={cs.filter(c => c.gates.checks.state === "passed").length} n={withRepo.length} hint="Automated, from GitHub" />
              <Meter label="QA accepted" v={cs.filter(c => c.gates.qa.state === "accepted").length} n={cs.length} />
              <Meter label="Ready or deployed" v={cs.filter(c => ["ready", "deployed"].includes(stage(c))).length} n={cs.length} />
            </div>
            {blockers.length > 0 && <div><span className="mono-label">Blockers</span><div className="rows">{blockers.map(b => <a key={b.id} href={"#c-" + b.componentId} className="rowlink"><span className="rowlink-main"><b>{b.title}</b><small>{b.nextAction}</small></span><span className="tnum t-crit-text" style={{ fontSize: 12.5 }}>{fmtDate(b.target)}</span></a>)}</div></div>}
          </div>
        </div>
      </section>

      <section className="sec" ref={sec("github")}>
        <div className="sec-head"><h2>GitHub</h2><span className="sec-note">Sample data · syncs from GitHub in production</span></div>
        {repos.length === 0 ? <Empty icon="github" title="No repositories linked yet" /> : (
          <div className="gh">
            <div className="gh-repos">
              {repos.map(r => (
                <button key={r.id} className="repo" onClick={() => setRepo(r.id)}>
                  <span className="repo-top"><Icon name="repo" size={15} /><b>{r.name}</b><span className={cx("ci", "ci-" + r.ci)}>{label(r.ci)}</span></span>
                  <span className="repo-desc">{r.description}</span>
                  <span className="repo-meta"><span>{r.languages.join(" · ")}</span><span>{r.github.prs.filter(x => x.state === "open").length} open PR</span><span>{r.github.commits[0] ? `updated ${ago(r.github.commits[0].at)}` : "no commits"}</span></span>
                </button>
              ))}
            </div>
            <div className="gh-activity">
              <span className="mono-label">Commits · last 4 weeks</span>
              <CommitChart dates={commits.map(c => c.at)} />
              <div className="commits">{commits.slice(0, 6).map(c => <div key={c.sha + c.repo} className="commit"><code>{c.sha.slice(0, 7)}</code><span>{c.message}</span><small>{c.repo} · {ago(c.at)}</small></div>)}</div>
            </div>
          </div>
        )}
      </section>

      <section className="sec" ref={sec("components")}>
        <div className="sec-head"><h2>Components</h2><span className="sec-note">{cs.length} in this project</span></div>
        <div className="rows">
          {[...cs].sort((a, b) => a.due.localeCompare(b.due)).map(c => {
            const r = risk(state, c);
            return (
              <a key={c.id} href={"#c-" + c.id} className="rowlink rowlink-4">
                <span className="rowlink-main"><b>{c.name}</b><small className={r.level === "blocked" ? "t-crit-text" : r.level === "at_risk" ? "t-warn-text" : ""}>{r.level === "blocked" || r.level === "at_risk" ? r.reasons[0] : c.summary}</small></span>
                <span className="hide-sm"><PersonChip id={c.ownerId} size={20} /></span>
                <StatusPill s={c.status} />
                <DueText c={c} />
              </a>
            );
          })}
        </div>
      </section>
      {repo && <RepoDrawer r={state.repos.find(x => x.id === repo)!} onClose={() => setRepo(null)} />}
    </>
  );
}

export function Projects() {
  const { state, person } = useStore();
  const [repo, setRepo] = useState<string | null>(null);
  return (
    <>
      <header className="hero-head"><div><h1>Projects</h1><p className="lede">What each project is for, how it's built, and where it stands.</p></div></header>
      <div className="pgrid">{state.projects.map(p => <ProjectCard key={p.id} p={p} />)}</div>
      <section className="sec">
        <div className="sec-head"><h2>Repositories</h2><span className="sec-note">{state.repos.length} in apex-ai-arabia · sample data</span></div>
        <div className="rows">
          {state.repos.map(r => {
            const comps = state.components.filter(c => c.repoId === r.id);
            const proj = [...new Set(comps.map(c => state.projects.find(p => p.id === c.projectId)?.code))].filter(Boolean).join(", ");
            return (
              <button key={r.id} className="rowlink rowlink-4" onClick={() => setRepo(r.id)}>
                <span className="rowlink-main"><b className="mono">{r.name}</b><small>{r.description}</small></span>
                <span className="hide-sm muted" style={{ fontSize: 13 }}>{proj || "—"}</span>
                <span className={cx("ci", "ci-" + (r.access === "connected" ? r.ci : "warn"))}>{r.access === "connected" ? label(r.ci) : r.access === "pending_install" ? "Install pending" : "No access"}</span>
                <span className="muted tnum" style={{ fontSize: 12.5, textAlign: "right" }}>{r.github.commits[0] ? ago(r.github.commits[0].at) : "—"}</span>
              </button>
            );
          })}
        </div>
      </section>
      {repo && <RepoDrawer r={state.repos.find(x => x.id === repo)!} onClose={() => setRepo(null)} />}
    </>
  );
}
