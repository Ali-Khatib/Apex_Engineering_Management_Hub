import React, { useMemo, useState } from "react";
import { useStore, useNav, useToast } from "../store";
import { Icon } from "../icons";
import { Button, PageHeader, Section, Pill, PersonChip, Markdown, MarkdownEditor, Field, PersonSelect, KV, Empty, cx, Menu, MenuItem } from "../ui";
import { practiceStatus, fmtDate, daysUntil, ago, addDays, iso, today, personName, nowIso } from "../logic";
import { HistoryLine } from "./activity";
import type { Practice } from "../types";

const TONE = { current: "ok", review_due: "warn", outdated: "crit", under_revision: "info", archived: "faint" } as const;
export const PRACTICE_CATEGORIES = ["Coding standards", "Repository conventions", "Git workflows", "Branching strategies", "Pull request guidelines", "Testing standards", "QA procedures", "Security guidelines", "API development", "Database practices", "Documentation standards", "Deployment procedures", "AI/ML development standards", "Error handling", "Logging and monitoring"];

export function Practices() {
  const { state } = useStore();
  const { go } = useNav();
  const [q, setQ] = useState(""); const [st, setSt] = useState("");
  const list = state.practices.filter(p => (!q || (p.title + p.summary + p.category + p.technologies.join(" ")).toLowerCase().includes(q.toLowerCase())) && (!st || practiceStatus(p).key === st));
  const counts = (k: string) => state.practices.filter(p => practiceStatus(p).key === k).length;
  const cats = [...new Set(list.map(p => p.category))].sort();
  return (
    <>
      <PageHeader title="Development best practices" sub="How we build at Apex. Each page has an owner and a review date; stale pages are flagged."
        actions={<Button variant="primary" icon="plus" onClick={() => go("p-new")}>New page</Button>} />
      <div className="chips">
        {[["", "All", state.practices.length], ["current", "Current", counts("current")], ["review_due", "Review due", counts("review_due")], ["outdated", "Outdated", counts("outdated")], ["under_revision", "Under revision", counts("under_revision")], ["archived", "Archived", counts("archived")]].map(([k, l, n]) =>
          <button key={k as string} className={cx("chip", st === k && "on", (k === "outdated" || k === "review_due") && (n as number) > 0 && "chip-alert")} onClick={() => setSt(k as string)}>{l}<span className="n">{n}</span></button>)}
        <div className="input-ic" style={{ marginLeft: "auto", minWidth: 240 }}><Icon name="search" size={15} /><input type="search" placeholder="Search guidance" value={q} onChange={e => setQ(e.target.value)} aria-label="Search best practices" /></div>
      </div>
      <section className="panel" style={{ overflow: "hidden" }}>
        <div className="prac" style={{ borderTop: 0, fontSize: 12, color: "var(--fg-3)", paddingBlock: 10 }}><span>Page</span><span className="p-owner">Owner</span><span>Status</span><span className="p-next">Next review</span></div>
        {list.length === 0 && <Empty icon="practices" title="No pages match" />}
        {cats.map(cat => (
          <React.Fragment key={cat}>
            <div className="group-head" style={{ fontSize: 12, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--fg-3)" }}>{cat}</div>
            {list.filter(p => p.category === cat).map(p => {
              const s = practiceStatus(p); const d = daysUntil(p.nextReview);
              return (
                <a key={p.id} href={"#p-" + p.id} className="prac">
                  <span style={{ minWidth: 0 }}><b>{p.title}</b><small>{p.summary} · updated {ago(p.updatedAt)}</small></span>
                  <span className="p-owner"><PersonChip id={p.ownerId} size={20} /></span>
                  <span><Pill tone={TONE[s.key]} dot>{s.label}</Pill></span>
                  <span className="p-next tnum" style={{ fontSize: 13, color: d < 0 ? "var(--crit)" : "var(--fg-2)" }}>{fmtDate(p.nextReview)}<br /><small className="muted">{d < 0 ? `${-d} days overdue` : `in ${d} days`}</small></span>
                </a>
              );
            })}
          </React.Fragment>
        ))}
      </section>
    </>
  );
}

export function PracticePage({ id }: { id: string }) {
  const { state, me, isAdmin, person, savePractice, reviewPractice, setPracticeOverride } = useStore();
  const { go } = useNav();
  const { toast } = useToast();
  const isNew = id === "new";
  const existing = state.practices.find(p => p.id === id);
  const blank: Practice = { id: "bp-" + Date.now().toString(36), title: "", category: PRACTICE_CATEGORIES[0], ownerId: me?.id || "", summary: "", body: "## Rules\n\n1. \n\n## Why\n\n", technologies: [], updatedAt: nowIso(), updatedBy: me?.id || "", reviewedAt: nowIso(), nextReview: addDays(iso(today()), 90), override: null };
  const [editing, setEditing] = useState(isNew);
  const [f, setF] = useState<Practice>(existing || blank);
  const [tech, setTech] = useState((existing || blank).technologies.join(", "));
  const [err, setErr] = useState<Record<string, string>>({});
  if (!isNew && !existing) return <Section><Empty icon="practices" title="This page doesn't exist" action={<Button onClick={() => go("practices")}>All best practices</Button>} /></Section>;
  const p = existing || f;
  const s = practiceStatus(p);
  const canReview = isAdmin || p.ownerId === me?.id;
  const save = () => {
    const e: Record<string, string> = {};
    if (!f.title.trim()) e.title = "Give the page a title.";
    if (!f.summary.trim()) e.summary = "Summarise the page in one line.";
    if (!f.ownerId) e.ownerId = "Every page needs an owner.";
    setErr(e); if (Object.keys(e).length) return;
    savePractice({ ...f, title: f.title.trim(), summary: f.summary.trim(), technologies: tech.split(",").map(t => t.trim()).filter(Boolean) }, isNew);
    toast(isNew ? "Page published" : "Page saved"); setEditing(false);
    if (isNew) go("p-" + f.id);
  };
  const hist = state.history.filter(h => h.entity === "practice" && h.entityId === p.id);
  if (editing) return (
    <>
      <PageHeader eyebrow={<a href="#practices" style={{ color: "inherit" }}>Best practices</a>} title={isNew ? "New best-practice page" : `Editing: ${p.title}`} sub="Write for someone joining tomorrow: the rule, an example, and why it exists."
        actions={<><Button variant="ghost" onClick={() => { if (isNew) go("practices"); else { setF(existing!); setEditing(false); } }}>Cancel</Button><Button variant="primary" icon="check" onClick={save}>{isNew ? "Publish page" : "Save changes"}</Button></>} />
      <div className="split">
        <Section><div className="panel-body"><MarkdownEditor value={f.body} onChange={v => setF({ ...f, body: v })} rows={24} /></div></Section>
        <Section title="Page details"><div className="panel-body" style={{ display: "grid", gap: 14 }}>
          <Field label="Title" error={err.title}><input type="text" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></Field>
          <Field label="Summary" error={err.summary}><input type="text" value={f.summary} onChange={e => setF({ ...f, summary: e.target.value })} /></Field>
          <Field label="Category"><select value={f.category} onChange={e => setF({ ...f, category: e.target.value })}>{PRACTICE_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Owner" error={err.ownerId} hint="Keeps the page current and is reminded at each review date"><PersonSelect value={f.ownerId} onChange={v => setF({ ...f, ownerId: v || "" })} allowEmpty={false} /></Field>
          <Field label="Next review" hint="Default is 90 days"><input type="date" value={f.nextReview} onChange={e => setF({ ...f, nextReview: e.target.value })} /></Field>
          <Field label="Applies to" hint="Comma-separated technologies"><input type="text" value={tech} onChange={e => setTech(e.target.value)} placeholder="Go, PostgreSQL" /></Field>
        </div></Section>
      </div>
    </>
  );
  return (
    <>
      <PageHeader eyebrow={<><a href="#practices" style={{ color: "inherit" }}>Best practices</a><span className="muted" style={{ letterSpacing: 0, textTransform: "none", fontWeight: 400 }}>· {p.category}</span></>} title={p.title} sub={p.summary}
        actions={<>
          {canReview && <Button icon="check" onClick={() => { reviewPractice(p.id); toast("Marked as reviewed. Next review in 90 days."); }}>Mark reviewed</Button>}
          <Button variant="primary" icon="edit" onClick={() => { setF(p); setTech(p.technologies.join(", ")); setEditing(true); }}>Edit page</Button>
          {canReview && <Menu trigger={(o, t) => <Button icon="more" onClick={t} aria-label="More" aria-expanded={o} />}>{close => <>
            <MenuItem icon="refresh" onClick={() => { close(); setPracticeOverride(p.id, p.override === "under_revision" ? null : "under_revision"); }}>{p.override === "under_revision" ? "Clear “under revision”" : "Mark under revision"}</MenuItem>
            <MenuItem icon="file" onClick={() => { close(); setPracticeOverride(p.id, p.override === "archived" ? null : "archived"); toast(p.override === "archived" ? "Page restored" : "Page archived"); }}>{p.override === "archived" ? "Restore page" : "Archive page"}</MenuItem>
          </>}</Menu>}
        </>} />
      {(s.key === "outdated" || s.key === "review_due") && (
        <div className={cx("stale-banner", s.key === "outdated" && "crit")}><Icon name="alert" size={18} /><div><b>{s.key === "outdated" ? "This guidance may be out of date" : "This page is due for review"}</b><p>Last reviewed {fmtDate(p.reviewedAt)} by the owner, {personName(person(p.ownerId))}. {s.key === "outdated" ? "Check with them before relying on it." : "The owner has been reminded."}</p></div></div>
      )}
      {p.override === "archived" && <div className="stale-banner"><Icon name="file" size={18} /><div><b>Archived</b><p>Kept for reference. Don't follow this guidance for new work.</p></div></div>}
      <div className="split">
        <Section><div className="panel-body" style={{ padding: "24px 28px 28px" }}><Markdown src={p.body} /></div></Section>
        <div className="stack-v">
          <Section title="Maintenance"><div className="panel-body" style={{ paddingTop: 8 }}><dl>
            <KV k="Status"><Pill tone={TONE[s.key]} dot>{s.label}</Pill></KV>
            <KV k="Owner"><PersonChip id={p.ownerId} sub={person(p.ownerId)?.title} /></KV>
            <KV k="Last updated">{fmtDate(p.updatedAt)} <span className="muted">by {person(p.updatedBy)?.first}</span></KV>
            <KV k="Last reviewed">{fmtDate(p.reviewedAt)}</KV>
            <KV k="Next review"><span style={{ color: daysUntil(p.nextReview) < 0 ? "var(--crit)" : undefined }}>{fmtDate(p.nextReview)}</span></KV>
            {p.technologies.length > 0 && <KV k="Applies to"><span className="row" style={{ gap: 4 }}>{p.technologies.map(t => <Pill key={t} tone="neutral">{t}</Pill>)}</span></KV>}
          </dl></div></Section>
          <Section title="Version history"><div className="panel-body" style={{ paddingTop: 4 }}><div className="feed">{hist.length ? hist.map(h => <HistoryLine key={h.id} h={h} />) : <span className="muted" style={{ fontSize: 13 }}>No recorded changes yet.</span>}</div></div></Section>
        </div>
      </div>
    </>
  );
}
